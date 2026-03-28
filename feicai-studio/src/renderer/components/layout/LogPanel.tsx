import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import './LogPanel.css'

interface LogPanelProps {
  isEngineMatch?: boolean
}

const MAX_VISIBLE_LOGS = 200

function LogPanel({ isEngineMatch = true }: LogPanelProps) {
  const logs = usePipelineStore((state) => state.logs)
  const streamBuffer = usePipelineStore((state) => state.streamBuffer)
  const state = usePipelineStore((state) => state.state)
  const isRunning = usePipelineStore((state) => state.isRunning)
  const logBodyRef = useRef<HTMLDivElement>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const shouldFollowLogRef = useRef(true)
  const visibleLogs = useMemo(() => logs.slice(-MAX_VISIBLE_LOGS), [logs])

  useEffect(() => {
    if (!shouldFollowLogRef.current) return
    logBodyRef.current?.scrollTo({
      top: logBodyRef.current.scrollHeight,
      behavior: 'auto'
    })
  }, [visibleLogs.length, streamBuffer])

  const handleScroll = useCallback(() => {
    const element = logBodyRef.current
    if (!element) return
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight
    shouldFollowLogRef.current = distanceToBottom <= 48
  }, [])

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
    <div className="log-panel">
      <div className="log-panel-header">
        <span className="log-title">
          执行日志
          {isRunning && isEngineMatch && <span className="log-running-dot" />}
        </span>
        <span className="log-state badge badge-info">{isEngineMatch ? state : 'idle'}</span>
      </div>
      <div className="log-panel-body" ref={logBodyRef} onScroll={handleScroll}>
        {!isEngineMatch ? (
          <div className="log-empty text-secondary">
            当前查阅的集数与后台运行引擎不匹配，暂无法查阅此集的历史运行日志。
          </div>
        ) : visibleLogs.length === 0 ? (
          <div className="log-empty text-secondary">
            等待流水线启动...
          </div>
        ) : (
          visibleLogs.map((log) => (
            <div key={log.id} className={`log-entry log-${log.level}`}>
              <span className="log-icon">{getLogIcon(log.level, log.eventType)}</span>
              <span className="log-time">
                {new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
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
  )
}

export default memo(LogPanel)
