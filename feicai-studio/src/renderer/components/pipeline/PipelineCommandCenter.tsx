import { memo } from 'react'
import type { Episode, PipelineState } from '@shared/types'
import { type WorkflowCard } from '@renderer/utils/pipeline-view'
import { DevProfiler } from '@renderer/dev/render-profiler'

interface CommandCenterPrimaryAction {
  label: string
  disabled?: boolean
  action: () => void
}

interface CommandCenterNextStep {
  label: string
  status: string
  reason: string
  state: WorkflowCard['state']
  primaryAction: CommandCenterPrimaryAction
  secondaryLabel?: string
  secondaryAction?: () => void
  openLabel?: string
  openPath?: string
}

interface StoryPipelineStep {
  id: 'novel' | 'story' | 'script'
  label: string
  description: string
  state: WorkflowCard['state']
  stateLabel: string
  primaryLabel: string
  primaryDisabled?: boolean
  primaryAction: () => void
  secondaryLabel?: string
  secondaryAction?: () => void
  reviewLabel?: string
}

interface PipelineCommandCenterProps {
  episodeNum: number
  entryLabel: string
  workflowMode: string
  currentStageLabel: string
  progress: number
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

const stateLabelMap: Record<WorkflowCard['state'], string> = {
  done: '已完成',
  active: '执行中',
  ready: '可执行',
  blocked: '被阻塞',
  skipped: '已跳过',
  warning: '需补齐'
}

function PipelineCommandCenter(props: PipelineCommandCenterProps) {
  const {
    episodeNum,
    entryLabel,
    workflowMode,
    currentStageLabel,
    progress,
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

  const hasArtifacts = [
    currentEpisode?.hasStoryBeat,
    currentEpisode?.hasStoryReview,
    currentEpisode?.hasScript,
    currentEpisode?.hasScriptReview,
    currentEpisode?.hasDirectorAnalysis,
    currentEpisode?.hasCharacterDesign,
    currentEpisode?.hasArtDesign,
    currentEpisode?.hasStoryboard || currentEpisode?.hasSeedancePrompts,
    currentEpisode?.hasStoryboardReview
  ].filter(Boolean).length
  const storyDoneCount = storyPipelineSteps.filter(
    (step) => step.state === 'done'
  ).length
  const readableState = displayIsRunning ? 'AI 正在执行' : displayState

  return (
    <DevProfiler id="PipelineCommandCenter">
      <section className="pipeline-command-center">
        <div className="command-summary">
          <div className="command-kicker">
            <span>EP{String(episodeNum).padStart(2, '0')}</span>
            <span>{entryLabel}</span>
            <span>{workflowMode || '未设置模式'}</span>
          </div>
          <h2>从小说到剧本</h2>
          <p className="text-secondary">
            当前停在「{currentStageLabel}」，先把原文、剧情和剧本走顺。
          </p>
          <div className="command-meter">
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="command-stats">
            <div>
              <span className="command-stat-label">主线完成</span>
              <strong>{storyDoneCount}/3</strong>
            </div>
            <div>
              <span className="command-stat-label">当前状态</span>
              <strong>{readableState}</strong>
            </div>
            <div>
              <span className="command-stat-label">全部产物</span>
              <strong>{hasArtifacts}/9</strong>
            </div>
          </div>
        </div>

        <div className="command-next">
          <div className="command-next-top">
            <span className="pipeline-summary-label">下一步建议</span>
            <span
              className={`command-state-chip command-state-chip--${nextStep.state}`}
            >
              {nextStep.status || stateLabelMap[nextStep.state]}
            </span>
          </div>
          <h3>{nextStep.label}</h3>
          <p className="command-next-reason">{nextStep.reason}</p>
          <div className="command-primary-actions">
            <button
              className="btn btn-primary"
              onClick={nextStep.primaryAction.action}
              disabled={nextStep.primaryAction.disabled}
            >
              {nextStep.primaryAction.label}
            </button>
            {nextStep.secondaryLabel && nextStep.secondaryAction && (
              <button className="btn" onClick={nextStep.secondaryAction}>
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
        </div>

        <div className="story-step-panel">
          {storyPipelineSteps.map((step, index) => (
            <button
              key={step.id}
              className={`story-step story-step--${step.state}`}
              onClick={step.primaryAction}
              disabled={displayIsRunning || isRunning || step.primaryDisabled}
            >
              <span className="story-step-index">{index + 1}</span>
              <div className="story-step-main">
                <div className="story-step-title-row">
                  <strong>{step.label}</strong>
                  <span
                    className={`command-state-chip command-state-chip--${step.state}`}
                  >
                    {step.stateLabel}
                  </span>
                </div>
                <p>{step.reviewLabel || step.description}</p>
                {step.reviewLabel && (
                  <span className="story-step-action-label">
                    {step.primaryLabel}
                  </span>
                )}
              </div>
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
                <button className="btn" onClick={onRetry}>
                  重试
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </DevProfiler>
  )
}

export default memo(PipelineCommandCenter)
