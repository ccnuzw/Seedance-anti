import { memo } from 'react'
import type {
  WorkflowCard,
  WorkflowCardActionMeta
} from '@renderer/utils/pipeline-view'
import { DevProfiler } from '@renderer/dev/render-profiler'

interface WorkflowBoardProps {
  cards: WorkflowCard[]
  getCardClass: (state: WorkflowCard['state']) => string
  actionMetaMap: Record<WorkflowCard['id'], WorkflowCardActionMeta>
  onOpen: (path: string) => void
}

function WorkflowBoard(props: WorkflowBoardProps) {
  const { cards, getCardClass, actionMetaMap, onOpen } = props

  return (
    <DevProfiler id="WorkflowBoard">
      <div className="pipeline-flow-panel">
        <div className="pipeline-section-header">
          <div>
            <h3>全链路流程</h3>
            <p className="text-secondary">
              展示从小说到导出的完整 FEICAI Studio
              流程。黄色表示已跨过但缺少标准产物，建议补齐。
            </p>
          </div>
        </div>
        <div className="workflow-board">
          {cards.map((card) => {
            const actionMeta = actionMetaMap[card.id]
            const cardClass = `${getCardClass(card.state)} ${actionMeta.openPath ? 'flow-card--interactive' : ''}`
            return (
              <div
                key={card.id}
                className={cardClass}
                onClick={() =>
                  actionMeta.openPath && onOpen(actionMeta.openPath)
                }
              >
                <div className="flow-card-top">
                  <span className="flow-card-emoji">{card.emoji}</span>
                  <span className="flow-card-mode">
                    {card.mode === 'automation'
                      ? '自动'
                      : card.mode === 'gate'
                        ? '门槛'
                        : card.mode === 'manual'
                          ? '补齐'
                          : card.mode === 'final'
                            ? '终态'
                            : '源头'}
                  </span>
                </div>
                <div className="flow-card-title">{card.label}</div>
                <div className="flow-card-hint">{card.hint}</div>
                <div
                  className={`flow-card-state flow-card-state--${card.state}`}
                >
                  {card.state === 'done' && '已完成'}
                  {card.state === 'active' && '执行中'}
                  {card.state === 'ready' && '可进入'}
                  {card.state === 'blocked' && '未开放'}
                  {card.state === 'skipped' && '已跳过'}
                  {card.state === 'warning' && '待补齐'}
                </div>
                <div className="flow-card-note text-secondary">{card.note}</div>
                {card.summaryLines.length > 0 && (
                  <div className="flow-card-summary">
                    {card.summaryLines.slice(0, 2).map((line, index) => (
                      <div
                        key={`${card.id}-${index}`}
                        className="flow-card-summary-line"
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                )}
                <div
                  className="flow-card-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="btn btn-sm"
                    onClick={actionMeta.primaryAction}
                    disabled={actionMeta.primaryDisabled}
                  >
                    {actionMeta.primaryLabel}
                  </button>
                  {actionMeta.secondaryLabel && actionMeta.secondaryAction && (
                    <button
                      className="btn btn-sm"
                      onClick={actionMeta.secondaryAction}
                      disabled={actionMeta.secondaryDisabled}
                    >
                      {actionMeta.secondaryLabel}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </DevProfiler>
  )
}

export default memo(WorkflowBoard)
