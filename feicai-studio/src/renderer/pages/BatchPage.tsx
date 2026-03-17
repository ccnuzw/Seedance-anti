import { useState, useCallback, useRef, useEffect } from 'react'
import { useProjectStore } from '@renderer/stores/projectStore'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { useToastStore } from '@renderer/stores/toastStore'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { IPC } from '@shared/ipc-channels'
import type { Episode, PipelineStage } from '@shared/types'
import './BatchPage.css'

type BatchMode = 'full' | 'director' | 'art' | 'storyboard'

const MODE_MAP: Record<BatchMode, { label: string; emoji: string; stage?: PipelineStage }> = {
  full: { label: '全流程', emoji: '🚀' },
  director: { label: '导演分析', emoji: '🎬', stage: 'director' },
  art: { label: '服化道', emoji: '🎨', stage: 'art' },
  storyboard: { label: '分镜编写', emoji: '📐', stage: 'storyboard' }
}

interface BatchTask {
  episodeNum: number
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped'
  progress?: string
  elapsed?: number
}

export default function BatchPage() {
  useProjectSync()
  const { currentProject, episodes } = useProjectStore()
  const { logs, streamBuffer, setupEventListeners, clearLogs, isRunning: pipelineRunning, syncFromBackend } = usePipelineStore()
  const { addToast } = useToastStore()

  const [mode, setMode] = useState<BatchMode>('full')
  const [selectedEps, setSelectedEps] = useState<Set<number>>(new Set())
  const [tasks, setTasks] = useState<BatchTask[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [logExpanded, setLogExpanded] = useState(true)
  const abortRef = useRef(false)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // 设置管道事件监听（接收日志）
  useEffect(() => {
    const cleanup = setupEventListeners()
    return cleanup
  }, [setupEventListeners])

  // mount 时同步后端状态，检测是否有后台任务在运行
  const [bgRunning, setBgRunning] = useState(false)
  useEffect(() => {
    syncFromBackend().then(() => {
      const globalRunning = usePipelineStore.getState().isRunning
      setBgRunning(globalRunning && !isRunning)
    })
  }, [])

  // 当全局引擎状态变为非运行时，清除 bgRunning 提示
  useEffect(() => {
    if (!pipelineRunning) setBgRunning(false)
  }, [pipelineRunning])

  // 自动滚动到最新日志
  useEffect(() => {
    if (logExpanded) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs.length, streamBuffer, logExpanded])

  const toggleEpisode = (num: number) => {
    setSelectedEps((prev) => {
      const next = new Set(prev)
      next.has(num) ? next.delete(num) : next.add(num)
      return next
    })
  }

  const selectAll = () => {
    if (selectedEps.size === episodes.length) {
      setSelectedEps(new Set())
    } else {
      setSelectedEps(new Set(episodes.map(e => e.episodeNumber)))
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
    if (!currentProject || selectedEps.size === 0) return

    // 互斥保护：检查后端引擎是否正在执行
    await syncFromBackend()
    if (usePipelineStore.getState().isRunning) {
      addToast('error', '流水线正在执行中，请先停止当前任务')
      return
    }

    setIsRunning(true)
    setLogExpanded(true)
    abortRef.current = false
    clearLogs()

    const sortedEps = [...selectedEps].sort((a, b) => a - b)
    const initialTasks: BatchTask[] = sortedEps.map(ep => ({
      episodeNum: ep,
      status: 'pending'
    }))
    setTasks(initialTasks)

    // 顺序执行，每集等待完成
    for (let i = 0; i < sortedEps.length; i++) {
      if (abortRef.current) {
        setTasks(prev => prev.map((t, idx) =>
          idx >= i ? { ...t, status: 'skipped', progress: '已跳过' } : t
        ))
        break
      }

      const epNum = sortedEps[i]
      const startTime = Date.now()
      setTasks(prev => prev.map((t, idx) =>
        idx === i ? { ...t, status: 'running', progress: '执行中...' } : t
      ))

      try {
        const modeConfig = MODE_MAP[mode]
        const result = await window.feicaiAPI.invoke(IPC.PIPELINE_RUN_AND_WAIT, {
          projectId: currentProject.id,
          projectPath: currentProject.projectPath,
          episodeNum: epNum,
          projectName: currentProject.name,
          visualStyle: currentProject.visualStyle,
          targetMedium: currentProject.targetMedium,
          startStage: modeConfig.stage,
          singleStage: !!modeConfig.stage
        }) as { success?: boolean; error?: string; state?: string }

        const elapsed = Math.round((Date.now() - startTime) / 1000)
        const isOk = result.success && result.state === 'episode_complete'

        setTasks(prev => prev.map((t, idx) =>
          idx === i ? {
            ...t,
            status: isOk ? 'done' : 'error',
            progress: isOk ? `完成 (${elapsed}s)` : (result.error || `失败: ${result.state}`),
            elapsed
          } : t
        ))
      } catch {
        setTasks(prev => prev.map((t, idx) =>
          idx === i ? { ...t, status: 'error', progress: '执行异常' } : t
        ))
      }
    }

    setIsRunning(false)

    // 汇总通知
    setTasks(prev => {
      const successCount = prev.filter(t => t.status === 'done').length
      const errorCount = prev.filter(t => t.status === 'error').length
      const skippedCount = prev.filter(t => t.status === 'skipped').length
      if (abortRef.current) {
        addToast('warning', `批量执行已中止：${successCount} 集成功，${errorCount} 集失败，${skippedCount} 集跳过`, { title: '批量执行中止' })
      } else if (errorCount > 0) {
        addToast('warning', `批量执行完成：${successCount} 集成功，${errorCount} 集失败`, { title: '批量执行完成' })
      } else {
        addToast('success', `全部 ${successCount} 集执行成功！`, { title: '🎉 批量执行完成' })
      }
      return prev
    })

    // 批量完成后刷新 episode 状态
    useProjectStore.getState().syncEpisodeStatus()
  }, [currentProject, selectedEps, mode])

  const handleStop = useCallback(() => {
    abortRef.current = true
    // 强制中止当前执行（abort 会使引擎进入 error 状态，waitForCompletion 立即 resolve）
    window.feicaiAPI.invoke(IPC.PIPELINE_ABORT)
    addToast('warning', '正在停止批量执行...')
  }, [addToast])

  return (
    <div className="batch-page">
      <h2>🚀 批量执行</h2>

      {/* 后台任务运行中提示 */}
      {bgRunning && !isRunning && (
        <div className="batch-bg-banner" style={{
          padding: '12px 16px', marginBottom: '12px',
          background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)',
          borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <span style={{ color: 'var(--color-warning)' }}>
            ⚠️ 后台有流水线任务正在运行中，启动新的批量任务前请先停止
          </span>
          <button className="btn btn-danger btn-sm" onClick={() => {
            window.feicaiAPI.invoke(IPC.PIPELINE_ABORT)
            setBgRunning(false)
            addToast('warning', '后台任务已停止')
          }}>
            ⏹ 停止后台任务
          </button>
        </div>
      )}

      {/* 模式选择 */}
      <div className="batch-mode-bar">
        {Object.entries(MODE_MAP).map(([key, config]) => (
          <button
            key={key}
            className={`btn batch-mode-btn ${mode === key ? 'active' : ''}`}
            onClick={() => setMode(key as BatchMode)}
          >
            {config.emoji} {config.label}
          </button>
        ))}
      </div>

      {/* 集数选择网格 */}
      <div className="batch-selection">
        <div className="batch-selection-header">
          <span className="text-secondary">
            已选 {selectedEps.size} / {episodes.length} 集
          </span>
          <div className="batch-quick-actions">
            <button className="btn btn-sm" onClick={selectAll}>
              {selectedEps.size === episodes.length ? '取消全选' : '全选'}
            </button>
            <button className="btn btn-sm" onClick={() => selectRange(1, 10)}>1-10</button>
            <button className="btn btn-sm" onClick={() => selectRange(11, 20)}>11-20</button>
            <button className="btn btn-sm" onClick={() => selectRange(21, 30)}>21-30</button>
          </div>
        </div>
        <div className="episode-select-grid">
          {episodes.map((ep) => (
            <button
              key={ep.id}
              className={`episode-select-btn ${selectedEps.has(ep.episodeNumber) ? 'selected' : ''} ${ep.status === 'complete' ? 'completed' : ''}`}
              onClick={() => toggleEpisode(ep.episodeNumber)}
            >
              <span className="ep-num">{String(ep.episodeNumber).padStart(2, '0')}</span>
              {ep.status === 'complete' && <span className="ep-done">✓</span>}
            </button>
          ))}
        </div>
      </div>

      {/* 执行按钮 */}
      <div className="batch-actions">
        {!isRunning ? (
          <button
            className="btn btn-primary btn-lg"
            onClick={handleBatchRun}
            disabled={selectedEps.size === 0}
          >
            ▶ 批量执行 {selectedEps.size} 集
          </button>
        ) : (
          <button
            className="btn btn-danger btn-lg"
            onClick={handleStop}
          >
            ⏹ 停止批量执行
          </button>
        )}
      </div>

      {/* 任务进度 */}
      {tasks.length > 0 && (
        <div className="batch-progress">
          <h3 className="section-title">执行进度</h3>
          <div className="batch-task-list">
            {tasks.map((task) => (
              <div key={task.episodeNum} className={`batch-task task-${task.status}`}>
                <span className="task-ep">EP{String(task.episodeNum).padStart(2, '0')}</span>
                <span className="task-status-icon">
                  {task.status === 'pending' && '⏳'}
                  {task.status === 'running' && '🔄'}
                  {task.status === 'done' && '✅'}
                  {task.status === 'error' && '❌'}
                  {task.status === 'skipped' && '⏭'}
                </span>
                <span className="task-progress text-secondary">
                  {task.progress || '等待中'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 日志窗口 */}
      {(isRunning || logs.length > 0) && (
        <div className={`batch-log-panel ${logExpanded ? 'expanded' : 'collapsed'}`}>
          <div className="batch-log-header" onClick={() => setLogExpanded(!logExpanded)}>
            <span className="batch-log-title">
              📋 执行日志
              {isRunning && <span className="log-running-dot" />}
              <span className="batch-log-count">{logs.length} 条</span>
            </span>
            <div className="batch-log-actions">
              <button
                className="btn btn-sm batch-log-clear-btn"
                onClick={(e) => { e.stopPropagation(); clearLogs() }}
                title="清空日志"
              >
                🗑
              </button>
              <span className="batch-log-toggle">{logExpanded ? '▼' : '▶'}</span>
            </div>
          </div>
          {logExpanded && (
            <div className="batch-log-body">
              {logs.length === 0 ? (
                <div className="log-empty text-secondary">等待流水线启动...</div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className={`log-entry log-${log.level}`}>
                    <span className="log-icon">{getLogIcon(log.level, log.eventType)}</span>
                    <span className="log-ep-tag">{log.episodeId}</span>
                    <span className="log-time">
                      {new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                    </span>
                    <span className="log-message">{log.message}</span>
                  </div>
                ))
              )}
              {streamBuffer && isRunning && (
                <div className="log-stream">
                  <span className="log-icon">🤖</span>
                  <span className="log-stream-text">生成中... ({streamBuffer.length} chars)</span>
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
