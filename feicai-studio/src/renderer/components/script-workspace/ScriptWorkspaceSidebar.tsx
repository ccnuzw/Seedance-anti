import { useMemo, useState, type RefObject } from 'react'
import SectionTabs from '@renderer/components/layout/SectionTabs'
import SimpleMarkdown from '@renderer/components/SimpleMarkdown'
import LatestScriptReviewCard from '@renderer/components/script-workspace/LatestScriptReviewCard'
import { getLogIcon } from '@renderer/components/script-workspace/scriptWorkspaceView'
import type { LogEntry, ReviewResult } from '@shared/types'

interface ScriptWorkspaceSidebarProps {
  isRunning: boolean
  previewOpen: boolean
  editorContent: string
  reviewResult?: ReviewResult | null
  streamOutput: string
  recentLogs: LogEntry[]
  error: string | null
  streamRef: RefObject<HTMLDivElement | null>
  onClearStream: () => void
}

export default function ScriptWorkspaceSidebar({
  isRunning,
  previewOpen,
  editorContent,
  reviewResult,
  streamOutput,
  recentLogs,
  error,
  streamRef,
  onClearStream
}: ScriptWorkspaceSidebarProps) {
  const tabs = useMemo(
    () => [
      { key: 'preview', label: '预览', hint: previewOpen ? '打开中' : '已收起' },
      { key: 'review', label: '质检', hint: reviewResult ? `${reviewResult.passed ? 'PASS' : 'FAIL'} · ${reviewResult.score}` : '暂无结果' },
      { key: 'console', label: '运行', hint: recentLogs.length > 0 ? `${recentLogs.length} 条日志` : '暂无日志' }
    ],
    [previewOpen, recentLogs.length, reviewResult]
  )
  const [activeTab, setActiveTab] = useState('preview')

  return (
    <div className="as-support-panel card">
      <div className="as-section-head">
        <div className="as-focus-copy">
          <h3>辅助面板</h3>
          <p className="text-secondary">只展开一个辅助视图，避免预览、质检和运行信息同时挤占主创作区域。</p>
        </div>
      </div>
      <SectionTabs tabs={tabs} activeKey={activeTab} onChange={setActiveTab} />

      {activeTab === 'preview' && (
        <div className="as-preview-panel">
          <div className="as-section-head">
            <h3>参考预览</h3>
            <span className="text-secondary text-xs">{previewOpen ? '仅用于快速核对排版和节奏' : '预览当前已收起'}</span>
          </div>
          <div className="as-preview-body">
            {previewOpen
              ? <SimpleMarkdown content={editorContent} scriptMode />
              : <div className="as-preview-empty text-secondary">预览已收起。需要时可在上方编辑区打开预览后回到这里核对排版。</div>}
          </div>
        </div>
      )}

      {activeTab === 'review' && (
        <LatestScriptReviewCard reviewResult={reviewResult} />
      )}

      {activeTab === 'console' && (
        <div className="as-console">
          <div className="as-section-head">
            <h3>生成与运行</h3>
            <div className="as-console-actions">
              <span className="text-secondary text-xs">{recentLogs.length} 条日志</span>
              {(streamOutput || recentLogs.length > 0) && (
                <button className="btn btn-sm" onClick={onClearStream}>清空输出</button>
              )}
            </div>
          </div>
          {!!error && <div className="as-error-card">❌ {String(error)}</div>}
          <div className="as-output-panel">
            <div className="as-output-header">
              <span className="as-output-title">
                LLM 输出
                {isRunning && <span className="as-running-dot" />}
              </span>
            </div>
            <div className="as-output-body" ref={streamRef}>
              {streamOutput || (isRunning ? '等待模型输出...' : '执行剧本生成、重写或修订后，实时输出会显示在这里。')}
            </div>
          </div>
          <div className="as-log-panel">
            {recentLogs.length === 0 ? (
              <div className="as-log-empty text-secondary">暂无运行日志。</div>
            ) : (
              recentLogs.map((log) => (
                <div key={log.id} className={`as-log-entry log-${log.level}`}>
                  <span className="as-log-icon">{getLogIcon(log.level, log.eventType)}</span>
                  <span className="as-log-time">
                    {new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                  </span>
                  <span className="as-log-message">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
