import { memo } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  type NodeTypes
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import EpisodeNav from '@renderer/components/layout/EpisodeNav'
import LogPanel from '@renderer/components/layout/LogPanel'
import PipelineRunDetailPanel from '@renderer/components/pipeline/PipelineRunDetailPanel'
import PipelineRunList from '@renderer/components/pipeline/PipelineRunList'
import ReviewNode from '@renderer/components/pipeline/ReviewNode'
import StageNode from '@renderer/components/pipeline/StageNode'
import { STAGES, fmtTime } from '@renderer/components/pipeline/pipelineWorkspaceView'
import { usePipelineWorkspace } from '@renderer/hooks/usePipelineWorkspace'
import './PipelinePage.css'

const nodeTypes: NodeTypes = {
  stage: StageNode as never,
  review: ReviewNode as never
}

const PipelineCanvas = memo(function PipelineCanvas({
  nodes,
  edges
}: {
  nodes: React.ComponentProps<typeof ReactFlow>['nodes']
  edges: React.ComponentProps<typeof ReactFlow>['edges']
}) {
  return (
    <div className="pipeline-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ maxZoom: 1.2, padding: 0.05 }}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { strokeWidth: 2 }
        }}
      >
        <Background color="var(--color-border-subtle)" gap={20} size={1} />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  )
})

export default function PipelinePage() {
  const {
    currentProject,
    episodes,
    context,
    state,
    displayState,
    displayIsRunning,
    displayTimings,
    displayCurrentStage,
    isEngineMatch,
    isPaused,
    engineOccupied,
    episodeNum,
    isEpisodeSelectable,
    totalElapsed,
    stageElapsedMap,
    nodes,
    edges,
    recentRuns,
    selectedRunId,
    selectedRun,
    selectedRunLogs,
    selectedRunLLMCalls,
    runDetailLoading,
    handleStart,
    handlePause,
    handleResume,
    handleStop,
    handleSkipReview,
    handleRetry,
    handleNextEpisode,
    handleSelectEpisode,
    handleSelectRun,
    handleResumeBackground,
    handleStopBackground
  } = usePipelineWorkspace()

  return (
    <div className="pipeline-page">
      {episodes.length > 0 && (
        <EpisodeNav
          episodes={episodes}
          currentEp={episodeNum}
          runningEp={engineOccupied && context?.projectId === currentProject?.id ? context?.episodeNum : undefined}
          onSelect={handleSelectEpisode}
        />
      )}

      {displayState === 'episode_complete' && (
        <div className="pipeline-complete-banner">
          <span>✅ EP{String(episodeNum).padStart(3, '0')} 全流程完成！{isEngineMatch && `总耗时 ${fmtTime(totalElapsed)}`}</span>
          {episodeNum < (currentProject?.totalEpisodes || 30) && (
            <button className="btn btn-primary" onClick={handleNextEpisode}>
              ▶ 开始下一集 (EP{String(episodeNum + 1).padStart(3, '0')})
            </button>
          )}
        </div>
      )}

      <div className="pipeline-controls">
        <div className="controls-left">
          <span className="controls-episode">EP{String(episodeNum).padStart(3, '0')}</span>
          <span className="controls-state badge badge-info">{displayState}</span>
          {displayTimings.length > 0 && (
            <span className="controls-timer">⏱ {fmtTime(totalElapsed)}</span>
          )}
        </div>

        <div className="controls-center">
          {!isEpisodeSelectable && (
            <div className="text-secondary text-xs">
              当前 URL 指向的 EP{String(episodeNum).padStart(3, '0')} 不存在，无法启动流程。
            </div>
          )}
          {displayTimings.length > 0 && (
            <div className="stage-timing-summary">
              {STAGES.filter((stage) => stageElapsedMap[stage.id] > 0).map((stage) => (
                <span key={stage.id} className={`timing-chip ${stage.id === displayCurrentStage && displayIsRunning ? 'active' : ''}`}>
                  {stage.emoji} {fmtTime(stageElapsedMap[stage.id])}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="controls-right">
          {displayIsRunning ? (
            <>
              <button className="btn" onClick={() => void handlePause()}>
                ⏸ 暂停
              </button>
              <button className="btn btn-danger" onClick={() => void handleStop()}>
                ⏹ 停止
              </button>
              {displayState.endsWith('_reviewing') && (
                <button className="btn" onClick={() => void handleSkipReview()}>
                  ⏭ 跳过审核
                </button>
              )}
            </>
          ) : isPaused ? (
            <>
              <button className="btn btn-primary" onClick={() => void handleResume()}>
                ▶ 恢复
              </button>
              <button className="btn btn-danger" onClick={() => void handleStop()}>
                ⏹ 停止
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-primary" onClick={() => void handleStart()} disabled={engineOccupied || !isEpisodeSelectable}>
                ▶ 执行全流程
              </button>
              <button className="btn" onClick={() => void handleStart('director', true)} disabled={engineOccupied || !isEpisodeSelectable}>
                🎬 导演
              </button>
              <button className="btn" onClick={() => void handleStart('art', true)} disabled={engineOccupied || !isEpisodeSelectable}>
                🎨 服化道
              </button>
              <button className="btn" onClick={() => void handleStart('storyboard', true)} disabled={engineOccupied || !isEpisodeSelectable}>
                📐 分镜
              </button>
              {engineOccupied && !isEngineMatch && (
                <>
                  <span className="text-secondary text-xs ml-sm">
                    引擎正在处理 EP{String(context?.episodeNum ?? 0).padStart(3, '0')}，请先恢复或停止当前任务。
                  </span>
                  {state === 'paused' && (
                    <button className="btn btn-sm" onClick={() => void handleResumeBackground()}>
                      ▶ 恢复后台任务
                    </button>
                  )}
                  <button className="btn btn-danger btn-sm" onClick={() => void handleStopBackground()}>
                    ⏹ 停止后台任务
                  </button>
                </>
              )}
            </>
          )}
          {displayState === 'error' && (
            <button className="btn" onClick={() => void handleRetry()}>
              ↻ 重试
            </button>
          )}
        </div>
      </div>

      <PipelineCanvas nodes={nodes} edges={edges} />

      <PipelineRunList
        runs={recentRuns}
        selectedRunId={selectedRunId}
        currentRunId={context?.runId}
        onSelectRun={handleSelectRun}
      />

      <PipelineRunDetailPanel
        selectedRun={selectedRun}
        selectedRunLogs={selectedRunLogs}
        selectedRunLLMCalls={selectedRunLLMCalls}
        runDetailLoading={runDetailLoading}
      />

      <div className="pipeline-log-section">
        <LogPanel isEngineMatch={isEngineMatch} />
      </div>
    </div>
  )
}
