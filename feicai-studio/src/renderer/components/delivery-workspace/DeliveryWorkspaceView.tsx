import { useMemo, useState, type ReactNode } from 'react'
import ExportModal from '@renderer/components/ExportModal'
import EmptyState from '@renderer/components/layout/EmptyState'
import SectionTabs, { type SectionTabItem } from '@renderer/components/layout/SectionTabs'
import type { useDeliveryWorkspace } from '@renderer/hooks/useDeliveryWorkspace'
import DeliveryHandoffWorkspace from '@renderer/components/delivery-workspace/DeliveryHandoffWorkspace'

type DeliveryWorkspaceState = ReturnType<typeof useDeliveryWorkspace>

interface DeliveryWorkspaceViewProps {
  workspace: DeliveryWorkspaceState
  handoffContentOverride?: ReactNode
}

type DeliveryTab = 'overview' | 'exports' | 'checklist' | 'diagnostics'

function formatRelativeUsage(timestamp?: string): string {
  if (!timestamp) return '未使用'
  const diffMs = Date.now() - new Date(timestamp).getTime()
  if (Number.isNaN(diffMs) || diffMs < 0) return '刚刚使用'
  const minutes = Math.floor(diffMs / (1000 * 60))
  if (minutes < 1) return '刚刚使用'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

export default function DeliveryWorkspaceView({ workspace, handoffContentOverride }: DeliveryWorkspaceViewProps) {
  const {
    currentProject,
    scriptsCount,
    promptReadyCount,
    completedCount,
    totalEpisodes,
    readyScore,
    fullCoverageReady,
    canShiftPhase,
    reviewFailedData,
    isRunning,
    deliveryStatus,
    deliveryLoading,
    exportingDeliveryReport,
    showExport,
    initialProfileId,
    recommendedProfiles,
    handleOpenExport,
    handleCloseExport,
    handleExportDeliveryReport,
    handleOpenSettings
  } = workspace
  const [issueFilter, setIssueFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all')
  const [showAllIssues, setShowAllIssues] = useState(false)
  const [showAppDetails, setShowAppDetails] = useState(false)
  const [activeTab, setActiveTab] = useState<DeliveryTab>('overview')

  if (!currentProject) {
    return <EmptyState icon="📦" title="请先选择一个项目" description="选择项目后，才能做交付检查、阶段切换和导出收尾。" />
  }

  const appReadyTone = deliveryStatus?.readiness.readyForDelivery
    ? 'success'
    : (deliveryStatus?.readiness.issueCount || 0) > 0
      ? 'danger'
      : 'warning'
  const deliveryGuidance = reviewFailedData
    ? '当前仍有待处理问题。建议先回到剧本创作或问题修订，把阻塞项闭环后再导出。'
    : isRunning
      ? '当前仍有任务运行中。建议等待本轮执行稳定，再决定是否切阶段或导出。'
      : canShiftPhase
        ? '当前已经具备阶段切换和交付基础，可以直接做交付检查或导出。'
        : '当前还存在交付缺口。建议先补齐剧本、提示词或制作结果，再进入正式导出。'
  const deliveryRiskItems = [
    reviewFailedData ? '存在待处理审核失败项' : null,
    isRunning ? '仍有运行中任务' : null,
    scriptsCount < Math.max(totalEpisodes, 1) ? '剧本覆盖尚未补齐' : null,
    promptReadyCount === 0 ? '制作产物仍然偏少' : null,
    (deliveryStatus?.readiness.issueCount || 0) > 0 ? '应用环境仍有错误项' : null
  ].filter((item): item is string => !!item)
  const exportFocusLabel = completedCount > 0
    ? '优先导出完整交付包'
    : promptReadyCount > 0
      ? '优先导出制作协作包'
      : '优先导出剧本审阅包'
  const filteredIssues = useMemo(() => {
    const issues = deliveryStatus?.issues || []
    return issueFilter === 'all' ? issues : issues.filter((issue) => issue.severity === issueFilter)
  }, [deliveryStatus?.issues, issueFilter])
  const visibleIssues = showAllIssues ? filteredIssues : filteredIssues.slice(0, 4)
  const issueFilterOptions: Array<{ key: 'all' | 'error' | 'warning' | 'info'; label: string; count: number }> = [
    { key: 'all', label: '全部', count: deliveryStatus?.issues.length || 0 },
    { key: 'error', label: '错误', count: deliveryStatus?.issues.filter((issue) => issue.severity === 'error').length || 0 },
    { key: 'warning', label: '警告', count: deliveryStatus?.issues.filter((issue) => issue.severity === 'warning').length || 0 },
    { key: 'info', label: '信息', count: deliveryStatus?.issues.filter((issue) => issue.severity === 'info').length || 0 }
  ]
  const tabs = useMemo<SectionTabItem[]>(() => [
    { key: 'overview', label: '收尾总览', hint: '动作判断' },
    { key: 'exports', label: '导出模板', hint: '模板与场景' },
    { key: 'checklist', label: '交付检查', hint: currentProject.sourceType === 'novel' ? '清单与分集' : '项目判断' },
    { key: 'diagnostics', label: '应用诊断', hint: `${deliveryStatus?.readiness.issueCount || 0} 错误 / ${deliveryStatus?.readiness.warningCount || 0} 警告` }
  ], [currentProject.sourceType, deliveryStatus?.readiness.issueCount, deliveryStatus?.readiness.warningCount])

  const handoffContent = currentProject.sourceType === 'novel'
    ? handoffContentOverride || <DeliveryHandoffWorkspace embedded />
    : (
      <div className="card delivery-workspace-generic">
        <div className="delivery-workspace-section-head">
          <h3>项目交付检查</h3>
          <span className={`status-chip ${fullCoverageReady ? 'is-success' : 'is-warning'}`}>
            {fullCoverageReady ? '整体交付准备较完整' : '建议继续补齐'}
          </span>
        </div>
        <p className="text-secondary">
          当前项目不走小说改编交接清单，但仍然应该在这里统一判断剧本、制作产物和导出方式是否已经具备收尾条件。
        </p>
        <div className="delivery-workspace-generic-grid">
          <div className="delivery-workspace-generic-item">
            <span className="delivery-workspace-label">剧本基础</span>
            <strong>{scriptsCount > 0 ? '已形成可交付剧本' : '仍缺可交付剧本'}</strong>
          </div>
          <div className="delivery-workspace-generic-item">
            <span className="delivery-workspace-label">制作收口</span>
            <strong>{promptReadyCount > 0 ? '已有制作产物' : '仍待生成提示词产物'}</strong>
          </div>
          <div className="delivery-workspace-generic-item">
            <span className="delivery-workspace-label">当前阻塞</span>
            <strong>{reviewFailedData ? '存在待处理问题' : isRunning ? '存在运行中任务' : '暂无显式阻塞'}</strong>
          </div>
        </div>
      </div>
    )

  const exportContent = (
    <div className="card delivery-workspace-export-card">
      <div className="delivery-workspace-section-head">
        <div>
          <h3>导出动作</h3>
          <p className="text-secondary text-xs">只保留当前阶段真正用得上的模板，并直接说明适用场景。</p>
        </div>
        <button className="btn btn-sm" onClick={handleOpenSettings}>
          打开项目设置
        </button>
      </div>
      <div className="delivery-workspace-export-settings text-secondary">
        默认导出模板和项目级交付参数可在项目设置中统一调整。
      </div>
      <div className="delivery-workspace-export-list">
        {recommendedProfiles.map((profile) => (
          <button
            key={profile.id}
            className="delivery-workspace-export-item"
            onClick={() => handleOpenExport(profile.id)}
          >
            <div className="delivery-workspace-export-item-head">
              <strong>{profile.label}</strong>
              <span className="status-chip">
                {profile.id === (currentProject.config.exportProfileId || '') ? '当前默认模板' : '按当前准备度可用'}
              </span>
            </div>
            <span className="text-secondary">{profile.description}</span>
            <div className="delivery-workspace-export-reason">
              <span className="delivery-workspace-label">推荐原因</span>
              <strong>{profile.reason}</strong>
            </div>
            <div className="delivery-workspace-export-meta">
              <span className="status-chip">
                最近使用：{formatRelativeUsage(profile.lastUsedAt)}
              </span>
              <span className="status-chip">
                {profile.id === 'export:delivery-bundle'
                  ? '适合最终交付'
                  : profile.id === 'export:scripts-manuscript'
                    ? '适合剧本流转'
                    : '适合审阅/协作'}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )

  const appDiagnosticsContent = (
    <div className="card delivery-workspace-app-card">
      <div className="delivery-workspace-section-head">
        <h3>应用级交付诊断</h3>
        <span className={`status-chip tone-${appReadyTone}`}>
          {deliveryLoading ? '读取中' : `${deliveryStatus?.readiness.score || 0}%`}
        </span>
      </div>
      {deliveryLoading ? (
        <div className="text-secondary">正在汇总应用环境、运行健康度和报告路径...</div>
      ) : deliveryStatus ? (
        <div className="delivery-workspace-app-list">
          <div className="delivery-workspace-app-metrics">
            <div className="delivery-workspace-app-stat">
              <span className="delivery-workspace-label">版本</span>
              <strong>v{deliveryStatus.version}</strong>
            </div>
            <div className="delivery-workspace-app-stat">
              <span className="delivery-workspace-label">环境</span>
              <strong>{deliveryStatus.packaged ? '正式包' : '开发环境'}</strong>
            </div>
            <div className="delivery-workspace-app-stat">
              <span className="delivery-workspace-label">问题统计</span>
              <strong>{deliveryStatus.readiness.issueCount} / {deliveryStatus.readiness.warningCount}</strong>
            </div>
          </div>
          <div className="delivery-workspace-app-summary">
            <span className={`status-chip ${deliveryStatus.readiness.issueCount > 0 ? 'tone-danger' : 'is-success'}`}>
              错误 {deliveryStatus.readiness.issueCount}
            </span>
            <span className={`status-chip ${deliveryStatus.readiness.warningCount > 0 ? 'is-warning' : 'is-success'}`}>
              警告 {deliveryStatus.readiness.warningCount}
            </span>
            <span className="status-chip">
              队列 {deliveryStatus.runtime.queuedRunCount}
            </span>
            <span className="status-chip">
              LLM {deliveryStatus.readiness.llmConfigCount}
            </span>
          </div>
          <button type="button" className="btn btn-sm delivery-workspace-app-toggle" onClick={() => setShowAppDetails((value) => !value)}>
            {showAppDetails ? '收起诊断明细' : '展开诊断明细'}
          </button>
          {showAppDetails && (
            <>
              <div className="delivery-workspace-app-row">
                <span className="delivery-workspace-label">运行平台</span>
                <strong>{deliveryStatus.platform}/{deliveryStatus.arch}</strong>
              </div>
              <div className="delivery-workspace-app-row">
                <span className="delivery-workspace-label">LLM 配置</span>
                <strong>{deliveryStatus.readiness.llmConfigCount} 个配置 / {deliveryStatus.readiness.defaultLLMCount} 个默认</strong>
              </div>
              <div className="delivery-workspace-app-row">
                <span className="delivery-workspace-label">运行队列</span>
                <strong>{deliveryStatus.runtime.queuedRunCount} 排队 / {deliveryStatus.runtime.deadLetterCount} 死信</strong>
              </div>
              <div className="delivery-workspace-app-row">
                <span className="delivery-workspace-label">问题统计</span>
                <strong>{deliveryStatus.readiness.issueCount} 错误 / {deliveryStatus.readiness.warningCount} 警告</strong>
              </div>
              <div className="delivery-workspace-app-path text-secondary">
                诊断报告目录：{deliveryStatus.paths.reportsDir}
              </div>
              {deliveryStatus.issues.length > 0 && (
                <>
                  <div className="delivery-workspace-issue-toolbar">
                    <div className="delivery-workspace-issue-filters">
                      {issueFilterOptions.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          className={`delivery-workspace-issue-filter ${issueFilter === option.key ? 'is-active' : ''}`}
                          onClick={() => {
                            setIssueFilter(option.key)
                            setShowAllIssues(false)
                          }}
                        >
                          <span>{option.label}</span>
                          <strong>{option.count}</strong>
                        </button>
                      ))}
                    </div>
                    {filteredIssues.length > 4 && (
                      <button type="button" className="btn btn-sm" onClick={() => setShowAllIssues((value) => !value)}>
                        {showAllIssues ? '收起问题' : '展开全部'}
                      </button>
                    )}
                  </div>
                  <div className="delivery-workspace-issue-list">
                    {visibleIssues.map((issue) => (
                      <div key={`${issue.code}-${issue.message}`} className={`delivery-workspace-issue tone-${issue.severity === 'error' ? 'danger' : issue.severity === 'warning' ? 'warning' : 'info'}`}>
                        <div className="delivery-workspace-issue-head">
                          <strong>{issue.severity === 'error' ? '阻断' : issue.severity === 'warning' ? '警告' : '信息'}</strong>
                          <span className="delivery-workspace-label">{issue.code}</span>
                        </div>
                        <span>{issue.message}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {deliveryStatus.recentErrors.length > 0 && (
                <div className="delivery-workspace-recent-errors">
                  <div className="delivery-workspace-section-head">
                    <h4>最近错误记录</h4>
                    <span className="text-secondary text-xs">{deliveryStatus.recentErrors.length} 条</span>
                  </div>
                  <div className="delivery-workspace-recent-error-list">
                    {deliveryStatus.recentErrors.slice(0, showAllIssues ? 6 : 3).map((entry, index) => (
                      <div key={`${entry.timestamp}-${index}`} className="delivery-workspace-recent-error">
                        <div className="delivery-workspace-issue-head">
                          <strong>{entry.scope === 'startup' ? '启动' : '运行中'}</strong>
                          <span className="delivery-workspace-label">{new Date(entry.timestamp).toLocaleString()}</span>
                        </div>
                        <span className="text-secondary">{entry.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="text-secondary">当前还没有可用的交付诊断数据。</div>
      )}
    </div>
  )

  return (
    <div className="section-page page-container page-wide delivery-workspace-page">
      <div className="card section-page-header delivery-workspace-header">
        <div className="section-page-copy">
          <h1>交付导出</h1>
          <p className="text-secondary">
            把交付检查、阶段切换、导出动作和应用级交付诊断合并到一个入口里，让项目收尾不再分散在多个页面和弹窗之间。
          </p>
          <SectionTabs tabs={tabs} activeKey={activeTab} onChange={(key) => setActiveTab(key as DeliveryTab)} />
        </div>
        <div className="section-page-actions delivery-workspace-header-actions">
          <div className="delivery-workspace-header-action-row">
            <button className="btn" onClick={handleOpenSettings}>
              项目设置
            </button>
            <button className="btn" onClick={() => void handleExportDeliveryReport()} disabled={exportingDeliveryReport}>
              {exportingDeliveryReport ? '导出诊断中...' : '导出交付诊断'}
            </button>
          </div>
          <button className="btn btn-primary delivery-workspace-header-primary" onClick={() => handleOpenExport(currentProject.config.exportProfileId || 'export:review-pack')}>
            导出项目
          </button>
        </div>
      </div>

      <div className="delivery-workspace-summary-grid">
        <div className="card delivery-workspace-summary-card delivery-workspace-summary-card--focus">
          <div className="delivery-workspace-summary-head">
            <span className="delivery-workspace-label">项目准备度</span>
            <span className={`status-chip ${canShiftPhase ? 'is-success' : 'is-warning'}`}>
              {canShiftPhase ? '可切阶段 / 可继续交付' : '仍有交付缺口'}
            </span>
          </div>
          <div className="delivery-workspace-summary-main">
            <strong>{readyScore}%</strong>
            <span className="text-secondary text-xs">当前项目是否适合进入正式收尾</span>
          </div>
        </div>
        <div className="card delivery-workspace-summary-card">
          <div className="delivery-workspace-summary-head">
            <span className="delivery-workspace-label">剧本成稿</span>
          </div>
          <div className="delivery-workspace-summary-main">
            <strong>{scriptsCount}/{Math.max(totalEpisodes, 1)}</strong>
            <span className="text-secondary text-xs">决定能否进入制作与交接</span>
          </div>
        </div>
        <div className="card delivery-workspace-summary-card">
          <div className="delivery-workspace-summary-head">
            <span className="delivery-workspace-label">提示词完成</span>
          </div>
          <div className="delivery-workspace-summary-main">
            <strong>{promptReadyCount}</strong>
            <span className="text-secondary text-xs">已形成制作产物的集数</span>
          </div>
        </div>
        <div className="card delivery-workspace-summary-card">
          <div className="delivery-workspace-summary-head">
            <span className="delivery-workspace-label">制作完成</span>
          </div>
          <div className="delivery-workspace-summary-main">
            <strong>{completedCount}</strong>
            <span className="text-secondary text-xs">可直接纳入完整交付包</span>
          </div>
        </div>
        <div className="card delivery-workspace-summary-card">
          <div className="delivery-workspace-summary-head">
            <span className="delivery-workspace-label">应用交付状态</span>
            <span className={`status-chip tone-${appReadyTone}`}>
              {deliveryStatus?.readiness.readyForDelivery ? '应用可交付' : '需要检查环境'}
            </span>
          </div>
          <div className="delivery-workspace-summary-main">
            <strong>{deliveryLoading ? '...' : `${deliveryStatus?.readiness.score || 0}%`}</strong>
            <span className="text-secondary text-xs">环境、配置和运行健康度综合判断</span>
          </div>
        </div>
      </div>

      <section className="delivery-workspace-main delivery-workspace-main--single">
        {activeTab === 'overview' && (
          <>
            <div className={`card delivery-workspace-command-card tone-${canShiftPhase && !reviewFailedData && !isRunning ? 'success' : deliveryRiskItems.length > 0 ? 'warning' : 'default'}`}>
              <div className="delivery-workspace-command-head">
                <div>
                  <span className="delivery-workspace-eyebrow">收尾指挥台</span>
                  <h3>当前最适合的交付动作</h3>
                </div>
                <span className={`status-chip ${canShiftPhase && !reviewFailedData && !isRunning ? 'is-success' : 'is-warning'}`}>
                  {canShiftPhase && !reviewFailedData && !isRunning ? '现在更适合收尾' : '先判断再执行'}
                </span>
              </div>
              <div className="delivery-workspace-command-grid">
                <div className="delivery-workspace-command-copy">
                  <p className="text-secondary">{deliveryGuidance}</p>
                  <div className="delivery-workspace-command-actions">
                    <button className="btn btn-primary" onClick={() => handleOpenExport(currentProject.config.exportProfileId || 'export:review-pack')}>
                      直接导出
                    </button>
                    <button className="btn" onClick={() => void handleExportDeliveryReport()} disabled={exportingDeliveryReport}>
                      {exportingDeliveryReport ? '导出诊断中...' : '导出交付诊断'}
                    </button>
                  </div>
                </div>
                <div className="delivery-workspace-command-side">
                  <div className="delivery-workspace-command-metric">
                    <span className="delivery-workspace-label">导出建议</span>
                    <strong>{exportFocusLabel}</strong>
                  </div>
                  <div className="delivery-workspace-command-metric">
                    <span className="delivery-workspace-label">当前默认模板</span>
                    <strong>{recommendedProfiles.find((profile) => profile.id === (currentProject.config.exportProfileId || ''))?.label || recommendedProfiles[0]?.label || '暂无可用模板'}</strong>
                  </div>
                </div>
              </div>
              {deliveryRiskItems.length > 0 && (
                <div className="delivery-workspace-risk-list">
                  {deliveryRiskItems.map((item) => (
                    <span key={item} className="delivery-workspace-risk-chip">{item}</span>
                  ))}
                </div>
              )}
            </div>
            {handoffContent}
          </>
        )}
        {activeTab === 'exports' && exportContent}
        {activeTab === 'checklist' && handoffContent}
        {activeTab === 'diagnostics' && appDiagnosticsContent}
      </section>

      <ExportModal open={showExport} onClose={handleCloseExport} initialProfileId={initialProfileId} />
    </div>
  )
}
