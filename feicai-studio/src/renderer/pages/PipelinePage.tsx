import { useEffect, useMemo, useCallback, useState, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useToastStore } from '@renderer/stores/toastStore'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  MarkerType
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import StageNode from '@renderer/components/pipeline/StageNode'
import ReviewNode from '@renderer/components/pipeline/ReviewNode'
import LogPanel from '@renderer/components/layout/LogPanel'
import EpisodeNav from '@renderer/components/layout/EpisodeNav'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import type { PipelineStage, PipelineState } from '@shared/types'
import './PipelinePage.css'

const nodeTypes: NodeTypes = {
  stage: StageNode as any,
  review: ReviewNode as any
}

const STAGES: Array<{ id: PipelineStage; label: string; emoji: string }> = [
  { id: 'director', label: '导演分析', emoji: '🎬' },
  { id: 'art', label: '服化道', emoji: '🎨' },
  { id: 'storyboard', label: '分镜编写', emoji: '📐' }
]

function isStageActive(stage: PipelineStage, state: PipelineState): boolean {
  const stateStr = state as string
  if (stage === 'director') return stateStr.startsWith('director_')
  if (stage === 'art') return stateStr.startsWith('art_')
  if (stage === 'storyboard') return stateStr.startsWith('storyboard_')
  return false
}

function isStageDone(stage: PipelineStage, state: PipelineState): boolean {
  const order = ['director', 'art', 'storyboard']
  const stageIdx = order.indexOf(stage)
  const stateStr = state as string
  if (stateStr === 'episode_complete') return true
  for (let i = stageIdx + 1; i < order.length; i++) {
    if (stateStr.startsWith(order[i] + '_') || stateStr === order[i] + '_done') return true
  }
  if (stage === 'director' && stateStr === 'director_done') return true
  if (stage === 'art' && stateStr === 'art_done') return true
  return false
}

/** 格式化秒 → mm:ss */
function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 实时计时 Hook */
function useElapsed(startedAt: number | null, running: boolean): number {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!startedAt || !running) {
      if (startedAt && !running) {
        setElapsed(Math.round((Date.now() - startedAt) / 1000))
      }
      return
    }
    const tick = () => setElapsed(Math.round((Date.now() - startedAt) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt, running])
  return elapsed
}

export default function PipelinePage() {
  useProjectSync()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  
  const {
    state, isRunning, context, setupEventListeners,
    startPipeline, stopPipeline, retryPipeline,
    skipReviewPipeline,
    pipelineStartedAt, stageTimings, currentStageName,
    resetDisplay, syncFromBackend
  } = usePipelineStore()

  // 如果没有传 ep参数，尝试使用当前正在运行或者是 engine 上一次运行的 context.episodeNum，如果没有再 fallback 到 1
  const urlEp = searchParams.get('ep')
  const episodeNum = parseInt(urlEp || (context?.episodeNum ? String(context.episodeNum) : '1'))
  const { currentProject, episodes } = useProjectStore()
  const { addToast } = useToastStore()

  const [selectedStage, setSelectedStage] = useState<PipelineStage>('director')

  // 判断当前页面查阅的集数 + 项目，是否正好是后台引擎正在处理的
  const isEngineMatch = context?.episodeNum === episodeNum &&
    context?.projectId === currentProject?.id

  // 获取本集在数据库中的持久化状态
  const epStatusFromDB = episodes.find(e => e.episodeNumber === episodeNum)?.status

  // ======= 决定页面展示的状态 =======
  // 1. 如果匹配，直接使用 store 里的实时状态
  // 2. 如果不匹配（比如引擎在跑 EP01，用户在看 EP02），则根据 DB 状态显示（只可能是 idle 或 complete，不显示 running）
  const displayState = isEngineMatch ? state : (epStatusFromDB === 'complete' ? 'episode_complete' : 'idle')
  const displayIsRunning = isEngineMatch ? isRunning : false
  const displayTimings = isEngineMatch ? stageTimings : []
  const displayCurrentStage = isEngineMatch ? currentStageName : null
  const displayStartedAt = isEngineMatch ? pipelineStartedAt : null

  // 实时计时
  const totalElapsed = useElapsed(displayStartedAt, displayIsRunning)
  const activeStage = displayTimings.find(t => t.stage === displayCurrentStage && !t.endedAt)
  const stageElapsed = useElapsed(activeStage?.startedAt || null, displayIsRunning && !!activeStage)

  // 阶段完成时发送系统通知 + Toast（仅当查看的集数匹配引擎运行集数时触发）
  useEffect(() => {
    if (!isEngineMatch) return
    if (state === 'episode_complete' && episodeNum) {
      addToast('success', `EP${String(episodeNum).padStart(2, '0')} 全流程完成！`, { title: '🎉 流水线完成' })
      try {
        new Notification('FEICAI Studio', {
          body: `EP${String(episodeNum).padStart(2, '0')} 全流程完成 ✅`,
          silent: false
        })
      } catch { /* 通知权限未授予 */ }
    }
    if (state === 'error') {
      addToast('error', '流水线执行遇到错误，请查看日志', { title: '执行出错' })
    }
  }, [state, episodeNum, isEngineMatch])

  // 跳转到下一集
  const handleNextEpisode = useCallback(() => {
    const nextEp = episodeNum + 1
    const maxEp = currentProject?.totalEpisodes || 30
    if (nextEp <= maxEp) {
      navigate(`/project/${currentProject?.id}/pipeline?ep=${nextEp}`)
    }
  }, [episodeNum, currentProject, navigate])

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey

      // Cmd+Enter: 启动全流程（如果引擎全局在跑东西就不让启动）
      if (isMeta && e.key === 'Enter' && !isRunning && currentProject) {
        e.preventDefault()
        handleStart('director', false)
      }
      // Cmd+P: 停止 (停止控制全局引擎)
      if (isMeta && e.key === 'p') {
        e.preventDefault()
        if (isRunning) stopPipeline()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isRunning, currentProject])

  useEffect(() => {
    const cleanup = setupEventListeners()
    return cleanup
  }, [])

  // 切换集数时重置显示状态并同步后端
  // 使用 ref 追踪上一次集数，仅在真正切换时才清空日志
  const prevEpRef = useRef(episodeNum)
  useEffect(() => {
    if (prevEpRef.current !== episodeNum) {
      // 集数真正变化了 → 清空 UI
      prevEpRef.current = episodeNum
      // 只有在引擎空闲时才清空 store，防止在运行期间清空全局日志
      if (!usePipelineStore.getState().isRunning) {
        resetDisplay()
      }
    }
    // 始终从后端同步当前状态（包括首次 mount）
    syncFromBackend()
  }, [episodeNum])

  // 构建 React Flow 节点
  const nodes: Node[] = useMemo(() => {
    const result: Node[] = []
    const xStart = 80
    const xGap = 200
    const yStage = 100
    const yReview = 220

    result.push({
      id: 'start',
      type: 'stage',
      position: { x: xStart - 160, y: yStage },
      data: {
        label: '剧本',
        emoji: '📖',
        stage: 'start',
        state: displayState,
        isActive: false,
        isDone: displayState !== 'idle'
      }
    })

    STAGES.forEach((stage, i) => {
      const x = xStart + i * xGap
      const timing = displayTimings.find(t => t.stage === stage.id)
      const isActive = isStageActive(stage.id, displayState)
      const isDone = isStageDone(stage.id, displayState)

      // 计算该阶段显示时间
      let timeLabel = ''
      if (timing) {
        if (timing.endedAt) {
          timeLabel = fmtTime(timing.elapsed)
        } else if (isActive && stage.id === displayCurrentStage) {
          timeLabel = fmtTime(stageElapsed)
        }
      }

      result.push({
        id: stage.id,
        type: 'stage',
        position: { x, y: yStage },
        data: {
          label: stage.label,
          emoji: stage.emoji,
          stage: stage.id,
          state: displayState,
          isActive,
          isDone,
          timeLabel
        }
      })

      const reviewForStage = (isEngineMatch ? context?.reviews : [])?.filter(r => r.stage === stage.id).pop() || null
      result.push({
        id: `review-${stage.id}`,
        type: 'review',
        position: { x: x + 24, y: yReview },
        data: {
          label: '审核',
          stage: stage.id,
          review: reviewForStage,
          isActive: (displayState as string) === `${stage.id}_reviewing`
        }
      })
    })

    return result
  }, [displayState, isEngineMatch, context, displayTimings, stageElapsed, displayCurrentStage])

  // 构建边
  const edges: Edge[] = useMemo(() => {
    const result: Edge[] = [
      {
        id: 'e-start-director',
        source: 'start',
        target: 'director',
        animated: displayState === 'script_loaded',
        style: { stroke: 'var(--color-border)' },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-border)' }
      }
    ]

    STAGES.forEach((stage, i) => {
      result.push({
        id: `e-${stage.id}-review`,
        source: stage.id,
        target: `review-${stage.id}`,
        animated: isStageActive(stage.id, displayState),
        style: { stroke: 'var(--color-border)' }
      })

      if (i < STAGES.length - 1) {
        result.push({
          id: `e-${stage.id}-${STAGES[i + 1].id}`,
          source: stage.id,
          target: STAGES[i + 1].id,
          animated: isStageDone(stage.id, displayState) && isStageActive(STAGES[i + 1].id, displayState),
          style: { stroke: 'var(--color-border)' },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-border)' }
        })
      }
    })

    return result
  }, [displayState])

  const handleStart = useCallback(
    async (startStage?: PipelineStage, singleStage?: boolean) => {
      if (!currentProject) return
      const stageLabel = startStage
        ? STAGES.find(s => s.id === startStage)?.label || startStage
        : '全流程'
      const result = await startPipeline({
        projectId: currentProject.id,
        projectPath: currentProject.projectPath,
        episodeNum,
        projectName: currentProject.name,
        visualStyle: currentProject.visualStyle,
        targetMedium: currentProject.targetMedium,
        startStage,
        singleStage
      })
      if (result.error) {
        addToast('error', result.error)
      } else {
        addToast('info', `EP${String(episodeNum).padStart(2, '0')} ${stageLabel}已启动`)
      }
    },
    [currentProject, episodeNum]
  )

  return (
    <div className="pipeline-page">
      {/* 集数卡片导航 */}
      {episodes.length > 0 && (
        <EpisodeNav
          episodes={episodes}
          currentEp={episodeNum}
          runningEp={isRunning && context?.projectId === currentProject?.id ? context?.episodeNum : undefined}
          onSelect={(ep) => navigate(`/project/${currentProject?.id}/pipeline?ep=${ep}`)}
        />
      )}

      {/* 完成横幅 */}
      {displayState === 'episode_complete' && (
        <div className="pipeline-complete-banner">
          <span>✅ EP{String(episodeNum).padStart(2, '0')} 全流程完成！{isEngineMatch && `总耗时 ${fmtTime(totalElapsed)}`}</span>
          {episodeNum < (currentProject?.totalEpisodes || 30) && (
            <button className="btn btn-primary" onClick={handleNextEpisode}>
              ▶ 开始下一集 (EP{String(episodeNum + 1).padStart(2, '0')})
            </button>
          )}
        </div>
      )}

      {/* 控制栏 */}
      <div className="pipeline-controls">
        <div className="controls-left">
          <span className="controls-episode">
            EP{String(episodeNum).padStart(2, '0')}
          </span>
          <span className="controls-state badge badge-info">{displayState}</span>
          {/* 总流程计时器 */}
          {displayStartedAt && (
            <span className="controls-timer">
              ⏱ {fmtTime(totalElapsed)}
            </span>
          )}
        </div>
        <div className="controls-center">
          {/* 阶段耗时摘要 */}
          {displayTimings.length > 0 && (
            <div className="stage-timing-summary">
              {displayTimings.map(t => {
                const stageInfo = STAGES.find(s => s.id === t.stage)
                const elapsed = t.endedAt ? t.elapsed : (t.stage === displayCurrentStage ? stageElapsed : 0)
                return (
                  <span key={t.stage} className={`timing-chip ${!t.endedAt ? 'active' : ''}`}>
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
              <button className="btn btn-primary" onClick={() => handleStart()} disabled={isRunning}>
                ▶ 执行全流程
              </button>
              <button className="btn" onClick={() => handleStart('director', true)} disabled={isRunning}>
                🎬 导演
              </button>
              <button className="btn" onClick={() => handleStart('art', true)} disabled={isRunning}>
                🎨 服化道
              </button>
              <button className="btn" onClick={() => handleStart('storyboard', true)} disabled={isRunning}>
                📐 分镜
              </button>
              {isRunning && !isEngineMatch && (
                <span className="text-secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                  引擎正在执行 EP{String(context?.episodeNum).padStart(2, '0')}，请先停止后操作。
                </span>
              )}
            </>
          ) : (
            <>
              <button className="btn btn-danger" onClick={() => { stopPipeline(); addToast('warning', '流水线已停止') }}>
                ⏹ 停止
              </button>
              {displayState.endsWith('_reviewing') && (
                <button className="btn" onClick={() => { skipReviewPipeline(); addToast('info', '已跳过当前阶段审核') }}>
                  ⏭ 跳过审核
                </button>
              )}
            </>
          )}
          {displayState === 'error' && (
            <button className="btn" onClick={() => { retryPipeline(); addToast('info', '正在重试流水线...') }}>
              ↻ 重试
            </button>
          )}
        </div>
      </div>

      {/* React Flow 画布 */}
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

      {/* 日志面板 */}
      <div className="pipeline-log-section">
        <LogPanel isEngineMatch={isEngineMatch} />
      </div>
    </div>
  )
}
