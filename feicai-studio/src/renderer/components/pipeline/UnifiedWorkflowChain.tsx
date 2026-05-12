import { memo } from 'react'
import type {
  WorkflowCard,
  WorkflowCardActionMeta
} from '@renderer/utils/pipeline-view'
import { DevProfiler } from '@renderer/dev/render-profiler'

interface UnifiedWorkflowChainProps {
  cards: WorkflowCard[]
  actionMetaMap: Record<WorkflowCard['id'], WorkflowCardActionMeta>
  onOpen: (path: string) => void
}

const STATE_LABELS: Record<WorkflowCard['state'], string> = {
  done: '已完成',
  active: '执行中',
  ready: '可执行',
  blocked: '未开放',
  skipped: '已跳过',
  warning: '需补齐'
}

const MODE_LABELS: Record<WorkflowCard['mode'], string> = {
  source: '源头',
  gate: '审核',
  manual: '补齐',
  automation: '制作',
  final: '完成'
}

function UnifiedWorkflowChain(props: UnifiedWorkflowChainProps) {
  const { cards, actionMetaMap, onOpen } = props

  return (
    <DevProfiler id="UnifiedWorkflowChain">
      <section className="unified-chain-panel">
        <div className="unified-chain-header">
          <div>
            <h3>完整制作链</h3>
            <p className="text-secondary">
              所有前置条件、审核、生成和后续制作都在同一条链路里处理。
            </p>
          </div>
        </div>

        <div className="unified-chain-list">
          {cards.map((card, index) => {
            const actionMeta = actionMetaMap[card.id]
            return (
              <article
                key={card.id}
                className={`unified-chain-row unified-chain-row--${card.state}`}
              >
                <div className="unified-chain-index">
                  {String(index + 1).padStart(2, '0')}
                </div>

                <div className="unified-chain-body">
                  <div className="unified-chain-title-row">
                    <div className="unified-chain-title">
                      <span>{card.emoji}</span>
                      <strong>{card.label}</strong>
                    </div>
                    <div className="unified-chain-badges">
                      <span className="unified-chain-mode">
                        {MODE_LABELS[card.mode]}
                      </span>
                      <span
                        className={`unified-chain-state unified-chain-state--${card.state}`}
                      >
                        {STATE_LABELS[card.state]}
                      </span>
                    </div>
                  </div>

                  <p className="unified-chain-note">{card.note}</p>

                  {card.summaryLines.length > 0 && (
                    <div className="unified-chain-facts">
                      {card.summaryLines.slice(0, 3).map((line, lineIndex) => (
                        <span key={`${card.id}-${lineIndex}`}>{line}</span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="unified-chain-actions">
                  <button
                    className="btn btn-sm btn-primary"
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
                  {actionMeta.openPath && (
                    <button
                      className="btn btn-sm"
                      onClick={() => onOpen(actionMeta.openPath!)}
                    >
                      {actionMeta.openLabel}
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </DevProfiler>
  )
}

export default memo(UnifiedWorkflowChain)
