interface ScriptGenerationControlProps {
  stageLabel: string
  generationStatusText: string
  assignedEpisodes: number
  scriptEpisodes: number
  pendingScriptEpisodes: number
  unusedPlots: number
  supportsGeneration: boolean
  isRunning: boolean
  isReviewBlocked: boolean
  batchActionLabel: string
  batchConstraintText: string
  strategyChips: string[]
  onCreateNext: () => void
  onOpenBatchDrawer: () => void
  onGoToSource: () => void
  variant?: 'default' | 'compact'
}

export default function ScriptGenerationControl({
  stageLabel,
  generationStatusText,
  assignedEpisodes,
  scriptEpisodes,
  pendingScriptEpisodes,
  unusedPlots,
  supportsGeneration,
  isRunning,
  isReviewBlocked,
  batchActionLabel,
  batchConstraintText,
  strategyChips,
  onCreateNext,
  onOpenBatchDrawer,
  onGoToSource,
  variant = 'default'
}: ScriptGenerationControlProps) {
  const generationDisabled = isRunning || unusedPlots === 0 || isReviewBlocked
  const isCompact = variant === 'compact'

  return (
    <div className={`as-stage-card card ${isCompact ? 'is-compact' : ''}`}>
      <div className="as-section-head">
        <h3>{isCompact ? '生成控制' : '剧本生成环节'}</h3>
        <span className={`as-stage-chip ${isRunning ? 'is-running' : ''}`}>
          {stageLabel}
        </span>
      </div>
      <div className="as-stage-layout">
        <div className="as-stage-summary">
          <p className="text-secondary">{generationStatusText}</p>
          <div className="as-stage-policy-chips">
            {strategyChips.map((item) => (
              <span key={item} className="status-chip">{item}</span>
            ))}
          </div>
          <div className="as-metrics">
            <div className="as-metric-card">
              <span className="task-summary-label">已拆到集</span>
              <strong>{assignedEpisodes}</strong>
            </div>
            <div className="as-metric-card">
              <span className="task-summary-label">已有剧本文件</span>
              <strong>{scriptEpisodes}</strong>
            </div>
            <div className="as-metric-card">
              <span className="task-summary-label">待补生成</span>
              <strong>{pendingScriptEpisodes}</strong>
            </div>
            <div className="as-metric-card">
              <span className="task-summary-label">可用剧情点</span>
              <strong>{unusedPlots}</strong>
            </div>
          </div>
        </div>
        <div className="as-stage-controls">
          <div className="as-stage-control-copy">
            <strong>生成操作</strong>
            <span className="text-secondary text-xs">
              {isCompact
                ? '保留批量推进入口；单集处理请直接在下方选集区或编辑区触发。'
                : '这里负责顺序批量生成；指定某一集补生成，请直接在下方队列或主编辑区触发。'}
            </span>
            <span className="text-secondary text-xs">{batchConstraintText}</span>
          </div>
          <div className="as-stage-actions">
            {supportsGeneration && (
              <>
                <button className="btn btn-primary" disabled={generationDisabled} onClick={onCreateNext}>
                  生成下一集
                </button>
                <button className="btn" disabled={generationDisabled} onClick={onOpenBatchDrawer}>
                  {batchActionLabel}
                </button>
              </>
            )}
            {supportsGeneration && (
              <button className="btn" onClick={onGoToSource}>
                回到改编规划
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
