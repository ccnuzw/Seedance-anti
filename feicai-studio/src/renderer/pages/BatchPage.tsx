import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { abortPipeline } from '@renderer/services/pipeline-service'
import { useBatchStore } from '@renderer/stores/batchStore'
import { useProjectStore } from '@renderer/stores/projectStore'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { useToastStore } from '@renderer/stores/toastStore'
import { isEpisodeComplete } from '@shared/episode-status'
import { useShallow } from 'zustand/react/shallow'
import {
  MODE_MAP,
  type BatchMode,
  isAutoSelectBatchMode,
  resolveBatchExecutionEpisodes
} from '@shared/batch'
import { getPlotBreakdownSummary } from '@renderer/services/project-service'
import type { PlotBreakdownSummary } from '@shared/ipc-contracts'
import './BatchPage.css'

const MAX_RENDERED_LOGS = 200
const AUTO_SCROLL_THROTTLE_MS = 240

const MODE_GROUPS: Array<{
  title: string
  description: string
  modes: BatchMode[]
}> = [
  {
    title: '智能调度',
    description: '按当前水位决定下一步，适合日常推进。',
    modes: ['smart_next', 'full']
  },
  {
    title: '剧情库存',
    description: '围绕小说拆解、剧情批次和审核补齐库存。',
    modes: ['story', 'story_review', 'story_until_ready', 'story_until_done']
  },
  {
    title: '剧本生产',
    description: '把已通过的剧情库存转成剧本并完成审核。',
    modes: ['preproduction', 'script', 'script_review', 'script_until_empty']
  },
  {
    title: '后续制作',
    description: '剧本通过后进入导演、服化道和分镜制作。',
    modes: ['director', 'art', 'storyboard']
  }
]

const MODE_DESCRIPTIONS: Record<BatchMode, string> = {
  smart_next: '自动判断当前水位，只执行最应该推进的一步。',
  preproduction: '优先生成剧本；缺少剧情库存时会先补拆解和审核。',
  story_until_ready: '持续拆解，直到剧情库存达到可进入剧本的水位。',
  story_until_done: '持续拆解，直到未处理章节全部进入剧情库存。',
  script_until_empty: '把当前可用的剧情库存持续转成剧本。',
  story: '为选中集生成一批剧情拆解草稿。',
  story_review: '审核选中集当前剧情批次。',
  script: '基于已通过剧情拆解生成剧本。',
  script_review: '审核选中集当前剧本。',
  full: '制作流程（导演→服化道→分镜），生成经审核的视频提示词，不生成图片或视频媒体。',
  director: '只执行导演分析阶段。',
  art: '只执行服化道设计阶段。',
  storyboard: '只执行分镜编写阶段。'
}

function formatEpisodeList(nums: number[]): string {
  if (nums.length === 0) return '暂无'
  const head = nums
    .slice(0, 6)
    .map((num) => `EP${String(num).padStart(2, '0')}`)
  return nums.length > head.length
    ? `${head.join('、')} 等 ${nums.length} 集`
    : head.join('、')
}

export default function BatchPage() {
  const [searchParams] = useSearchParams()
  const { currentProject, episodes } = useProjectStore(
    useShallow((s) => ({
      currentProject: s.currentProject,
      episodes: s.episodes
    }))
  )
  const {
    logs,
    streamBuffer,
    setupEventListeners,
    clearLogs,
    pipelineRunning,
    syncFromBackend
  } = usePipelineStore(
    useShallow((s) => ({
      logs: s.logs,
      streamBuffer: s.streamBuffer,
      setupEventListeners: s.setupEventListeners,
      clearLogs: s.clearLogs,
      pipelineRunning: s.isRunning,
      syncFromBackend: s.syncFromBackend
    }))
  )
  const { addToast } = useToastStore()

  const [mode, setMode] = useState<BatchMode>('full')
  const [selectedEps, setSelectedEps] = useState<Set<number>>(new Set())
  const {
    snapshot,
    commandPending,
    connect,
    start,
    stop,
    pause,
    resume,
    error: queueError
  } = useBatchStore()
  const tasks = snapshot?.tasks || []
  const isRunning =
    !!snapshot && ['running', 'paused', 'stopping'].includes(snapshot.status)
  const [episodePage, setEpisodePage] = useState(0)
  const [taskPage, setTaskPage] = useState(0)
  const pageSize = 100
  const [logExpanded, setLogExpanded] = useState(true)
  const [plotBreakdownSummary, setPlotBreakdownSummary] =
    useState<PlotBreakdownSummary | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const lastScrollAtRef = useRef(0)

  // 设置管道事件监听（接收日志）
  useEffect(() => {
    const cleanup = setupEventListeners()
    return cleanup
  }, [setupEventListeners])

  useEffect(() => connect(), [connect])

  useEffect(() => {
    if (
      snapshot &&
      ['running', 'paused', 'stopping', 'interrupted'].includes(snapshot.status)
    ) {
      setMode(snapshot.mode)
    }
  }, [snapshot?.id, snapshot?.status])

  useEffect(() => {
    if (!currentProject) {
      setPlotBreakdownSummary(null)
      return
    }
    void getPlotBreakdownSummary(currentProject.id)
      .then(setPlotBreakdownSummary)
      .catch(() => setPlotBreakdownSummary(null))
  }, [currentProject?.id])

  useEffect(() => {
    const modeParam = searchParams.get('mode')
    const episodesParam = searchParams.get('episodes')
    if (modeParam && modeParam in MODE_MAP) {
      setMode(modeParam as BatchMode)
    }
    if (episodesParam) {
      const next = new Set(
        episodesParam
          .split(',')
          .map((item) => Number(item))
          .filter((num) => Number.isInteger(num) && num > 0)
      )
      if (next.size > 0) {
        setSelectedEps(next)
      }
    }
  }, [searchParams])

  // mount 时同步后端状态，检测是否有后台任务在运行
  const [bgRunning, setBgRunning] = useState(false)
  useEffect(() => {
    void syncFromBackend().then(() =>
      setBgRunning(usePipelineStore.getState().isRunning)
    )
  }, [syncFromBackend])

  // 当全局引擎状态变为非运行时，清除 bgRunning 提示
  useEffect(() => {
    if (!pipelineRunning) setBgRunning(false)
  }, [pipelineRunning])

  // 自动滚动到最新日志
  useEffect(() => {
    if (!logExpanded) return
    const now = Date.now()
    if (now - lastScrollAtRef.current < AUTO_SCROLL_THROTTLE_MS) return
    lastScrollAtRef.current = now
    logsEndRef.current?.scrollIntoView({
      behavior: streamBuffer ? 'auto' : 'smooth',
      block: 'end'
    })
  }, [logs.length, streamBuffer, logExpanded])

  const visibleLogs = useMemo(
    () =>
      logs.length > MAX_RENDERED_LOGS ? logs.slice(-MAX_RENDERED_LOGS) : logs,
    [logs]
  )
  const hiddenLogCount = logs.length - visibleLogs.length
  const selectedModeConfig = MODE_MAP[mode]
  const autoMode = isAutoSelectBatchMode(mode)
  const selectedEpisodeNumbers = useMemo(
    () => [...selectedEps].sort((a, b) => a - b),
    [selectedEps]
  )
  const previewEpisodes = useMemo(
    () =>
      resolveBatchExecutionEpisodes({
        mode,
        selectedEpisodes: selectedEpisodeNumbers,
        allEpisodes: episodes.map((episode) => episode.episodeNumber),
        waterline: plotBreakdownSummary
      }),
    [mode, selectedEpisodeNumbers, episodes, plotBreakdownSummary]
  )
  const completedEpisodeCount = useMemo(
    () =>
      episodes.filter((episode) => isEpisodeComplete(episode.status)).length,
    [episodes]
  )
  const taskStats = useMemo(
    () => ({
      pending: tasks.filter((task) => task.status === 'pending').length,
      running: tasks.filter((task) => task.status === 'running').length,
      done: tasks.filter((task) => task.status === 'done').length,
      error: tasks.filter((task) => task.status === 'error').length,
      skipped: tasks.filter((task) => task.status === 'skipped').length
    }),
    [tasks]
  )
  const runningTask = tasks.find((task) => task.status === 'running')
  const canRun = autoMode || selectedEps.size > 0
  const executionLabel = autoMode
    ? '按水位执行'
    : `批量执行 ${selectedEps.size} 集`
  const executionHint = autoMode
    ? plotBreakdownSummary?.nextActionLabel || '读取水位后自动决定执行目标'
    : selectedEps.size > 0
      ? formatEpisodeList(selectedEpisodeNumbers)
      : '请选择要执行的集数'

  const toggleEpisode = (num: number) => {
    setSelectedEps((prev) => {
      const next = new Set(prev)
      if (next.has(num)) {
        next.delete(num)
      } else {
        next.add(num)
      }
      return next
    })
  }

  const selectAll = () => {
    if (selectedEps.size === episodes.length) {
      setSelectedEps(new Set())
    } else {
      setSelectedEps(new Set(episodes.map((e) => e.episodeNumber)))
    }
  }

  const selectRange = (start: number, end: number) => {
    const nums = new Set(selectedEps)
    for (let i = start; i <= end; i++) nums.add(i)
    setSelectedEps(nums)
  }

  const getLogIcon = (level: string, eventType: string): string => {
    if (eventType === 'state_changed') return '🔄'
    if (eventType === 'skill_loading') return '📦'
    if (eventType === 'llm_calling') return '🤖'
    if (eventType === 'llm_complete') return '✨'
    if (eventType === 'file_written') return '💾'
    if (eventType === 'review_start') return '⚠️'
    if (eventType === 'stage_complete') return '✅'
    if (eventType === 'review_fail') return '❌'
    if (eventType === 'paused') return '⏸'
    if (eventType === 'resumed') return '▶'
    if (level === 'error') return '🔴'
    if (level === 'warn') return '🟡'
    return '📝'
  }

  const handleBatchRun = useCallback(async () => {
    if (!currentProject) return
    setLogExpanded(true)
    clearLogs()
    try {
      await start({
        projectId: currentProject.id,
        projectPath: currentProject.projectPath,
        mode,
        episodes: [...selectedEps]
      })
    } catch (error) {
      addToast(
        'error',
        error instanceof Error ? error.message : '启动批队列失败'
      )
    }
  }, [currentProject, selectedEps, mode, start, clearLogs, addToast])

  const handleStop = useCallback(async () => {
    try {
      await stop()
      addToast('warning', '批队列已停止，未完成步骤可显式恢复')
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : '停止失败')
    }
  }, [stop, addToast])

  const controlQueue = async (action: () => Promise<void>) => {
    try {
      await action()
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : '队列控制失败')
    }
  }

  useEffect(() => {
    if (snapshot?.status !== 'completed') return
    void useProjectStore.getState().syncEpisodeStatus()
    if (currentProject)
      void getPlotBreakdownSummary(currentProject.id)
        .then(setPlotBreakdownSummary)
        .catch(() => {})
  }, [snapshot?.id, snapshot?.status, currentProject?.id])

  const episodePageCount = Math.max(1, Math.ceil(episodes.length / pageSize))
  const taskPageCount = Math.max(1, Math.ceil(tasks.length / pageSize))
  const visibleEpisodes = episodes.slice(
    Math.min(episodePage, episodePageCount - 1) * pageSize,
    (Math.min(episodePage, episodePageCount - 1) + 1) * pageSize
  )
  const visibleTasks = tasks.slice(
    Math.min(taskPage, taskPageCount - 1) * pageSize,
    (Math.min(taskPage, taskPageCount - 1) + 1) * pageSize
  )

  return (
    <div className="batch-page">
      <div className="batch-page-header">
        <div>
          <span className="batch-kicker">批量生产调度</span>
          <h2>批量执行</h2>
        </div>
        <div className="batch-header-meta">
          <span>{episodes.length} 集</span>
          <span>{completedEpisodeCount} 集已完成</span>
        </div>
      </div>

      {queueError && <p role="alert">{queueError}</p>}
      {snapshot && (
        <p role="status" aria-live="polite">
          主进程队列：{snapshot.status} · 已提交 {snapshot.cursor}/
          {snapshot.tasks.length} 项。离开页面不会停止任务。
        </p>
      )}
      {snapshot &&
        ['interrupted', 'stopped'].includes(snapshot.status) &&
        snapshot.cursor < snapshot.tasks.length && (
          <div className="batch-bg-banner">
            <span>
              上次队列未完成，恢复仅继续未提交步骤，不会自动覆盖已完成结果。
            </span>
            <button
              className="btn btn-primary btn-sm"
              disabled={commandPending}
              onClick={() => void controlQueue(resume)}
            >
              恢复未完成队列
            </button>
            {snapshot.status === 'interrupted' && (
              <button
                className="btn btn-sm"
                disabled={commandPending}
                onClick={() => void controlQueue(stop)}
              >
                停止保留的队列
              </button>
            )}
          </div>
        )}

      {bgRunning && !isRunning && (
        <div className="batch-bg-banner">
          <span>后台有流水线任务正在运行中，启动新的批量任务前请先停止。</span>
          <button
            className="btn btn-danger btn-sm"
            onClick={async () => {
              try {
                await abortPipeline()
                setBgRunning(false)
                addToast('warning', '后台任务已停止')
              } catch (error) {
                addToast(
                  'error',
                  error instanceof Error ? error.message : '停止失败'
                )
              }
            }}
          >
            ⏹ 停止后台任务
          </button>
        </div>
      )}

      <section className="batch-command-center">
        <div className="batch-command-summary">
          <div className="batch-mode-token">
            <span>{selectedModeConfig.emoji}</span>
            <strong>{selectedModeConfig.label}</strong>
          </div>
          <h3>{autoMode ? '水位自动推进' : '手动选择集数'}</h3>
          <p>{MODE_DESCRIPTIONS[mode]}</p>
          <div className="batch-summary-meter">
            <span
              style={{
                width: `${episodes.length ? Math.round((completedEpisodeCount / episodes.length) * 100) : 0}%`
              }}
            />
          </div>
          <div className="batch-summary-stats">
            <div>
              <span>预计执行</span>
              <strong>{previewEpisodes.length}</strong>
            </div>
            <div>
              <span>已选集数</span>
              <strong>{selectedEps.size}</strong>
            </div>
            <div>
              <span>完成水位</span>
              <strong>
                {completedEpisodeCount}/{episodes.length}
              </strong>
            </div>
          </div>
        </div>

        <div className="batch-command-action">
          <div className="batch-action-top">
            <span className="batch-section-label">执行确认</span>
            <span
              className={`batch-run-state ${isRunning ? 'is-running' : ''}`}
            >
              {isRunning ? '执行中' : canRun ? '可执行' : '待选择'}
            </span>
          </div>
          <h3>{isRunning ? '正在批量执行' : executionLabel}</h3>
          <p>
            {isRunning && runningTask
              ? `当前执行 EP${String(runningTask.episodeNum).padStart(2, '0')}`
              : executionHint}
          </p>
          <div className="batch-command-buttons">
            {!isRunning ? (
              <button
                className="btn btn-primary btn-lg"
                onClick={handleBatchRun}
                disabled={
                  !canRun ||
                  commandPending ||
                  snapshot?.status === 'interrupted'
                }
              >
                ▶ {executionLabel}
              </button>
            ) : (
              <div>
                <button
                  className="btn btn-danger btn-lg"
                  disabled={commandPending || snapshot?.status === 'stopping'}
                  onClick={handleStop}
                >
                  停止批量执行
                </button>
                <button
                  className="btn btn-sm"
                  disabled={commandPending || snapshot?.status === 'stopping'}
                  onClick={() =>
                    void controlQueue(
                      snapshot?.status === 'paused' ? resume : pause
                    )
                  }
                >
                  {snapshot?.status === 'paused' ? '继续执行' : '暂停队列'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="batch-command-preview">
          <div className="batch-action-top">
            <span className="batch-section-label">执行预览</span>
            <span>{autoMode ? '自动范围' : '手动范围'}</span>
          </div>
          <div className="batch-preview-list">
            <div>
              <span>待执行</span>
              <strong>
                {tasks.length > 0 ? taskStats.pending : previewEpisodes.length}
              </strong>
            </div>
            <div>
              <span>成功</span>
              <strong>{taskStats.done}</strong>
            </div>
            <div>
              <span>失败</span>
              <strong>{taskStats.error}</strong>
            </div>
            <div>
              <span>跳过</span>
              <strong>{taskStats.skipped}</strong>
            </div>
          </div>
          <p className="batch-preview-targets">
            {previewEpisodes.length > 0
              ? formatEpisodeList(previewEpisodes)
              : autoMode
                ? '当前水位暂无可执行目标'
                : '请选择集数后预览执行范围'}
          </p>
        </div>
      </section>

      <section className="batch-workspace">
        <div className="batch-mode-panel">
          <div className="batch-panel-header">
            <div>
              <span className="batch-section-label">执行模式</span>
              <h3>选择本次批量策略</h3>
            </div>
          </div>
          <div className="batch-mode-groups">
            {MODE_GROUPS.map((group) => (
              <div className="batch-mode-group" key={group.title}>
                <div className="batch-mode-group-head">
                  <strong>{group.title}</strong>
                  <span>{group.description}</span>
                </div>
                <div className="batch-mode-options">
                  {group.modes.map((key) => {
                    const config = MODE_MAP[key]
                    return (
                      <button
                        key={key}
                        className={`batch-mode-option ${mode === key ? 'active' : ''}`}
                        onClick={() => setMode(key)}
                        aria-pressed={mode === key}
                        disabled={isRunning || commandPending}
                      >
                        <span className="batch-mode-emoji">{config.emoji}</span>
                        <span>
                          <strong>{config.label}</strong>
                          <small>{MODE_DESCRIPTIONS[key]}</small>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="batch-selection">
          <div className="batch-selection-header">
            <div>
              <span className="batch-section-label">集数范围</span>
              <h3>{autoMode ? '自动水位范围' : '选择执行集数'}</h3>
              <p className="text-secondary">
                已选 {selectedEps.size} / {episodes.length} 集
                {autoMode && plotBreakdownSummary
                  ? ` · ${plotBreakdownSummary.nextActionLabel}`
                  : ''}
              </p>
            </div>
            <div className="batch-quick-actions">
              <button className="btn btn-sm" onClick={selectAll}>
                {selectedEps.size === episodes.length ? '取消全选' : '全选'}
              </button>
              <button
                className="btn btn-sm"
                onClick={() => setSelectedEps(new Set())}
              >
                清空
              </button>
              <button className="btn btn-sm" onClick={() => selectRange(1, 10)}>
                1-10
              </button>
              <button
                className="btn btn-sm"
                onClick={() => selectRange(11, 20)}
              >
                11-20
              </button>
              <button
                className="btn btn-sm"
                onClick={() => selectRange(21, 30)}
              >
                21-30
              </button>
            </div>
          </div>
          <div className="episode-select-grid">
            {visibleEpisodes.map((ep) => (
              <button
                key={ep.id}
                className={`episode-select-btn ${selectedEps.has(ep.episodeNumber) ? 'selected' : ''} ${isEpisodeComplete(ep.status) ? 'completed' : ''}`}
                onClick={() => toggleEpisode(ep.episodeNumber)}
                title={`EP${String(ep.episodeNumber).padStart(2, '0')}`}
                aria-label={`选择第 ${ep.episodeNumber} 集${isEpisodeComplete(ep.status) ? '，已完成' : ''}`}
                aria-pressed={selectedEps.has(ep.episodeNumber)}
              >
                <span className="ep-num">
                  EP{String(ep.episodeNumber).padStart(2, '0')}
                </span>
                {isEpisodeComplete(ep.status) && (
                  <span className="ep-done">✓</span>
                )}
              </button>
            ))}
          </div>
          <nav aria-label="集数分页" className="batch-quick-actions">
            <button
              className="btn btn-sm"
              disabled={episodePage <= 0}
              onClick={() => setEpisodePage((p) => p - 1)}
            >
              上一页
            </button>
            <span>
              第 {Math.min(episodePage + 1, episodePageCount)} /{' '}
              {episodePageCount} 页
            </span>
            <button
              className="btn btn-sm"
              disabled={episodePage >= episodePageCount - 1}
              onClick={() => setEpisodePage((p) => p + 1)}
            >
              下一页
            </button>
          </nav>
        </div>
      </section>

      {tasks.length > 0 && (
        <div className="batch-progress">
          <div className="batch-panel-header">
            <div>
              <span className="batch-section-label">执行队列</span>
              <h3>当前批量进度</h3>
            </div>
            <span className="text-secondary">
              {taskStats.done} 成功 · {taskStats.error} 失败 ·{' '}
              {taskStats.skipped} 跳过
            </span>
          </div>
          <div className="batch-task-list">
            {visibleTasks.map((task) => (
              <div
                key={task.episodeNum}
                className={`batch-task task-${task.status}`}
              >
                <span className="task-ep">
                  EP{String(task.episodeNum).padStart(2, '0')}
                </span>
                <span className="task-status-icon">
                  {task.status === 'pending' && '等待'}
                  {task.status === 'running' && '执行中'}
                  {task.status === 'done' && '成功'}
                  {task.status === 'error' && '失败'}
                  {task.status === 'skipped' && '跳过'}
                </span>
                <span className="task-progress text-secondary">
                  {task.progress || '等待中'}
                </span>
              </div>
            ))}
          </div>
          <nav aria-label="执行队列分页" className="batch-quick-actions">
            <button
              className="btn btn-sm"
              disabled={taskPage <= 0}
              onClick={() => setTaskPage((p) => p - 1)}
            >
              上一页
            </button>
            <span>
              第 {Math.min(taskPage + 1, taskPageCount)} / {taskPageCount} 页
            </span>
            <button
              className="btn btn-sm"
              disabled={taskPage >= taskPageCount - 1}
              onClick={() => setTaskPage((p) => p + 1)}
            >
              下一页
            </button>
          </nav>
        </div>
      )}

      {(isRunning || logs.length > 0) && (
        <div
          className={`batch-log-panel ${logExpanded ? 'expanded' : 'collapsed'}`}
        >
          <div className="batch-log-header">
            <button
              className="batch-log-title"
              aria-expanded={logExpanded}
              aria-controls="batch-log-body"
              onClick={() => setLogExpanded(!logExpanded)}
            >
              📋 执行日志
              {isRunning && <span className="log-running-dot" />}
              <span className="batch-log-count">{logs.length} 条</span>
            </button>
            <div className="batch-log-actions">
              <button
                className="btn btn-sm batch-log-clear-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  clearLogs()
                }}
                title="清空日志"
                aria-label="清空执行日志"
              >
                🗑
              </button>
              <span className="batch-log-toggle">
                {logExpanded ? '▼' : '▶'}
              </span>
            </div>
          </div>
          {logExpanded && (
            <div id="batch-log-body" className="batch-log-body">
              {hiddenLogCount > 0 && (
                <div className="log-empty text-secondary">
                  为减少渲染压力，仅展示最近 {visibleLogs.length}{' '}
                  条日志，已折叠更早的 {hiddenLogCount} 条。
                </div>
              )}
              {visibleLogs.length === 0 ? (
                <div className="log-empty text-secondary">
                  等待流水线启动...
                </div>
              ) : (
                visibleLogs.map((log) => (
                  <div key={log.id} className={`log-entry log-${log.level}`}>
                    <span className="log-icon">
                      {getLogIcon(log.level, log.eventType)}
                    </span>
                    <span className="log-ep-tag">{log.episodeId}</span>
                    <span className="log-time">
                      {new Date(log.timestamp).toLocaleTimeString('zh-CN', {
                        hour12: false
                      })}
                    </span>
                    <span className="log-message">{log.message}</span>
                  </div>
                ))
              )}
              {streamBuffer && isRunning && (
                <div className="log-stream">
                  <span className="log-icon">🤖</span>
                  <span className="log-stream-text">
                    生成中... ({streamBuffer.length} chars)
                  </span>
                </div>
              )}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
