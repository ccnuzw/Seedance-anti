import { MODE_MAP } from '@shared/batch'
import { WORKFLOW_STAGE_MAP } from '@shared/workflow-definition'
import type { TaskEntry } from '@renderer/stores/taskCenterStore'

const STATUS_LABELS: Record<string, string> = {
  running: '运行中',
  paused: '已暂停',
  stopping: '停止处理中',
  interrupted: '已中断，结果待核实',
  completed: '已完成',
  failed: '失败',
  stopped: '已停止',
  error: '失败',
  pending: '排队中',
  done: '已完成',
  skipped: '已跳过'
}
export const taskStatusLabel = (status: string) =>
  STATUS_LABELS[status] || '状态未知'

export function describeTask(entry: TaskEntry) {
  if (entry.source === 'task') {
    const { identity, context, kind, status } = entry.task
    const stage = identity.stage
      ? WORKFLOW_STAGE_MAP[identity.stage]?.cardLabel
      : undefined
    const sourceRoute =
      kind === 'pipeline'
        ? 'pipeline'
        : identity.stage === 'story'
          ? 'story'
          : identity.stage === 'script'
            ? 'script'
            : identity.stage === 'character'
              ? 'assets'
              : 'review'
    return {
      projectId: identity.projectId,
      episode: identity.episodeNum
        ? `第 ${identity.episodeNum} 集`
        : '集数未提供',
      source: kind === 'workflow' ? '独立工作流' : '流水线',
      stage: stage || '阶段待查询',
      status: taskStatusLabel(status),
      progress:
        kind === 'workflow'
          ? status === 'running' && identity.stage?.endsWith('_review')
            ? '正在审核 · 服务未提供细分步骤进度'
            : '服务未提供细分步骤进度'
          : context?.state.includes('reviewing')
            ? '正在审核'
            : '当前阶段执行状态以后台快照为准',
      failure:
        status === 'failed'
          ? context?.error || '服务未提供失败摘要，请到来源页查看原因。'
          : undefined,
      path: `/project/${encodeURIComponent(identity.projectId)}/${sourceRoute}${identity.episodeNum ? `?ep=${identity.episodeNum}` : ''}`
    }
  }
  const queue = entry.batch
  const current = queue.tasks.find((task) => task.status === 'running')
  const failed = queue.tasks.filter((task) => task.status === 'error')
  return {
    projectId: queue.projectId,
    episode: current
      ? current.batchNumber
        ? `剧情批次 ${current.batchNumber}`
        : `第 ${current.episodeNum} 集`
      : `${queue.tasks.length} 个队列任务`,
    source: '批量队列',
    stage: MODE_MAP[queue.mode].label,
    status:
      queue.status === 'completed' && failed.length
        ? `队列已遍历完成 · ${failed.length} 项失败`
        : taskStatusLabel(queue.status),
    progress: `${queue.status === 'completed' ? '队列已遍历完成' : '队列遍历'} ${queue.cursor}/${queue.tasks.length}${current?.progress ? ` · ${current.progress}` : current?.inFlight ? ` · 当前子步骤：${current.inFlight.action}` : ''}`,
    failure:
      queue.error ||
      failed
        .map(
          (task) =>
            `${task.batchNumber ? `剧情批次 ${task.batchNumber}` : `第 ${task.episodeNum} 集`}：${task.progress || '执行失败'}`
        )
        .join('；') ||
      undefined,
    path: `/project/${encodeURIComponent(queue.projectId)}/batch`
  }
}
