import { memo } from 'react'
import {
  AUTO_STAGES,
  fmtTime,
  type AutomatedStageAvailabilityMap
} from '@renderer/utils/pipeline-view'
import type { AutomatedPipelineStage, PipelineState } from '@shared/types'
import { DevProfiler } from '@renderer/dev/render-profiler'

interface StageTiming {
  stage: AutomatedPipelineStage
  startedAt: number
  endedAt?: number
  elapsed: number
}

interface PipelineControlBarProps {
  episodeNum: number
  displayState: PipelineState
  displayStartedAt: number | null
  totalElapsed: number
  displayTimings: StageTiming[]
  displayCurrentStage: AutomatedPipelineStage | null
  stageElapsed: number
  displayIsRunning: boolean
  isRunning: boolean
  stageAvailability: AutomatedStageAvailabilityMap
  onStart: (stage?: AutomatedPipelineStage, singleStage?: boolean) => void
  onStop: () => void
  onSkipReview: () => void
  onRetry: () => void
}

function PipelineControlBar(props: PipelineControlBarProps) {
  const {
    episodeNum,
    displayState,
    displayStartedAt,
    totalElapsed,
    displayTimings,
    displayCurrentStage,
    stageElapsed,
    displayIsRunning,
    isRunning,
    stageAvailability,
    onStart,
    onStop,
    onSkipReview,
    onRetry
  } = props

  return (
    <DevProfiler id="PipelineControlBar">
      <div className="pipeline-controls">
        <div className="controls-left">
          <span className="controls-episode">
            EP{String(episodeNum).padStart(2, '0')}
          </span>
          <span className="controls-state badge badge-info">
            {displayState}
          </span>
          {displayStartedAt && (
            <span className="controls-timer">⏱ {fmtTime(totalElapsed)}</span>
          )}
        </div>
        <div className="controls-center">
          {displayTimings.length > 0 && (
            <div className="stage-timing-summary">
              {displayTimings.map((t) => {
                const stageInfo = AUTO_STAGES.find((s) => s.id === t.stage)
                const elapsed = t.endedAt
                  ? t.elapsed
                  : t.stage === displayCurrentStage
                    ? stageElapsed
                    : 0
                return (
                  <span
                    key={t.stage}
                    className={`timing-chip ${!t.endedAt ? 'active' : ''}`}
                  >
                    {stageInfo?.emoji} {fmtTime(elapsed)}
                  </span>
                )
              })}
            </div>
          )}
        </div>
        <div className="controls-right">
          {!displayIsRunning ? (
            <>
              <button
                className="btn btn-primary"
                onClick={() => onStart()}
                disabled={isRunning || !stageAvailability.director.canStart}
              >
                ▶ 执行自动化段
              </button>
              <button
                className="btn"
                onClick={() => onStart('director', true)}
                disabled={isRunning || !stageAvailability.director.canStart}
              >
                🎬 导演
              </button>
              <button
                className="btn"
                onClick={() => onStart('art', true)}
                disabled={isRunning || !stageAvailability.art.canStart}
              >
                🎨 服化道
              </button>
              <button
                className="btn"
                onClick={() => onStart('storyboard', true)}
                disabled={isRunning || !stageAvailability.storyboard.canStart}
              >
                📐 分镜
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-danger" onClick={onStop}>
                ⏹ 停止
              </button>
              {displayState.endsWith('_reviewing') && (
                <button className="btn" onClick={onSkipReview}>
                  ⏭ 跳过审核
                </button>
              )}
            </>
          )}
          {displayState === 'error' && (
            <button className="btn" onClick={onRetry}>
              ↻ 重试
            </button>
          )}
        </div>
      </div>
    </DevProfiler>
  )
}

export default memo(PipelineControlBar)
