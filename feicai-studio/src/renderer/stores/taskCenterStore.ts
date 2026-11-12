import { create } from 'zustand'
import type { BatchQueueState } from '@shared/batch'
import type { ExecutionStatus } from '@shared/ipc-contracts'
import type { PipelineTaskSnapshot } from '@shared/pipeline-task'
import {
  taskCenterService,
  type TaskCenterAPI
} from '@renderer/services/task-center-service'

export type TaskEntry =
  | {
      key: string
      source: 'task'
      task: PipelineTaskSnapshot
      unknown?: boolean
    }
  | { key: string; source: 'batch'; batch: BatchQueueState; unknown?: boolean }
export type TaskAction = 'pause' | 'resume' | 'stop'
export const taskKey = (task: PipelineTaskSnapshot) =>
  `task:${task.identity.projectId}:${task.identity.taskId}:${task.identity.runId}`
export const batchKey = (batch: BatchQueueState) => `batch:${batch.id}`
export function isActive(entry: TaskEntry): boolean {
  return entry.source === 'task'
    ? ['running', 'paused'].includes(entry.task.status)
    : ['running', 'paused', 'stopping', 'interrupted'].includes(
        entry.batch.status
      )
}

interface TaskCenterState {
  entries: TaskEntry[]
  acknowledged: string[]
  execution: ExecutionStatus | null
  health: 'loading' | 'ready' | 'unknown'
  error: string | null
  refreshing: boolean
  pending: { key: string; action: TaskAction } | null
  connect(): () => void
  refresh(): Promise<void>
  acknowledge(key: string): void
  control(key: string, action: TaskAction): Promise<void>
}

export function allowedTaskActions(
  state: TaskCenterState,
  entry: TaskEntry
): TaskAction[] {
  if (
    state.health !== 'ready' ||
    state.refreshing ||
    state.pending ||
    entry.unknown
  )
    return []
  const execution = state.execution
  if (!execution || execution.phase === 'stopping') return []
  if (entry.source === 'batch') {
    if (entry.batch.status === 'interrupted' && !execution.busy) return ['stop']
    if (execution.owner !== 'batch' || !execution.busy) return []
    if (entry.batch.status === 'running' && execution.phase === 'running')
      return ['pause', 'stop']
    if (entry.batch.status === 'paused' && execution.phase === 'paused')
      return ['resume', 'stop']
    return []
  }
  if (execution.owner !== entry.task.kind || !execution.busy) return []
  if (entry.task.status === 'running' && execution.phase === 'running')
    return ['pause', 'stop']
  if (entry.task.status === 'paused' && execution.phase === 'paused')
    return ['resume', 'stop']
  return []
}

/** Session display cache only. Events have no revision: always re-read the authority. */
export function createTaskCenterStore(api: TaskCenterAPI) {
  let connections = 0
  let unsubscribe: (() => void) | undefined
  let poll: ReturnType<typeof setInterval> | undefined
  let debounce: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | null = null
  let revision = 0
  const suppressed = new Set<string>()
  return create<TaskCenterState>((set, get) => {
    const invalidate = () => {
      revision++
      set({ health: 'loading' })
      if (!debounce)
        debounce = setTimeout(() => {
          debounce = undefined
          void get().refresh()
        }, 80)
    }
    return {
      entries: [],
      acknowledged: [],
      execution: null,
      health: 'loading',
      error: null,
      refreshing: false,
      pending: null,
      connect() {
        if (++connections === 1) {
          unsubscribe = api.subscribe(invalidate)
          poll = setInterval(() => void get().refresh(), 2000)
          if (typeof window !== 'undefined')
            window.addEventListener('focus', invalidate)
          void get().refresh()
        }
        let closed = false
        return () => {
          if (closed) return
          closed = true
          if (--connections === 0) {
            unsubscribe?.()
            clearInterval(poll)
            clearTimeout(debounce)
            debounce = undefined
            if (typeof window !== 'undefined')
              window.removeEventListener('focus', invalidate)
            revision++
          }
        }
      },
      refresh() {
        if (inFlight) return inFlight
        set({ refreshing: true })
        inFlight = (async () => {
          // An event during a read invalidates the entire composite snapshot. No old
          // request is allowed to overwrite a new run on refresh/reconnect.
          let readRevision: number
          do {
            readRevision = revision
            const results = await Promise.allSettled([
              api.tasks(),
              api.batch(),
              api.execution()
            ] as const)
            if (readRevision !== revision) continue
            const [tasks, batch, execution] = results
            if (
              tasks.status === 'rejected' ||
              batch.status === 'rejected' ||
              execution.status === 'rejected'
            ) {
              set({
                health: 'unknown',
                error: '状态查询失败，结果待核实。请刷新后再操作。',
                execution: null
              })
              break
            }
            const incoming: TaskEntry[] = []
            if (execution.value.owner === 'batch')
              tasks.value.forEach((task) => {
                if (['running', 'paused'].includes(task.status))
                  suppressed.add(taskKey(task))
              })
            for (const task of tasks.value) {
              if (!suppressed.has(taskKey(task)))
                incoming.push({ key: taskKey(task), source: 'task', task })
            }
            if (batch.value)
              incoming.push({
                key: batchKey(batch.value),
                source: 'batch',
                batch: batch.value
              })
            const keys = new Set(incoming.map((entry) => entry.key))
            const retained = get()
              .entries.filter(
                (entry) => !keys.has(entry.key) && !suppressed.has(entry.key)
              )
              .map((entry) =>
                isActive(entry) ? { ...entry, unknown: true } : entry
              )
            // Only session-observed results; unacknowledged entries are never evicted.
            const acknowledged = get().acknowledged
            const recent = retained
              .filter((entry) => acknowledged.includes(entry.key))
              .slice(0, 20)
            const pending = retained.filter(
              (entry) => !acknowledged.includes(entry.key)
            )
            set({
              entries: [...incoming, ...pending, ...recent],
              execution: execution.value,
              health: 'ready',
              error: null
            })
          } while (readRevision !== revision)
        })().finally(() => {
          inFlight = null
          set({ refreshing: false })
        })
        return inFlight
      },
      acknowledge(key) {
        const entry = get().entries.find((item) => item.key === key)
        if (entry && !isActive(entry) && !entry.unknown)
          set({ acknowledged: [...new Set([...get().acknowledged, key])] })
      },
      async control(key, action) {
        const entry = get().entries.find((item) => item.key === key)
        if (!entry || !allowedTaskActions(get(), entry).includes(action))
          throw new Error('当前状态不可控制，请刷新')
        set({ pending: { key, action }, error: null })
        try {
          if (entry.source === 'task') {
            await api.control({
              action: action === 'stop' ? 'abort' : action,
              target: { ...entry.task.identity }
            })
          } else await api.controlBatch(action, entry.batch.id)
        } catch (error) {
          set({
            health: 'unknown',
            execution: null,
            error:
              error instanceof Error ? error.message : '任务控制失败，请刷新'
          })
          return
        } finally {
          set({ pending: null })
        }
        await get().refresh()
      }
    }
  })
}

export const useTaskCenterStore = createTaskCenterStore(taskCenterService)
