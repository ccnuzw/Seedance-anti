interface ScriptBatchDrawerProps {
  open: boolean
  count: number
  maxCount: number
  pendingScriptEpisodes: number
  unusedPlots: number
  isRunning: boolean
  isReviewBlocked: boolean
  onCountChange: (value: number) => void
  onClose: () => void
  onSubmit: () => void
}

export default function ScriptBatchDrawer({
  open,
  count,
  maxCount,
  pendingScriptEpisodes,
  unusedPlots,
  isRunning,
  isReviewBlocked,
  onCountChange,
  onClose,
  onSubmit
}: ScriptBatchDrawerProps) {
  if (!open) return null

  const quickOptions = [2, 3, 5].filter((value, index, source) => value <= maxCount && source.indexOf(value) === index)
  const disabled = isRunning || isReviewBlocked || count <= 0

  return (
    <div className="as-batch-drawer-backdrop" onClick={onClose}>
      <div className="as-batch-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="as-section-head">
          <div className="as-focus-copy">
            <h3>批量推进剧本</h3>
            <p className="text-secondary">把批量写作收口到当前工作区里处理，不再需要跳独立页面。</p>
          </div>
          <button className="btn btn-sm" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="as-batch-drawer-grid">
          <div className="as-batch-drawer-main">
            <label className="as-batch-field">
              <span>连续生成集数</span>
              <input
                className="input"
                type="number"
                min={1}
                max={maxCount}
                value={count}
                onChange={(event) => onCountChange(Number.parseInt(event.target.value || '1', 10))}
              />
            </label>
            <div className="as-batch-quick-options">
              {quickOptions.map((value) => (
                <button
                  key={value}
                  className={`btn btn-sm ${count === value ? 'btn-primary' : ''}`}
                  onClick={() => onCountChange(value)}
                >
                  连续 {value} 集
                </button>
              ))}
            </div>
            <div className="as-batch-tips text-secondary">
              系统会沿当前可用剧情库存顺序继续出稿；单集补生成仍然建议直接在队列卡片里处理。
            </div>
          </div>

          <div className="as-batch-drawer-side">
            <div className="as-metric-card">
              <span className="task-summary-label">待补生成</span>
              <strong>{pendingScriptEpisodes}</strong>
            </div>
            <div className="as-metric-card">
              <span className="task-summary-label">可用剧情点</span>
              <strong>{unusedPlots}</strong>
            </div>
            <div className="as-metric-card">
              <span className="task-summary-label">当前上限</span>
              <strong>{maxCount}</strong>
            </div>
          </div>
        </div>

        <div className="as-batch-drawer-actions">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={disabled} onClick={onSubmit}>
            {isRunning ? '生成中...' : `开始连续生成 ${count} 集`}
          </button>
        </div>
      </div>
    </div>
  )
}
