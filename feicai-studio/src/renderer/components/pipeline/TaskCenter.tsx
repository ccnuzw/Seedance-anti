import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useProjectStore } from '@renderer/stores/projectStore'
import {
  allowedTaskActions,
  isActive,
  useTaskCenterStore,
  type TaskAction,
  type TaskEntry
} from '@renderer/stores/taskCenterStore'
import { describeTask, taskStatusLabel } from './TaskCenter-view'
import './TaskCenter.css'

const ACTION_LABELS: Record<TaskAction, string> = {
  pause: '暂停',
  resume: '继续',
  stop: '停止'
}

function TaskCard({
  entry,
  onNavigate
}: {
  entry: TaskEntry
  onNavigate(): void
}) {
  const [controlError, setControlError] = useState<string | null>(null)
  const state = useTaskCenterStore()
  const projects = useProjectStore((s) => s.projects)
  const view = describeTask(entry)
  const name = projects.find((project) => project.id === view.projectId)?.name
  const pending = state.pending?.key === entry.key ? state.pending.action : null
  const unknown = entry.unknown || state.health === 'unknown'
  const stopping = isActive(entry) && state.execution?.phase === 'stopping'
  const status = pending
    ? `${ACTION_LABELS[pending]}处理中`
    : unknown
      ? '状态未知 · 结果待核实'
      : stopping
        ? '停止处理中'
        : view.status
  const actions = allowedTaskActions(state, entry)
  const acknowledged = state.acknowledged.includes(entry.key)
  const control = (action: TaskAction) => {
    if (
      action !== 'resume' &&
      !window.confirm(
        `确认${ACTION_LABELS[action]}此任务？\n${name || view.projectId} · ${view.episode} · ${view.stage}\n当前状态：${status}`
      )
    )
      return
    setControlError(null)
    void state.control(entry.key, action).catch((error: unknown) => {
      setControlError(
        error instanceof Error ? error.message : '控制失败，请刷新状态'
      )
    })
  }
  return (
    <article
      className="task-center-card"
      aria-label={`${name || view.projectId} ${view.episode} ${view.source}`}
    >
      <h3>
        {name || `项目 ${view.projectId}`} · {view.episode}
      </h3>
      <p className="task-center-meta">
        项目 ID：{view.projectId} · {view.source} · {view.stage}
      </p>
      <p className="task-center-state">{status}</p>
      {!unknown && <p>{view.progress}</p>}
      {view.failure && <p className="task-center-failure">{view.failure}</p>}
      <p className="task-center-meta">
        结果是否写入：待核实（当前快照未提供提交确认）
      </p>
      {entry.source === 'batch' && (
        <details>
          <summary>队列任务与实际子步骤</summary>
          <ul>
            {entry.batch.tasks.map((task, index) => (
              <li key={`${task.episodeNum}:${index}`}>
                {task.batchNumber
                  ? `剧情批次 ${task.batchNumber}`
                  : `第 ${task.episodeNum} 集`}{' '}
                · {taskStatusLabel(task.status)}
                {task.progress && <p>{task.progress}</p>}
                {Object.entries(task.steps).map(([key, result]) => (
                  <p key={key}>
                    子步骤 {key}：{result.success ? '服务报告完成' : '失败'}
                    {'error' in result && result.error
                      ? ` · ${result.error}`
                      : ''}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary>诊断身份</summary>
        <pre>
          {JSON.stringify(
            entry.source === 'task'
              ? entry.task.identity
              : {
                  queueId: entry.batch.id,
                  projectId: entry.batch.projectId,
                  currentOperation:
                    entry.batch.tasks[entry.batch.cursor]?.inFlight
                },
            null,
            2
          )}
        </pre>
      </details>
      <div className="task-center-controls">
        <Link className="btn" to={view.path} onClick={onNavigate}>
          查看来源与结果
        </Link>
        {actions.map((action) => (
          <button key={action} className="btn" onClick={() => control(action)}>
            {ACTION_LABELS[action]}
          </button>
        ))}
        {!isActive(entry) && !unknown && !acknowledged && (
          <button className="btn" onClick={() => state.acknowledge(entry.key)}>
            确认结果
          </button>
        )}
        {acknowledged && <span className="task-center-meta">已确认</span>}
      </div>
      {controlError && (
        <p role="alert" className="task-center-failure">
          {controlError}
        </p>
      )}
      {(pending || stopping || unknown) && (
        <p className="task-center-meta">
          等待后台状态确认，暂不可发送其他控制。可刷新查询。
        </p>
      )}
      {entry.source === 'batch' && entry.batch.status === 'interrupted' && (
        <p className="task-center-meta">
          重启后的结果待核实。请到批量页检查已提交子步骤；此处不自动恢复执行。
        </p>
      )}
    </article>
  )
}

export default function TaskCenter() {
  const state = useTaskCenterStore()
  const projects = useProjectStore((s) => s.projects)
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => state.connect(), [state.connect])
  useEffect(() => {
    if (open) dialog.current?.showModal()
    else if (dialog.current?.open) {
      dialog.current.close()
      trigger.current?.focus()
    }
  }, [open])
  const active = state.entries.filter(
    (entry) => isActive(entry) && !entry.unknown
  )
  const awaiting = state.entries.filter(
    (entry) =>
      !state.acknowledged.includes(entry.key) &&
      (!isActive(entry) || entry.unknown)
  )
  const recent = state.entries.filter((entry) =>
    state.acknowledged.includes(entry.key)
  )
  const primary =
    active[0] ||
    awaiting.find((entry) => describeTask(entry).failure) ||
    awaiting[0]
  const view = primary ? describeTask(primary) : null
  const name = view
    ? projects.find((project) => project.id === view.projectId)?.name ||
      `项目 ${view.projectId}`
    : ''
  let status =
    view?.status ||
    (state.execution?.busy
      ? '后台执行中 · 身份待查询'
      : '无活动任务 · 上次结果待核实')
  if (primary?.unknown || state.health === 'unknown')
    status = '状态未知 · 结果待核实'
  else if (state.health === 'loading') status = '状态查询中'
  else if (state.pending)
    status = `${ACTION_LABELS[state.pending.action]}处理中`
  else if (active.length && state.execution?.phase === 'stopping')
    status = '停止处理中'
  const groups = [
    ['活动', active],
    ['结果待确认', awaiting],
    ['最近结果', recent]
  ] as const
  return (
    <>
      <div className="task-center-bar" aria-label="全局任务状态">
        <div className="task-center-bar-text" role="status" aria-live="polite">
          <strong>{status}</strong>
          {view && (
            <span title={`${name} · ${view.episode} · ${view.stage}`}>
              {name} · {view.episode} · {view.stage}
            </span>
          )}
          {view && state.health === 'ready' && !primary?.unknown && (
            <span>{view.progress}</span>
          )}
        </div>
        <button
          ref={trigger}
          className="btn"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          任务中心{awaiting.length ? ` (${awaiting.length})` : ''}
        </button>
      </div>
      <dialog
        ref={dialog}
        className="task-center-drawer"
        aria-labelledby="task-center-title"
        onCancel={() => setOpen(false)}
        onClose={() => {
          setOpen(false)
          trigger.current?.focus()
        }}
      >
        <div className="task-center-drawer-header">
          <h2 id="task-center-title">全局任务中心</h2>
          <button
            className="btn"
            aria-label="关闭任务中心"
            onClick={() => setOpen(false)}
          >
            关闭
          </button>
        </div>
        <div className="task-center-body">
          <p className="task-center-meta">
            切换页面不会停止任务。流水线与独立工作流仅有本进程任务快照；最近结果仅含本窗口观察记录，确认状态不跨重启保存。
          </p>
          <button
            className="btn"
            disabled={state.refreshing}
            onClick={() => void state.refresh()}
          >
            {state.refreshing ? '状态查询中' : '刷新状态'}
          </button>
          {state.error && (
            <p role="alert" className="task-center-failure">
              {state.error}
            </p>
          )}
          {!state.entries.length && (
            <p>
              没有可核实的任务记录。上次应用退出前的流水线或独立工作流结果未知；请到来源页检查产物，不能据此确认恢复成功。
            </p>
          )}
          {state.execution?.busy && !active.length && (
            <p role="status">
              后台执行租约仍被占用（
              {state.execution.phase === 'stopping' ? '停止处理中' : '执行中'}
              ），任务身份待查询。冲突任务不可启动。
            </p>
          )}
          {groups.map(([title, entries]) => (
            <section key={title} aria-label={title}>
              <h3 className="task-center-group-title">
                {title} · {entries.length}
              </h3>
              {entries.map((entry) => (
                <TaskCard
                  key={entry.key}
                  entry={entry}
                  onNavigate={() => setOpen(false)}
                />
              ))}
              {!entries.length && <p className="task-center-meta">暂无记录</p>}
            </section>
          ))}
        </div>
      </dialog>
    </>
  )
}
