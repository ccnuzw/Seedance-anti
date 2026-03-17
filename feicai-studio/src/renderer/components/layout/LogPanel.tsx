import { useEffect, useRef } from 'react'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import './LogPanel.css'

interface LogPanelProps {
  isEngineMatch?: boolean
}

export default function LogPanel({ isEngineMatch = true }: LogPanelProps) {
  const { logs, streamBuffer, state, isRunning } = usePipelineStore()
  const logsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length, streamBuffer])

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
      <div className="log-panel-body">
        {!isEngineMatch ? (
          <div className="log-empty text-secondary">
            当前查阅的集数与后台运行引擎不匹配，暂无法查阅此集的历史运行日志。
          </div>
        ) : logs.length === 0 ? (
          <div className="log-empty text-secondary">
            等待流水线启动...
          </div>
        ) : (
          logs.map((log) => (
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
