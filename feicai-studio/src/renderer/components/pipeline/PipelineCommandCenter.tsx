import { memo, useId } from 'react'
import type { Episode, PipelineState, ProjectEntryStage } from '@shared/types'
import { type WorkflowCard } from '@renderer/utils/pipeline-view'
import { DevProfiler } from '@renderer/dev/render-profiler'
import {
  FLOW_STATE_LABELS,
  getCommandProgress,
  getEntryPresentation,
  getWorkflowModeLabel,
  type StoryPipelineStep
} from './command-center-view'

interface CommandCenterNextStep {
  label: string
  status: string
  reason: string
  state: WorkflowCard['state']
  primaryAction: {
    label: string
    disabled?: boolean
    action: () => void
  }
  secondaryLabel?: string
  secondaryDisabled?: boolean
  secondaryAction?: () => void
  openLabel?: string
  openPath?: string
}

interface PipelineCommandCenterProps {
  episodeNum: number
  entryStage: ProjectEntryStage
  entryLabel: string
  workflowMode: string
  currentStageLabel: string
  displayState: PipelineState
  displayIsRunning: boolean
  isRunning: boolean
  currentEpisode: Episode | undefined
  nextStep: CommandCenterNextStep
  storyPipelineSteps: StoryPipelineStep[]
  onStop: () => void
  onRetry: () => void
  onOpen: (path: string) => void
}

function PipelineCommandCenter(props: PipelineCommandCenterProps) {
  const {
    episodeNum,
    entryStage,
    entryLabel,
    workflowMode,
    currentStageLabel,
    displayState,
    displayIsRunning,
    isRunning,
    currentEpisode,
    nextStep,
    storyPipelineSteps,
    onStop,
    onRetry,
    onOpen
  } = props
  const id = useId()
  const presentation = getEntryPresentation(entryStage)
  const progress = getCommandProgress(storyPipelineSteps)
  const reviewCount = [
    entryStage !== 'script' && currentEpisode?.hasStoryReview,
    currentEpisode?.hasScriptReview
  ].filter(Boolean).length
  const readableState =
    displayIsRunning || nextStep.state === 'active'
      ? '正在执行'
      : isRunning
        ? '其他任务执行中'
        : displayState === 'error'
          ? '执行失败'
          : displayState === 'paused'
            ? '已暂停'
            : nextStep.status || FLOW_STATE_LABELS[nextStep.state]

  return (
    <DevProfiler id="PipelineCommandCenter">
      <section
        className="pipeline-command-center"
        aria-labelledby={`${id}-title`}
      >
        <div className="command-summary">
          <div className="command-kicker">
            <span>EP{String(episodeNum).padStart(2, '0')}</span>
            <span>{entryLabel}</span>
            <span>{getWorkflowModeLabel(workflowMode)}</span>
          </div>
          <h2 id={`${id}-title`}>{presentation.title}</h2>
          <p className="text-secondary">{presentation.description}</p>
          <p className="text-secondary">当前阶段：{currentStageLabel}</p>
          <div
            className="command-meter"
            role="progressbar"
            aria-label="剧本准备进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.percent}
            aria-valuetext={`${progress.completed} / ${progress.total} 个适用阶段已就绪；剧情和剧本需通过当前有效审核`}
          >
            <span style={{ width: `${progress.percent}%` }} />
          </div>
          <div className="command-stats">
            <div>
              <span className="command-stat-label">主线就绪</span>
              <strong>
                {progress.completed}/{progress.total}
              </strong>
            </div>
            <div>
              <span className="command-stat-label">当前状态</span>
              <strong role="status">{readableState}</strong>
            </div>
            <div>
              <span className="command-stat-label">主线有效审核</span>
              <strong>
                {reviewCount}/{entryStage === 'script' ? 1 : 2}
              </strong>
            </div>
          </div>
        </div>

        <section className="command-next" aria-labelledby={`${id}-next-title`}>
          <div className="command-next-top">
            <span className="pipeline-summary-label">下一步建议</span>
            <span
              className={`command-state-chip command-state-chip--${nextStep.state}`}
            >
              {nextStep.status || FLOW_STATE_LABELS[nextStep.state]}
            </span>
          </div>
          <h3 id={`${id}-next-title`}>{nextStep.label}</h3>
          <p id={`${id}-next-reason`} className="command-next-reason">
            {nextStep.reason}
          </p>
          <div className="command-primary-actions">
            <button
              className="btn btn-primary"
              onClick={nextStep.primaryAction.action}
              disabled={nextStep.primaryAction.disabled}
              aria-describedby={`${id}-next-reason`}
            >
              {nextStep.primaryAction.label}
            </button>
            {nextStep.secondaryLabel && nextStep.secondaryAction && (
              <button
                className="btn"
                onClick={nextStep.secondaryAction}
                disabled={nextStep.secondaryDisabled}
              >
                {nextStep.secondaryLabel}
              </button>
            )}
            {nextStep.openPath && (
              <button
                className="btn"
                onClick={() => onOpen(nextStep.openPath!)}
              >
                {nextStep.openLabel || '打开产物'}
              </button>
            )}
          </div>
        </section>

        <section
          className="story-step-panel"
          aria-label="剧本准备阶段"
          style={
            {
              '--story-step-count': storyPipelineSteps.length
            } as React.CSSProperties
          }
        >
          {storyPipelineSteps.map((step, index) => (
            <button
              key={step.id}
              className={`story-step story-step--${step.state}`}
              onClick={step.primaryAction}
              disabled={displayIsRunning || isRunning || step.primaryDisabled}
              aria-label={`${step.label}：${step.primaryLabel}`}
              aria-describedby={`${id}-${step.id}-status ${id}-${step.id}-description`}
            >
              <span className="story-step-index" aria-hidden="true">
                {index + 1}
              </span>
              <span className="story-step-main">
                <span className="story-step-title-row">
                  <strong>{step.label}</strong>
                  <span
                    id={`${id}-${step.id}-status`}
                    className={`command-state-chip command-state-chip--${step.state}`}
                  >
                    {step.stateLabel}
                  </span>
                </span>
                <span
                  id={`${id}-${step.id}-description`}
                  className="story-step-description"
                >
                  {step.description}
                </span>
                <span className="story-step-action-label">
                  {step.primaryLabel}
                </span>
              </span>
            </button>
          ))}
          {(displayIsRunning || displayState === 'error') && (
            <div className="story-step-footer">
              {displayIsRunning && (
                <button className="btn btn-danger" onClick={onStop}>
                  停止当前任务
                </button>
              )}
              {displayState === 'error' && (
                <button className="btn" onClick={onRetry} disabled={isRunning}>
                  重试上次流水线任务
                </button>
              )}
            </div>
          )}
        </section>
      </section>
    </DevProfiler>
  )
}

export default memo(PipelineCommandCenter)
