import type {
  LogEntry,
  PipelineLLMCallRecord,
  PipelineRunDetail,
  PipelineRunRecord,
  PipelineStage,
  PipelineState
} from '@shared/types'

export const STAGES: Array<{ id: PipelineStage; label: string; emoji: string }> = [
  { id: 'director', label: '导演分析', emoji: '🎬' },
  { id: 'art', label: '服化道', emoji: '🎨' },
  { id: 'storyboard', label: '分镜编写', emoji: '📐' }
]

export function isStageActive(stage: PipelineStage, state: PipelineState): boolean {
  const stateStr = state as string
  if (stage === 'director') return stateStr.startsWith('director_')
  if (stage === 'art') return stateStr.startsWith('art_')
  if (stage === 'storyboard') return stateStr.startsWith('storyboard_')
  return false
}

export function isStageDone(stage: PipelineStage, state: PipelineState): boolean {
  const order = ['director', 'art', 'storyboard']
  const stageIdx = order.indexOf(stage)
  const stateStr = state as string
  if (stateStr === 'episode_complete') return true
  for (let i = stageIdx + 1; i < order.length; i++) {
    if (stateStr.startsWith(order[i] + '_') || stateStr === `${order[i]}_done`) return true
  }
  if (stage === 'director' && stateStr === 'director_done') return true
  if (stage === 'art' && stateStr === 'art_done') return true
  return false
}

export function mapEpisodeStatusToPipelineState(status?: string): PipelineState {
  if (status === 'director') return 'director_done'
  if (status === 'art') return 'art_done'
  if (status === 'complete') return 'episode_complete'
  return 'idle'
}

export function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function getTimingElapsed(
  timing: { startedAt: number; endedAt?: number; elapsed: number },
  now: number
): number {
  return timing.endedAt
    ? timing.elapsed
    : Math.round((now - timing.startedAt) / 1000)
}

export function formatRunTime(value?: string): string {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatRunStatus(status: PipelineRunRecord['status']): string {
  return {
    queued: '排队中',
    running: '进行中',
    paused: '已暂停',
    completed: '已完成',
    failed: '失败',
    aborted: '已中止',
    dead_letter: '死信'
  }[status]
}

export function formatFailureClass(value?: string): string {
  return {
    timeout: '超时',
    network: '网络',
    rate_limit: '限流',
    provider: '服务端',
    auth: '鉴权',
    validation: '请求参数',
    unknown: '未知'
  }[value || 'unknown'] || value || '--'
}

export function getLogIcon(level: string, eventType: string): string {
  if (eventType === 'state_changed') return '🔄'
  if (eventType === 'skill_loading') return '📦'
  if (eventType === 'llm_calling') return '🤖'
  if (eventType === 'llm_complete') return '✨'
  if (eventType === 'file_written') return '💾'
  if (eventType === 'review_start') return '⚠️'
  if (eventType === 'stage_complete') return '✅'
  if (eventType === 'review_fail') return '❌'
  if (eventType === 'paused') return '⏸'
  if (eventType === 'resumed') return '▶'
  if (level === 'error') return '🔴'
  if (level === 'warn') return '🟡'
  return '📝'
}

export function resolveSelectedRunLogs(
  selectedRun: PipelineRunRecord | null,
  selectedRunDetail: PipelineRunDetail | null,
  contextRunId?: string,
  liveLogs: LogEntry[] = []
): LogEntry[] {
  return selectedRun?.runId === contextRunId && liveLogs.length > 0
    ? liveLogs
    : selectedRunDetail?.logs || []
}

export function resolveSelectedRunLLMCalls(selectedRunDetail: PipelineRunDetail | null): PipelineLLMCallRecord[] {
  return selectedRunDetail?.llmCalls || []
}
