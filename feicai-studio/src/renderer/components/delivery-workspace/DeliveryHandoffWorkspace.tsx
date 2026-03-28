import { useMemo, useState } from 'react'
import EmptyState from '@renderer/components/layout/EmptyState'
import { useDeliveryHandoffWorkspace } from '@renderer/hooks/useDeliveryHandoffWorkspace'
import './DeliveryHandoffWorkspace.css'

export type DeliveryHandoffWorkspaceState = ReturnType<typeof useDeliveryHandoffWorkspace>

interface DeliveryHandoffWorkspaceProps {
  embedded?: boolean
  workspaceOverride?: DeliveryHandoffWorkspaceState
}

export default function DeliveryHandoffWorkspace({ embedded = false, workspaceOverride }: DeliveryHandoffWorkspaceProps) {
  const hookWorkspace = useDeliveryHandoffWorkspace()
  const workspace = workspaceOverride || hookWorkspace
  const {
    currentProject,
    scriptsCount,
    completedCount,
    inProductionCount,
    totalEpisodes,
    totalChapters,
    processedChapters,
    missingScriptEpisodes,
    readyEpisodes,
    checklist,
    readyCount,
    readinessScore,
    canUpgrade,
    handoffMode,
    handoffRows,
    nextAction,
    reviewFailedData,
    isRunning,
    unusedPlots,
    formatEpisodeLabel,
    handleOpenPath,
    handleOpenScript,
    handleOpenScriptIssues,
    handleOpenProduction,
    handleUpgradePhase
  } = workspace
  const [episodeFilter, setEpisodeFilter] = useState<'focus' | 'blocked' | 'ready' | 'active' | 'all'>('focus')
  const [episodeQuery, setEpisodeQuery] = useState('')
  const [showSecondaryBuckets, setShowSecondaryBuckets] = useState(false)
  const [showAllEpisodes, setShowAllEpisodes] = useState(false)

  if (!currentProject) {
    return <EmptyState icon="📦" title="请先选择一个项目" description="选择项目后才能进入交付导出。" />
  }

  if (currentProject.sourceType !== 'novel') {
    return (
      <EmptyState
        icon="🧭"
        title="当前项目不使用小说改编交付流程"
        description="交付检查清单目前仅对小说改编项目开放。"
      />
    )
  }

  const episodeBuckets = useMemo(() => {
    const blocked = handoffRows.filter((row) => !row.hasScript || (!row.canStartProduction && row.productionStatus === 'idle'))
    const ready = handoffRows.filter((row) => row.canStartProduction && row.productionStatus === 'idle')
    const active = handoffRows.filter((row) => row.productionStatus !== 'idle')
    const focus = [...blocked, ...ready, ...active.filter((row) => row.productionStatus !== 'complete')]
    const dedupedFocus = Array.from(new Map(focus.map((row) => [row.episodeNum, row])).values())
    return {
      focus: dedupedFocus,
      blocked,
      ready,
      active,
      all: handoffRows
    }
  }, [handoffRows])

  const normalizedEpisodeQuery = episodeQuery.trim().toLowerCase()
  const filteredEpisodes = useMemo(() => (
    episodeBuckets[episodeFilter].filter((row) => {
      if (!normalizedEpisodeQuery) return true
      const episodeLabel = formatEpisodeLabel(row.episodeNum).toLowerCase()
      return episodeLabel.includes(normalizedEpisodeQuery) || String(row.episodeNum).includes(normalizedEpisodeQuery)
    })
  ), [episodeBuckets, episodeFilter, formatEpisodeLabel, normalizedEpisodeQuery])
  const filterOptions: Array<{ key: keyof typeof episodeBuckets; label: string; count: number }> = [
    { key: 'focus', label: '优先处理', count: episodeBuckets.focus.length },
    { key: 'blocked', label: '待补齐', count: episodeBuckets.blocked.length },
    { key: 'ready', label: '可送制作', count: episodeBuckets.ready.length },
    { key: 'active', label: '制作中/已完成', count: episodeBuckets.active.length },
    { key: 'all', label: '全部', count: episodeBuckets.all.length }
  ]
  const quickJumpEpisode = filteredEpisodes[0]
  const shouldCompactEpisodes = embedded && episodeFilter === 'focus' && !showSecondaryBuckets
  const visibleEpisodes = shouldCompactEpisodes && !showAllEpisodes ? filteredEpisodes.slice(0, 4) : filteredEpisodes
  const hiddenEpisodeCount = Math.max(filteredEpisodes.length - visibleEpisodes.length, 0)
  const summaryMetrics = [
    { label: '拆解进度', value: `${processedChapters}/${Math.max(totalChapters, 0)}` },
    { label: '可用剧情点', value: String(unusedPlots) },
    { label: '就绪集数', value: String(readyEpisodes.length) }
  ]
  const gapMessages = [
    reviewFailedData ? '存在待处理审核失败项，建议先回到问题修订页面完成闭环。' : null,
    missingScriptEpisodes.length > 0
      ? `仍有 ${missingScriptEpisodes.length} 集未成稿：${missingScriptEpisodes.map(formatEpisodeLabel).join('、')}`
      : null,
    isRunning ? '当前仍有编剧任务运行中，建议等待本轮执行稳定后再切换阶段。' : null
  ].filter((item): item is string => !!item)
  const compactPrimaryActions = embedded
    ? [
        { key: 'path', label: nextAction.label, onClick: () => handleOpenPath(nextAction.path), tone: 'default' },
        { key: 'issues', label: '检查问题修订', onClick: handleOpenScriptIssues, tone: 'default' }
      ]
    : []

  return (
    <div className={`delivery-handoff-page ${embedded ? 'is-embedded' : ''}`}>
      {!embedded && (
        <div className="delivery-handoff-header">
          <div>
            <h1>交付检查</h1>
            <p className="text-secondary">
              把“能不能进制作”和“怎么收尾导出”放到一套可解释的检查清单里，而不是依赖单点按钮判断。
            </p>
          </div>
          <div className={`delivery-handoff-score ${canUpgrade ? 'is-ready' : ''}`}>
            准备度 {readinessScore}%
          </div>
        </div>
      )}

      <div className="delivery-handoff-overview">
        <div className="delivery-handoff-overview-card card">
          <span className="task-summary-label">已成稿集</span>
          <strong>{scriptsCount}/{Math.max(totalEpisodes, 1)}</strong>
        </div>
        <div className="delivery-handoff-overview-card card">
          <span className="task-summary-label">已进制作</span>
          <strong>{inProductionCount}</strong>
        </div>
        <div className="delivery-handoff-overview-card card">
          <span className="task-summary-label">已完成制作</span>
          <strong>{completedCount}</strong>
        </div>
        <div className="delivery-handoff-overview-card card">
          <span className="task-summary-label">缺剧本集数</span>
          <strong className={missingScriptEpisodes.length > 0 ? 'text-warning' : 'text-success'}>
            {missingScriptEpisodes.length}
          </strong>
        </div>
        <div className="delivery-handoff-overview-card card">
          <span className="task-summary-label">交付方式</span>
          <strong>
            {handoffMode === 'full' ? '整体交付' : handoffMode === 'partial' ? '边写边制' : '待补齐'}
          </strong>
        </div>
      </div>

      <div className="delivery-handoff-grid">
        <section className="delivery-handoff-main">
          {embedded && (
            <div className="card delivery-handoff-embedded-summary">
              <div className="delivery-handoff-section-head">
                <div>
                  <h3>小说交付判断</h3>
                  <p className="text-secondary text-xs">把阶段判断、缺口和下一步压缩到一块，避免嵌入主页面后继续形成第二个工作台。</p>
                </div>
                <span className={`delivery-handoff-pill ${canUpgrade ? 'is-success' : 'is-warning'}`}>
                  {canUpgrade ? '可切换' : '待补齐'}
                </span>
              </div>
              <div className="delivery-handoff-embedded-grid">
                <div className="delivery-handoff-summary-copy">
                  <strong>{nextAction.title}</strong>
                  <p className="text-secondary">{nextAction.description}</p>
                  {gapMessages.length > 0 ? (
                    <div className="delivery-handoff-gap-list">
                      {gapMessages.map((message) => (
                        <div key={message} className="delivery-handoff-gap-item is-warning">
                          {message}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="delivery-handoff-gap-item is-success">
                      当前没有明显交付阻塞，可以根据项目节奏决定是整体切换还是继续边写边制。
                    </div>
                  )}
                </div>
                <div className="delivery-handoff-embedded-side">
                  <div className="delivery-handoff-metrics">
                    {summaryMetrics.map((metric) => (
                      <div key={metric.label} className="delivery-handoff-metric">
                        <span className="task-summary-label">{metric.label}</span>
                        <strong>{metric.value}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="delivery-handoff-actions">
                    {compactPrimaryActions.map((action) => (
                    <button key={action.key} className="btn btn-sm" onClick={action.onClick}>
                        {action.label}
                      </button>
                    ))}
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void handleUpgradePhase()}
                      disabled={currentProject.phase === 'production' || !canUpgrade}
                    >
                      {currentProject.phase === 'production' ? '已在制作阶段' : '进入制作阶段'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="card delivery-handoff-checklist">
            <div className="delivery-handoff-section-head">
              <h3>交付检查清单</h3>
              <span className="text-secondary text-xs">{readyCount}/{checklist.length} 已满足</span>
            </div>
            <div className="delivery-handoff-list delivery-handoff-list--compact">
              {checklist.map((item) => (
                <div key={item.label} className={`delivery-handoff-item ${item.ready ? 'is-ready' : 'is-pending'}`}>
                  <div>
                    <strong>{item.label}</strong>
                    <p className="text-secondary">{item.hint}</p>
                  </div>
                  <span className="delivery-handoff-badge">{item.ready ? '已满足' : '待处理'}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card delivery-handoff-episodes">
            <div className="delivery-handoff-section-head">
              <h3>分集交接清单</h3>
              <span className="text-secondary text-xs">
                默认先看需要处理的集数，避免长列表把主工作区撑得过长。
              </span>
            </div>
            {embedded && (
              <div className="delivery-handoff-compact-bar">
                <span className="text-secondary text-xs">
                  当前默认聚焦需要处理的集数，只有在需要排查全量分组时才展开更多控制。
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setShowSecondaryBuckets((value) => !value)
                    setShowAllEpisodes(false)
                    if (showSecondaryBuckets) {
                      setEpisodeFilter('focus')
                      setEpisodeQuery('')
                    }
                  }}
                >
                  {showSecondaryBuckets ? '收起其它分组' : '查看其它分组'}
                </button>
              </div>
            )}
            {(!embedded || showSecondaryBuckets) && (
              <>
                <div className="delivery-handoff-filter-bar">
                  {filterOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`delivery-handoff-filter ${episodeFilter === option.key ? 'is-active' : ''}`}
                      onClick={() => {
                        setEpisodeFilter(option.key)
                        setShowAllEpisodes(false)
                        if (embedded && option.key !== 'focus') {
                          setShowSecondaryBuckets(true)
                        }
                      }}
                    >
                      <span>{option.label}</span>
                      <strong>{option.count}</strong>
                    </button>
                  ))}
                </div>
                <div className="delivery-handoff-toolbar">
                  <label className="delivery-handoff-search">
                    <span className="task-summary-label">搜索集数</span>
                    <input
                      type="text"
                      value={episodeQuery}
                      onChange={(event) => {
                        setEpisodeQuery(event.target.value)
                        setShowAllEpisodes(true)
                      }}
                      placeholder="输入 EP003 或 3"
                    />
                  </label>
                  <div className="delivery-handoff-toolbar-actions">
                    {quickJumpEpisode && normalizedEpisodeQuery && (
                      <>
                        <button type="button" className="btn btn-sm" onClick={() => handleOpenScript(quickJumpEpisode.episodeNum)}>
                          打开 {formatEpisodeLabel(quickJumpEpisode.episodeNum)}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={!quickJumpEpisode.hasScript}
                          onClick={() => handleOpenProduction(quickJumpEpisode.episodeNum)}
                        >
                          去制作页
                        </button>
                      </>
                    )}
                    {normalizedEpisodeQuery && (
                      <button type="button" className="btn btn-sm" onClick={() => setEpisodeQuery('')}>
                        清空搜索
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
            <div className="delivery-handoff-episode-headline">
              <div>
                <strong>
                  {episodeFilter === 'focus'
                    ? '优先处理集数'
                    : episodeFilter === 'blocked'
                      ? '待补齐集数'
                      : episodeFilter === 'ready'
                        ? '可送制作集数'
                        : episodeFilter === 'active'
                          ? '制作推进集数'
                          : '全量分集视图'}
                </strong>
                <p className="text-secondary">
                  {episodeFilter === 'focus'
                    ? '把缺剧本、受阻塞和已进入制作但未完成的集数放在一起，适合收尾阶段盯盘。'
                    : `当前筛选共 ${filteredEpisodes.length} 集。`}
                </p>
              </div>
              <span className="delivery-handoff-pill">
                已就绪 {readyEpisodes.length} / {Math.max(totalEpisodes, handoffRows.length, 1)}
              </span>
            </div>
            <div className="delivery-handoff-episode-list">
              {visibleEpisodes.length > 0 ? (
                visibleEpisodes.map((row) => (
                  <div key={row.episodeNum} className={`delivery-handoff-episode ${row.canStartProduction ? 'is-ready' : row.hasScript ? 'is-waiting' : 'is-empty'}`}>
                    <div className="delivery-handoff-episode-primary">
                      <div className="delivery-handoff-episode-head">
                        <strong>{formatEpisodeLabel(row.episodeNum)}</strong>
                        <span className="delivery-handoff-episode-status">{row.handoffStatus}</span>
                      </div>
                      <div className="delivery-handoff-episode-badges">
                        <span className={`delivery-handoff-pill ${row.hasScript ? 'is-success' : 'is-warning'}`}>
                          {row.hasScript ? '剧本已就绪' : '缺剧本'}
                        </span>
                        <span className="delivery-handoff-pill">{row.pipelineLabel}</span>
                      </div>
                    </div>
                    <div className="delivery-handoff-episode-meta">
                      <div className="delivery-handoff-episode-meta-item">
                        <span className="task-summary-label">制作状态</span>
                        <strong>{row.productionStatus === 'complete' ? '已完成' : row.productionStatus !== 'idle' ? '推进中' : '未开始'}</strong>
                      </div>
                      <div className="delivery-handoff-episode-meta-item">
                        <span className="task-summary-label">下一步</span>
                        <strong>
                          {row.productionStatus === 'complete'
                            ? '检查交付包'
                            : row.productionStatus !== 'idle'
                              ? '继续制作'
                              : row.canStartProduction
                                ? '送入制作'
                                : row.hasScript
                                  ? '处理阻塞'
                                  : '补齐剧本'}
                        </strong>
                      </div>
                    </div>
                    <div className="delivery-handoff-episode-actions">
                      <button className="btn btn-sm" onClick={() => handleOpenScript(row.episodeNum)}>
                        打开剧本
                      </button>
                      <button
                        className="btn btn-sm"
                        disabled={!row.hasScript}
                        onClick={() => handleOpenProduction(row.episodeNum)}
                      >
                        查看制作
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="delivery-handoff-empty-state">
                  当前筛选下没有分集项目。
                </div>
              )}
            </div>
            {hiddenEpisodeCount > 0 && (
              <div className="delivery-handoff-episode-more">
                <span className="text-secondary text-xs">还有 {hiddenEpisodeCount} 集未展开，避免默认列表过长。</span>
                <button type="button" className="btn btn-sm" onClick={() => setShowAllEpisodes((value) => !value)}>
                  {showAllEpisodes ? '收起长列表' : '展开全部优先处理集'}
                </button>
              </div>
            )}
          </div>
        </section>

        {!embedded && (
          <aside className="delivery-handoff-sidebar">
          <div className="card delivery-handoff-summary">
            <div className="delivery-handoff-section-head">
              <h3>交付判断</h3>
              <span className={`delivery-handoff-pill ${canUpgrade ? 'is-success' : 'is-warning'}`}>
                {canUpgrade ? '可切换' : '待补齐'}
              </span>
            </div>
            <div className="delivery-handoff-summary-copy">
              <strong>{nextAction.title}</strong>
              <p className="text-secondary">{nextAction.description}</p>
            </div>
            <div className="delivery-handoff-metrics">
              {summaryMetrics.map((metric) => (
                <div key={metric.label} className="delivery-handoff-metric">
                  <span className="task-summary-label">{metric.label}</span>
                  <strong>{metric.value}</strong>
                </div>
              ))}
            </div>
            <div className="delivery-handoff-actions">
              <button className="btn" onClick={() => handleOpenPath(nextAction.path)}>
                {nextAction.label}
              </button>
              <button className="btn" onClick={handleOpenScriptIssues}>
                检查问题修订
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void handleUpgradePhase()}
                disabled={currentProject.phase === 'production' || !canUpgrade}
              >
                {currentProject.phase === 'production' ? '已在制作阶段' : '进入制作阶段'}
              </button>
            </div>
          </div>

          <div className="card delivery-handoff-gap-card">
            <div className="delivery-handoff-section-head">
              <h3>当前缺口</h3>
              <span className="text-secondary text-xs">把影响交付判断的事实直接列出来。</span>
            </div>
            <div className="delivery-handoff-gap-list">
              {reviewFailedData && (
                <div className="delivery-handoff-gap-item is-danger">
                  存在待处理审核失败项，建议先回到问题修订页面完成闭环。
                </div>
              )}
              {missingScriptEpisodes.length > 0 && (
                <div className="delivery-handoff-gap-item is-warning">
                  仍有 {missingScriptEpisodes.length} 集未成稿：{missingScriptEpisodes.map(formatEpisodeLabel).join('、')}
                </div>
              )}
              {isRunning && (
                <div className="delivery-handoff-gap-item is-warning">
                  当前仍有编剧任务运行中，建议等待本轮执行稳定后再切换阶段。
                </div>
              )}
              {!reviewFailedData && missingScriptEpisodes.length === 0 && !isRunning && (
                <div className="delivery-handoff-gap-item is-success">
                  当前没有明显交付阻塞，可以根据项目节奏决定是整体切换还是继续边写边制。
                </div>
              )}
            </div>
          </div>
          </aside>
        )}
      </div>
    </div>
  )
}
