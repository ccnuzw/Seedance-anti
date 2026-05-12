import { memo } from 'react'
import { DevProfiler } from '@renderer/dev/render-profiler'

interface PromptHeaderProps {
  currentEp: number
  promptCount: number
  totalDuration: number
  durationOk: boolean
  isEditing: boolean
  canEdit: boolean
  runningStoryboardReview: boolean
  onStartEditing: () => void
  onRunStoryboardReview: () => void
  onReReview: () => void
  onSave: () => void
  onCancel: () => void
}

function PromptHeader(props: PromptHeaderProps) {
  const {
    currentEp,
    promptCount,
    totalDuration,
    durationOk,
    isEditing,
    canEdit,
    runningStoryboardReview,
    onStartEditing,
    onRunStoryboardReview,
    onReReview,
    onSave,
    onCancel
  } = props

  return (
    <DevProfiler id="PromptHeader">
      <div className="prompt-header">
        <div className="prompt-header-info">
          <h2>📐 EP{String(currentEp).padStart(2, '0')} 提示词</h2>
          <div className="prompt-stats text-secondary">
            {promptCount} 条提示词
          </div>
        </div>
        <div className="prompt-actions">
          {!isEditing ? (
            <>
              <button
                className="btn btn-sm"
                onClick={onStartEditing}
                disabled={!canEdit}
              >
                ✏️ 编辑
              </button>
              <button
                className="btn btn-sm"
                onClick={onRunStoryboardReview}
                disabled={!canEdit || runningStoryboardReview}
              >
                {runningStoryboardReview ? '⏳ 审核中...' : '🔍 分镜审核'}
              </button>
              <button
                className="btn btn-sm"
                onClick={onReReview}
                disabled={!canEdit}
              >
                🔄 重新审核
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-sm btn-primary" onClick={onSave}>
                💾 保存
              </button>
              <button className="btn btn-sm" onClick={onCancel}>
                ❌ 取消
              </button>
            </>
          )}
        </div>
        <div className="prompt-duration-bar">
          <div className="duration-label">
            <span className={durationOk ? 'text-success' : 'text-warning'}>
              ⏱ {totalDuration}s
            </span>
            <span className="text-secondary"> / 90-120s</span>
          </div>
          <div className="duration-track">
            <div
              className={`duration-fill ${durationOk ? 'ok' : 'warn'}`}
              style={{
                width: `${Math.min((totalDuration / 120) * 100, 100)}%`
              }}
            />
            <div className="duration-marker" style={{ left: '75%' }} />
            <div className="duration-marker" style={{ left: '100%' }} />
          </div>
        </div>
      </div>
    </DevProfiler>
  )
}

export default memo(PromptHeader)
