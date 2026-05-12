import type { ReactNode } from 'react'
import type { Episode } from '@shared/types'
import EpisodeNav from '@renderer/components/layout/EpisodeNav'
import DocumentEditorShell from './DocumentEditorShell'
import DocumentEditorToolbar from './DocumentEditorToolbar'

export type DocumentWorkflowStepState =
  | 'done'
  | 'active'
  | 'ready'
  | 'blocked'
  | 'warning'

export interface DocumentWorkflowStep {
  id: string
  label: string
  description: string
  state: DocumentWorkflowStepState
  stateLabel: string
}

export interface DocumentWorkflowAction {
  label: string
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'default' | 'danger'
}

export interface DocumentWorkflowCommand {
  title: string
  description: string
  steps: DocumentWorkflowStep[]
  primaryAction?: DocumentWorkflowAction
  secondaryActions?: DocumentWorkflowAction[]
}

interface DocumentWorkflowPageProps {
  title: string
  lineCount: number
  description: string
  saved: boolean
  toolbarActions: ReactNode
  content: string
  onContentChange: (value: string) => void
  episodes?: Episode[]
  currentEp?: number
  onEpisodeSelect?: (ep: number) => void
  isEpisodeDone?: (episode: Episode) => boolean
  reviewPanel?: ReactNode
  sidePanel?: ReactNode
  workflow?: DocumentWorkflowCommand
  toolbarVariant?: 'default' | 'source'
}

export default function DocumentWorkflowPage(props: DocumentWorkflowPageProps) {
  const {
    title,
    lineCount,
    description,
    saved,
    toolbarActions,
    content,
    onContentChange,
    episodes,
    currentEp,
    onEpisodeSelect,
    isEpisodeDone,
    reviewPanel,
    sidePanel,
    workflow,
    toolbarVariant = 'default'
  } = props

  const showEpisodeNav = episodes && currentEp !== undefined && onEpisodeSelect
  const hasSidePanel = !!sidePanel
  const toButtonClassName = (action: DocumentWorkflowAction) =>
    action.variant === 'primary'
      ? 'btn btn-primary'
      : action.variant === 'danger'
        ? 'btn btn-danger'
        : 'btn'

  return (
    <div className="script-editor-page">
      {showEpisodeNav && (
        <EpisodeNav
          episodes={episodes}
          currentEp={currentEp}
          onSelect={onEpisodeSelect}
          isDone={isEpisodeDone}
        />
      )}

      <div
        className={`document-workflow-layout${hasSidePanel ? ' has-side-panel' : ''}`}
      >
        {sidePanel && (
          <aside className="document-workflow-side-panel">{sidePanel}</aside>
        )}

        <main className="document-workflow-main">
          <div className={`document-toolbar-frame is-${toolbarVariant}`}>
            <DocumentEditorToolbar
              title={title}
              lineCount={lineCount}
              description={description}
              saved={saved}
              actions={toolbarActions}
            />
          </div>

          <DocumentEditorShell content={content} onChange={onContentChange} />
        </main>

        {(workflow || reviewPanel) && (
          <aside className="document-workflow-command-sidebar">
            {workflow && (
              <section className="document-command-panel">
                <div className="document-command-copy">
                  <h2>{workflow.title}</h2>
                  <p>{workflow.description}</p>
                </div>
                <div className="document-command-steps">
                  {workflow.steps.map((step, index) => (
                    <div
                      key={step.id}
                      className={`document-command-step document-command-step--${step.state}`}
                    >
                      <span className="document-command-step-index">
                        {index + 1}
                      </span>
                      <div>
                        <div className="document-command-step-title">
                          <strong>{step.label}</strong>
                          <span>{step.stateLabel}</span>
                        </div>
                        <p>{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {(workflow.primaryAction ||
                  (workflow.secondaryActions &&
                    workflow.secondaryActions.length > 0)) && (
                  <div className="document-command-actions">
                    {workflow.primaryAction && (
                      <button
                        className={toButtonClassName({
                          ...workflow.primaryAction,
                          variant: workflow.primaryAction.variant || 'primary'
                        })}
                        onClick={workflow.primaryAction.onClick}
                        disabled={workflow.primaryAction.disabled}
                      >
                        {workflow.primaryAction.label}
                      </button>
                    )}
                    {workflow.secondaryActions?.map((action) => (
                      <button
                        key={action.label}
                        className={toButtonClassName(action)}
                        onClick={action.onClick}
                        disabled={action.disabled}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}

            {reviewPanel}
          </aside>
        )}
      </div>
    </div>
  )
}
