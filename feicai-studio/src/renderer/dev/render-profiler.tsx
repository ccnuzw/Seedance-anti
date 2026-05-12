import {
  Profiler as ReactProfiler,
  type ProfilerOnRenderCallback,
  type ReactNode
} from 'react'

type RenderPhase = Parameters<ProfilerOnRenderCallback>[1]

export interface RenderProfileSample {
  id: string
  phase: RenderPhase
  actualDuration: number
  baseDuration: number
  startTime: number
  commitTime: number
}

export interface RenderProfileSummary {
  id: string
  renders: number
  mounts: number
  updates: number
  totalActualDuration: number
  totalBaseDuration: number
  maxActualDuration: number
  maxBaseDuration: number
  lastPhase: RenderPhase
  lastActualDuration: number
  lastBaseDuration: number
  lastStartTime: number
  lastCommitTime: number
}

export interface RenderProfilerAPI {
  dump: () => RenderProfileSummary[]
  reset: () => void
  getSummary: () => RenderProfileSummary[]
}

const enabled = import.meta.env.DEV
const stats = new Map<string, RenderProfileSummary>()

function formatDuration(ms: number): string {
  return `${ms.toFixed(2)}ms`
}

function recordSample(sample: RenderProfileSample): void {
  const current = stats.get(sample.id)
  if (!current) {
    stats.set(sample.id, {
      id: sample.id,
      renders: 1,
      mounts: sample.phase === 'mount' ? 1 : 0,
      updates: sample.phase === 'update' ? 1 : 0,
      totalActualDuration: sample.actualDuration,
      totalBaseDuration: sample.baseDuration,
      maxActualDuration: sample.actualDuration,
      maxBaseDuration: sample.baseDuration,
      lastPhase: sample.phase,
      lastActualDuration: sample.actualDuration,
      lastBaseDuration: sample.baseDuration,
      lastStartTime: sample.startTime,
      lastCommitTime: sample.commitTime
    })
    return
  }

  current.renders += 1
  current.mounts += sample.phase === 'mount' ? 1 : 0
  current.updates += sample.phase === 'update' ? 1 : 0
  current.totalActualDuration += sample.actualDuration
  current.totalBaseDuration += sample.baseDuration
  current.maxActualDuration = Math.max(
    current.maxActualDuration,
    sample.actualDuration
  )
  current.maxBaseDuration = Math.max(
    current.maxBaseDuration,
    sample.baseDuration
  )
  current.lastPhase = sample.phase
  current.lastActualDuration = sample.actualDuration
  current.lastBaseDuration = sample.baseDuration
  current.lastStartTime = sample.startTime
  current.lastCommitTime = sample.commitTime
}

function snapshot(): RenderProfileSummary[] {
  return [...stats.values()].sort(
    (a, b) => b.totalActualDuration - a.totalActualDuration
  )
}

function dump(): RenderProfileSummary[] {
  const rows = snapshot()
  if (rows.length > 0) {
    console.table(
      rows.map((row) => ({
        id: row.id,
        renders: row.renders,
        mounts: row.mounts,
        updates: row.updates,
        totalActual: formatDuration(row.totalActualDuration),
        maxActual: formatDuration(row.maxActualDuration),
        totalBase: formatDuration(row.totalBaseDuration),
        lastPhase: row.lastPhase
      }))
    )
  } else {
    console.info('[Profiler] 暂无采样数据')
  }
  return rows
}

function reset(): void {
  stats.clear()
}

const onRender: ProfilerOnRenderCallback = (
  id: string,
  phase: RenderPhase,
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number
): void => {
  if (!enabled) return

  const sample: RenderProfileSample = {
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime
  }

  recordSample(sample)
  console.debug(
    `[Profiler] ${id} ${phase} actual=${formatDuration(actualDuration)} base=${formatDuration(baseDuration)} start=${startTime.toFixed(2)} commit=${commitTime.toFixed(2)}`
  )
}

if (enabled && typeof window !== 'undefined') {
  window.__FEICAI_RENDER_PROFILER__ = {
    dump,
    reset,
    getSummary: snapshot
  }
  console.info(
    '[Profiler] 已启用，可用 window.__FEICAI_RENDER_PROFILER__.dump() 查看汇总'
  )
}

interface DevProfilerProps {
  id: string
  children: ReactNode
}

export function DevProfiler({ id, children }: DevProfilerProps) {
  if (!enabled) return <>{children}</>
  return (
    <ReactProfiler id={id} onRender={onRender}>
      {children}
    </ReactProfiler>
  )
}
