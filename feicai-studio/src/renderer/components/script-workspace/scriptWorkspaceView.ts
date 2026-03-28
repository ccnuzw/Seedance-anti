export function formatAdaptState(state: string): string {
  const map: Record<string, string> = {
    adapt_idle: '空闲',
    novel_loaded: '小说已加载',
    breakdown_executing: '剧情拆解中',
    breakdown_reviewing: '拆解质检中',
    breakdown_done: '剧情拆解完成',
    script_executing: '剧本生成中',
    script_reviewing: '剧本质检中',
    script_done: '剧本生成完成',
    adapt_paused: '已暂停',
    adapt_awaiting_user: '等待用户处理',
    adapt_error: '执行出错'
  }

  return map[state] || state
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
