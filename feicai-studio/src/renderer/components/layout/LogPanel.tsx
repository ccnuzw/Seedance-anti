import { memo, useEffect, useMemo, useRef } from 'react'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { DevProfiler } from '@renderer/dev/render-profiler'
import { useShallow } from 'zustand/react/shallow'
import './LogPanel.css'

interface LogPanelProps {
  isEngineMatch?: boolean
}

const MAX_RENDERED_LOGS = 200
const AUTO_SCROLL_THROTTLE_MS = 240

function LogPanel({ isEngineMatch = true }: LogPanelProps) {
  const { logs, streamBuffer, state, isRunning } = usePipelineStore(
    useShallow((s) => ({
      logs: s.logs,
      streamBuffer: s.streamBuffer,
      state: s.state,
      isRunning: s.isRunning
    }))
  )
  const logsEndRef = useRef<HTMLDivElement>(null)
  const lastScrollAtRef = useRef(0)

  useEffect(() => {
    const now = Date.now()
    if (now - lastScrollAtRef.current < AUTO_SCROLL_THROTTLE_MS) return
    lastScrollAtRef.current = now
    logsEndRef.current?.scrollIntoView({
      behavior: streamBuffer ? 'auto' : 'smooth',
      block: 'end'
    })
  }, [logs.length, streamBuffer])

  const visibleLogs = useMemo(
    () =>
      logs.length > MAX_RENDERED_LOGS ? logs.slice(-MAX_RENDERED_LOGS) : logs,
    [logs]
  )
  const hiddenCount = logs.length - visibleLogs.length

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

  return (
    <DevProfiler id="LogPanel">
      <div className="log-panel">
        <div className="log-panel-header">
          <span className="log-title">
            执行日志
            {isRunning && isEngineMatch && <span className="log-running-dot" />}
          </span>
          <span className="log-state badge badge-info">
            {isEngineMatch ? state : 'idle'}
          </span>
        </div>
        <div className="log-panel-body">
          {hiddenCount > 0 && (
            <div className="log-empty text-secondary">
              为减少渲染压力，仅展示最近 {visibleLogs.length}{' '}
              条日志，已折叠更早的 {hiddenCount} 条。
            </div>
          )}
          {!isEngineMatch ? (
            <div className="log-empty text-secondary">
              当前查阅的集数与后台运行引擎不匹配，暂无法查阅此集的历史运行日志。
            </div>
          ) : visibleLogs.length === 0 ? (
            <div className="log-empty text-secondary">等待流水线启动...</div>
          ) : (
            visibleLogs.map((log) => (
              <div key={log.id} className={`log-entry log-${log.level}`}>
                <span className="log-icon">
                  {getLogIcon(log.level, log.eventType)}
                </span>
                <span className="log-time">
                  {new Date(log.timestamp).toLocaleTimeString('zh-CN', {
                    hour12: false
                  })}
                </span>
                <span className="log-message">{log.message}</span>
              </div>
            ))
          )}
          {isEngineMatch && streamBuffer && isRunning && (
            <div className="log-stream">
              <span className="log-icon">🤖</span>
              <span className="log-stream-text">
                生成中... ({streamBuffer.length} chars)
              </span>
            </div>
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </DevProfiler>
  )
}

export default memo(LogPanel)
