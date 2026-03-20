import { useEffect, useRef, useState } from 'react'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useAdaptStore } from '@renderer/stores/adaptStore'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import { useToastStore } from '@renderer/stores/toastStore'
import { IPC } from '@shared/ipc-channels'
import type { PlotPoint, VolumePlan, AdaptPlan, ModelCategory } from '@shared/types'
import { createDefaultVolumePlan } from '@shared/types'
import SimpleMarkdown from '@renderer/components/SimpleMarkdown'
import EmptyState from '@renderer/components/layout/EmptyState'
import './BreakdownPage.css'

/** 批次信息 */
interface BatchInfo {
  batchNumber: number
  chapterStart: number
  chapterEnd: number
  plots: PlotPoint[]
}

/** 拆解解析结果 */
interface BreakdownData {
  title: string
  genre: string
  batches: BatchInfo[]
  allPlots: PlotPoint[]
}

type DrawerTab = 'plots' | 'plan'

export default function BreakdownPage() {
  const { currentProject } = useProjectStore()
  const {
    adaptState, waterLevel, isRunning, logs, streamOutput, error,
    lastStageReport, adaptPlan,
    userNotes, awaitingUser, reviewFailedData,
    fetchStatus, initAdapt, startBreakdown, startScript, startAuto,
    pause, abort, clearStream, fix, checkBreakdown, smartNext,
    breakdownAuto, scriptAuto, ensurePlan, loadPlan, savePlan, generatePlan,
    loadNotes, saveNotes, submitGuidance, clearReviewFailed,
    setupEventListeners
  } = useAdaptStore()
  const { getDefaultConfig } = useSettingsStore()
  const { addToast } = useToastStore()
  const streamRef = useRef<HTMLDivElement>(null)
  const [smartResult, setSmartResult] = useState<string | null>(null)

  // 底部抽屉
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('plots')

  // 剧情点数据
  const [breakdownData, setBreakdownData] = useState<BreakdownData | null>(null)
  const [planContent, setPlanContent] = useState<string>('')
  const [planLoaded, setPlanLoaded] = useState(false)
  const [expandedBatches, setExpandedBatches] = useState<Set<number>>(new Set())
  const [plotFilter, setPlotFilter] = useState<'all' | 'unused' | 'used'>('all')
  const [dataLoading, setDataLoading] = useState(false)
  const isFirstRender = useRef(true)

  // 改编规划相关状态
  const [editingPlan, setEditingPlan] = useState<AdaptPlan | null>(null)
  const [activeVolIndex, setActiveVolIndex] = useState(0)
  const [planGenerating, setPlanGenerating] = useState(false)

  // 日志面板折叠
  const [logsCollapsed, setLogsCollapsed] = useState(false)

  // 用户笔记
  const [notesOpen, setNotesOpen] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [notesSaving, setNotesSaving] = useState(false)

  // 质检干预
  const [guidanceText, setGuidanceText] = useState('')

  useEffect(() => {
    if (currentProject) {
      fetchStatus(currentProject.projectPath)
      loadPlan(currentProject.projectPath)
      loadNotes(currentProject.projectPath)
    }
  }, [currentProject])

  // 同步 userNotes 到 notesDraft
  useEffect(() => {
    setNotesDraft(userNotes)
  }, [userNotes])

  useEffect(() => {
    const cleanup = setupEventListeners()
    return cleanup
  }, [])

  // 自动滚动流式输出
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight
    }
  }, [streamOutput])

  // 打开抽屉并切换到对应 tab 时加载数据
  useEffect(() => {
    if (drawerOpen && drawerTab === 'plots' && currentProject && !breakdownData) {
      loadBreakdownData()
    }
    if (drawerOpen && drawerTab === 'plan' && currentProject && !planLoaded) {
      loadPlanContent()
    }
  }, [drawerOpen, drawerTab, currentProject])

  // 阶段完成后刷新剧情数据
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (lastStageReport && currentProject) {
      loadBreakdownData()
    }
  }, [lastStageReport])

  const loadBreakdownData = async () => {
    if (!currentProject) return
    setDataLoading(true)
    try {
      const data = await window.feicaiAPI.invoke(
        IPC.PLOT_GET_BREAKDOWN, currentProject.projectPath
      ) as BreakdownData | null
      setBreakdownData(data)
      if (data && data.batches.length > 0) {
        const lastBatches = data.batches.slice(-3).map(b => b.batchNumber)
        setExpandedBatches(new Set(lastBatches))
      }
    } catch {
      setBreakdownData(null)
    }
    setDataLoading(false)
  }

  const loadPlanContent = async () => {
    if (!currentProject) return
    try {
      const raw = await window.feicaiAPI.invoke(
        IPC.FILE_READ, `${currentProject.projectPath}/plot-breakdown.md`
      ) as string | null
      if (!raw) throw new Error('文件不存在')
      const planMatch = raw.match(/## (?:改编规划|改编计划|Adaptation Plan)\s*\n([\s\S]*?)(?=\n## |\n---\s*$)/im)
      setPlanContent(planMatch ? planMatch[1].trim() : '暂无改编规划。可点击「生成改编规划」按钮创建。')
    } catch {
      setPlanContent('暂无 plot-breakdown.md 文件。')
    }
    setPlanLoaded(true)
  }

  const toggleBatch = (batchNum: number) => {
    setExpandedBatches(prev => {
      const next = new Set(prev)
      next.has(batchNum) ? next.delete(batchNum) : next.add(batchNum)
      return next
    })
  }

  const expandAll = () => {
    if (breakdownData) {
      setExpandedBatches(new Set(breakdownData.batches.map(b => b.batchNumber)))
    }
  }
  const collapseAll = () => setExpandedBatches(new Set())

  const handleInit = async () => {
    if (!currentProject) return
    const llmConfig = getDefaultConfig('llm')
    if (!llmConfig) {
      addToast('error', '请先在设置中配置 LLM')
      return
    }
    await initAdapt(currentProject.id, currentProject.projectPath, llmConfig)
  }

  const handleBreakdown = async (count: number) => {
    if (adaptState === 'adapt_idle') await handleInit()
    clearStream()
    await startBreakdown(count)
  }

  const handleScript = async (count: number) => {
    if (adaptState === 'adapt_idle') await handleInit()
    clearStream()
    await startScript(count)
  }

  const handleAuto = async () => {
    if (adaptState === 'adapt_idle') await handleInit()
    clearStream()
    await startAuto()
  }

  const handleSmartNext = async () => {
    if (adaptState === 'adapt_idle') await handleInit()
    clearStream()
    const result = await smartNext()
    if (result) {
      setSmartResult(result.description)
      addToast('info', result.description)
    }
  }

  const handleCheckBreakdown = async () => {
    if (adaptState === 'adapt_idle') await handleInit()
    clearStream()
    await checkBreakdown()
  }

  const handleFix = async () => {
    clearStream()
    await fix()
  }

  const handleBreakdownAuto = async () => {
    if (adaptState === 'adapt_idle') await handleInit()
    clearStream()
    await breakdownAuto()
  }

  const handleScriptAuto = async () => {
    if (adaptState === 'adapt_idle') await handleInit()
    clearStream()
    await scriptAuto()
  }

  const handleEnsurePlan = async () => {
    if (adaptState === 'adapt_idle') await handleInit()
    clearStream()
    await ensurePlan()
    addToast('success', '改编规划已生成')
    setPlanLoaded(false)
    setPlanContent('')
    await loadPlanContent()
  }

  if (!currentProject) {
    return <div className="breakdown-page"><p>请先选择一个项目</p></div>
  }

  const stateLabel: Record<string, string> = {
    adapt_idle: '空闲',
    novel_loaded: '小说已加载',
    breakdown_executing: '📊 拆解中...',
    breakdown_reviewing: '🔍 拆解质检中...',
    breakdown_done: '✅ 拆解完成',
    script_executing: '✍️ 创作中...',
    script_reviewing: '🔍 剧本质检中...',
    script_done: '✅ 创作完成',
    adapt_paused: '⏸ 已暂停',
    adapt_awaiting_user: '⚠️ 等待用户指导',
    adapt_error: '❌ 出错'
  }

  // 水位数据
  const unusedPlots = waterLevel?.unusedPlots || 0
  const totalPlots = waterLevel?.totalPlots || 0
  const completedEps = waterLevel?.completedEpisodes || 0
  const unprocessedCh = waterLevel?.unprocessedChapters || 0
  const processedCh = waterLevel?.processedChapters || 0
  const totalCh = waterLevel?.totalChapters || 0
  const plotStatus = unusedPlots >= 10 ? '🟢 充足' : unusedPlots >= 5 ? '🟡 即将用尽' : unusedPlots > 0 ? '🟠 低' : '🔴 空'
  const breakdownPct = totalCh > 0 ? Math.round((processedCh / totalCh) * 100) : 0

  const getSmartSuggestion = () => {
    if (unusedPlots === 0 && unprocessedCh === 0) return '🎉 所有工作已完成！'
    if (unusedPlots >= 6 && unprocessedCh > 0) return '💡 未用剧情充足，建议转入剧本创作'
    if (unusedPlots >= 6 && unprocessedCh === 0) return '💡 最后的剧情储备，建议创作剧本'
    if (unusedPlots < 6 && unprocessedCh > 0) return '💡 剧情储备即将用尽，建议先拆解更多章节'
    if (unusedPlots === 0 && unprocessedCh > 0) return '💡 无可用剧情，需要先拆解'
    return '💡 输入「继续」一键执行建议操作'
  }

  const lastLogFail = logs.some(l => l.message.includes('❌') && l.message.includes('质检'))

  const getFilteredPlots = (plots: PlotPoint[]) => {
    if (plotFilter === 'unused') return plots.filter(p => p.status === 'unused')
    if (plotFilter === 'used') return plots.filter(p => p.status === 'used')
    return plots
  }

  const openDrawer = (tab: DrawerTab) => {
    if (drawerOpen && drawerTab === tab) {
      setDrawerOpen(false)
    } else {
      setDrawerTab(tab)
      setDrawerOpen(true)
    }
  }

  return (
    <div className="breakdown-page">
      {/* ==================== 页头 ==================== */}
      <div className="bd-page-header">
        <div className="bd-header-left">
          <h1 className="page-title">📊 剧情拆解</h1>
          <span className={`badge ${isRunning ? 'badge-warning' : adaptState.includes('done') ? 'badge-success' : 'badge-info'}`}>
            {stateLabel[adaptState] || adaptState}
          </span>
        </div>
        <div className="bd-header-right">
          {isRunning && (
            <>
              <button className="btn btn-sm" onClick={pause}>⏸ 暂停</button>
              <button className="btn btn-sm btn-danger" onClick={abort}>⏹ 停止</button>
            </>
          )}
        </div>
      </div>

      {/* ==================== 双栏仪表盘 ==================== */}
      <div className="bd-grid">
        {/* ===== 左栏：操作区 ===== */}
        <div className="bd-left">
          {/* ① 进度仪表盘 */}
          <div className="bd-dashboard">
            <div className="bd-progress-card">
              <div className="bd-progress-header">
                <span className="bd-progress-title">拆解进度</span>
                <span className="bd-progress-pct">{breakdownPct}%</span>
              </div>
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${breakdownPct}%` }} />
              </div>
              <div className="bd-progress-detail">
                已拆 {processedCh} 章 / 共 {totalCh} 章 · 剩余 {unprocessedCh} 章
              </div>
            </div>

            <div className="bd-metrics">
              <div className="bd-metric-card">
                <div className="bd-metric-icon">📊</div>
                <div className="bd-metric-value bd-v-accent">{totalPlots}</div>
                <div className="bd-metric-label">总剧情点</div>
              </div>
              <div className="bd-metric-card">
                <div className="bd-metric-icon">🎯</div>
                <div className={`bd-metric-value ${unusedPlots < 5 ? 'bd-v-warn' : 'bd-v-ok'}`}>
                  {unusedPlots}
                </div>
                <div className="bd-metric-label">未用剧情 {plotStatus}</div>
              </div>
              <div className="bd-metric-card">
                <div className="bd-metric-icon">✍️</div>
                <div className="bd-metric-value bd-v-accent">{completedEps}</div>
                <div className="bd-metric-label">已创作集数</div>
              </div>
              <div className="bd-metric-card">
                <div className="bd-metric-icon">📚</div>
                <div className={`bd-metric-value ${unprocessedCh > 0 ? 'bd-v-warn' : 'bd-v-ok'}`}>
                  {unprocessedCh}
                </div>
                <div className="bd-metric-label">待拆解章节</div>
              </div>
            </div>

            <div className="bd-suggestion">
              {getSmartSuggestion()}
            </div>
          </div>

          {/* ② 操作中心 — 分组卡片 */}
          <div className="bd-actions">
            {/* 拆解组 */}
            <div className="bd-action-group">
              <div className="bd-action-group-title">📊 拆解</div>
              <div className="bd-action-buttons">
                <button className="btn" disabled={isRunning} onClick={() => handleBreakdown(1)}>
                  拆解一批 (6章)
                </button>
                <button className="btn" disabled={isRunning} onClick={() => handleBreakdown(3)}>
                  × 3 批量拆解
                </button>
                <button className="btn" disabled={isRunning} onClick={handleBreakdownAuto}>
                  拆解到底
                </button>
              </div>
            </div>

            {/* 创作组 */}
            <div className="bd-action-group">
              <div className="bd-action-group-title">✍️ 创作</div>
              <div className="bd-action-buttons">
                <button className="btn" disabled={isRunning} onClick={() => handleScript(1)}>
                  创作一批
                </button>
                <button className="btn" disabled={isRunning} onClick={() => handleScript(3)}>
                  × 3 批量创作
                </button>
                <button className="btn" disabled={isRunning} onClick={handleScriptAuto}>
                  创作到底
                </button>
              </div>
            </div>

            {/* 智能组 */}
            <div className="bd-action-group bd-action-group-highlight">
              <div className="bd-action-group-title">⚡ 智能</div>
              <div className="bd-action-buttons">
                <button className="btn btn-primary" disabled={isRunning} onClick={handleSmartNext}>
                  ⏭ 智能下一步
                </button>
                <button className="btn btn-primary" disabled={isRunning} onClick={handleAuto}>
                  🚀 全自动
                </button>
                <button className="btn" disabled={isRunning} onClick={handleCheckBreakdown}>
                  🔍 手动质检
                </button>
                {lastLogFail && !isRunning && (
                  <button className="btn" onClick={handleFix}>
                    🔧 修正上批次
                  </button>
                )}
                <button className="btn" disabled={isRunning} onClick={handleEnsurePlan}>
                  📋 生成改编规划
                </button>
              </div>
            </div>
          </div>

          {/* ④ 质检干预面板 */}
          {awaitingUser && reviewFailedData && (
            <div className="bd-intervention-card">
              <div className="bd-intervention-header">
                <span className="bd-intervention-icon">⚠️</span>
                <span className="bd-intervention-title">
                  {reviewFailedData.stage === 'breakdown' ? '拆解' : '剧本'}质检未通过 — 需要您的指导
                </span>
              </div>
              <div className="bd-intervention-body">
                <p className="bd-intervention-desc">
                  已重试 {reviewFailedData.retryCount} 次仍未通过质检。请查看右侧 LLM 输出中的质检报告，提供修正指导帮助 AI 理解正确方向。
                </p>
                <textarea
                  className="bd-intervention-textarea"
                  value={guidanceText}
                  onChange={(e) => setGuidanceText(e.target.value)}
                  placeholder={'例如：\n• 第4章的原文缺失了，跳过第4章\n• 朱元璋是从邓铭手里接过鞭子，不是从太子手里夺\n• 这是穿越文，要强化系统面板和降维打击的爽感'}
                  rows={5}
                />
                <div className="bd-intervention-actions">
                  <button
                    className="btn btn-primary"
                    disabled={!guidanceText.trim()}
                    onClick={async () => {
                      await submitGuidance(guidanceText.trim())
                      setGuidanceText('')
                    }}
                  >
                    📝 提交指导并重试
                  </button>
                  <button className="btn" onClick={() => {
                    clearReviewFailed()
                    abort()
                  }}>⏹ 中止</button>
                </div>
              </div>
            </div>
          )}

          {/* ⑤ 用户笔记面板 */}
          <div className="bd-notes-card">
            <div className="bd-notes-header" onClick={() => setNotesOpen(!notesOpen)}>
              <span>📝 用户指导笔记</span>
              <span className="bd-notes-toggle">{notesOpen ? '▾' : '▸'}</span>
            </div>
            {notesOpen && (
              <div className="bd-notes-body">
                <textarea
                  className="bd-notes-textarea"
                  value={notesDraft}
                  onChange={e => setNotesDraft(e.target.value)}
                  placeholder={'在这里写下对小说的理解和指导，会注入到每次 LLM 调用中...\n\n例如：\n• 这是穿越+系统流，主角有「怒气值兑换系统」\n• 第4章原文缺失，拆解时跳过\n• 老朱（朱元璋）性格暴戾但护短\n• 重点强化「降维打击」和「打脸」爽感'}
                  rows={6}
                />
                <div className="bd-notes-actions">
                  <button
                    className="btn btn-sm"
                    disabled={notesSaving || notesDraft === userNotes}
                    onClick={async () => {
                      if (!currentProject) return
                      setNotesSaving(true)
                      await saveNotes(currentProject.projectPath, notesDraft)
                      setNotesSaving(false)
                      addToast('success', '用户笔记已保存')
                    }}
                  >
                    {notesSaving ? '保存中...' : '💾 保存笔记'}
                  </button>
                  {notesDraft !== userNotes && (
                    <span className="bd-notes-dirty">● 有未保存的修改</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ⑥ 阶段完成报告 */}
          {lastStageReport && (
            <div className="bd-report-card">
              <div className="bd-report-header">
                <span className="bd-report-title">
                  {lastStageReport.stage === 'breakdown' ? '📊 拆解完成' : '✍️ 创作完成'}
                </span>
                {lastStageReport.batchNum && (
                  <span className="badge badge-info">第 {lastStageReport.batchNum} 批</span>
                )}
              </div>
              <div className="bd-report-body">
                {lastStageReport.chapterRange && (
                  <div className="bd-report-item">
                    <span className="bd-report-label">章节范围</span>
                    <span className="bd-report-value">
                      第{lastStageReport.chapterRange[0]}章 ~ 第{lastStageReport.chapterRange[1]}章
                    </span>
                  </div>
                )}
                {lastStageReport.extractedPlots != null && (
                  <div className="bd-report-item">
                    <span className="bd-report-label">提取剧情</span>
                    <span className="bd-report-value bd-v-ok">{lastStageReport.extractedPlots} 个</span>
                  </div>
                )}
                {lastStageReport.episodeRange && (
                  <div className="bd-report-item">
                    <span className="bd-report-label">创作集数</span>
                    <span className="bd-report-value">{lastStageReport.episodeRange}</span>
                  </div>
                )}
                {lastStageReport.episodeCount != null && (
                  <div className="bd-report-item">
                    <span className="bd-report-label">创作集数</span>
                    <span className="bd-report-value bd-v-ok">{lastStageReport.episodeCount} 集</span>
                  </div>
                )}
                {lastStageReport.summary && (
                  <div className="bd-report-summary">{lastStageReport.summary}</div>
                )}
              </div>
            </div>
          )}

          {/* ④ 智能建议 / 错误 */}
          {smartResult && (
            <div className="bd-info-card bd-info-accent">
              <p>{smartResult}</p>
            </div>
          )}

          {error && (
            <div className="bd-info-card bd-info-error">
              <p>❌ {error}</p>
            </div>
          )}
        </div>

        {/* ===== 右栏：输出区 ===== */}
        <div className="bd-right">
          {/* ⑤ LLM 实时输出 */}
          <div className="bd-output-panel">
            <div className="bd-output-header">
              <span className="bd-output-title">
                📝 实时输出
                {isRunning && <span className="bd-running-dot" />}
              </span>
              {streamOutput && (
                <button className="btn btn-sm" onClick={clearStream}>清空</button>
              )}
            </div>
            <div className="bd-output-body" ref={streamRef}>
              {streamOutput || (isRunning
                ? '等待 LLM 响应...'
                : '执行操作后，LLM 输出将显示在此处'
              )}
            </div>
          </div>

          {/* ⑥ 执行日志 */}
          <div className={`bd-log-panel ${logsCollapsed ? 'collapsed' : ''}`}>
            <div className="bd-log-header" onClick={() => setLogsCollapsed(!logsCollapsed)}>
              <span className="bd-log-title">
                📋 执行日志
                {logs.length > 0 && <span className="bd-log-count">{logs.length}</span>}
              </span>
              <span className="bd-log-toggle">{logsCollapsed ? '▶' : '▼'}</span>
            </div>
            {!logsCollapsed && (
              <div className="bd-log-body">
                {logs.length === 0 ? (
                  <div className="bd-log-empty">暂无日志</div>
                ) : (
                  logs.map((entry) => (
                    <div key={entry.id} className={`bd-log-entry log-${entry.level}`}>
                      <span className="bd-log-time">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                      <span>{entry.message}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ==================== 底部可折叠抽屉 ==================== */}
      <div className={`bd-drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="bd-drawer-tabs">
          <button
            className={`bd-drawer-tab ${drawerOpen && drawerTab === 'plots' ? 'active' : ''}`}
            onClick={() => openDrawer('plots')}
          >
            📋 剧情列表
            {breakdownData && (
              <span className="bd-drawer-tab-count">{breakdownData.allPlots.length}</span>
            )}
          </button>
          <button
            className={`bd-drawer-tab ${drawerOpen && drawerTab === 'plan' ? 'active' : ''}`}
            onClick={() => openDrawer('plan')}
          >
            📐 改编规划
          </button>
          <div className="bd-drawer-spacer" />
          <button
            className="bd-drawer-toggle"
            onClick={() => setDrawerOpen(!drawerOpen)}
          >
            {drawerOpen ? '▼ 收起' : '▲ 展开'}
          </button>
        </div>

        {drawerOpen && (
          <div className="bd-drawer-body">
            {/* ===== 剧情列表 ===== */}
            {drawerTab === 'plots' && (
              <div className="plots-section">
                {dataLoading ? (
                  <div className="plots-loading">加载剧情数据...</div>
                ) : !breakdownData ? (
                  <EmptyState
                    icon="📋"
                    title="暂无剧情拆解数据"
                    description="请先在操作中心执行拆解操作"
                  />
                ) : (
                  <>
                    <div className="plots-summary">
                      <div className="plots-summary-left">
                        <span className="plots-stat">
                          <strong>{breakdownData.allPlots.length}</strong> 剧情点
                        </span>
                        <span className="plots-stat">
                          <strong>{breakdownData.batches.length}</strong> 批次
                        </span>
                        <span className="plots-stat plots-stat-used">
                          <strong>{breakdownData.allPlots.filter(p => p.status === 'used').length}</strong> 已用
                        </span>
                        <span className="plots-stat plots-stat-unused">
                          <strong>{breakdownData.allPlots.filter(p => p.status === 'unused').length}</strong> 未用
                        </span>
                      </div>
                      <div className="plots-summary-right">
                        <select
                          className="plots-filter-select"
                          value={plotFilter}
                          onChange={e => setPlotFilter(e.target.value as any)}
                        >
                          <option value="all">全部</option>
                          <option value="unused">未用</option>
                          <option value="used">已用</option>
                        </select>
                        <button className="btn btn-sm" onClick={expandAll}>全部展开</button>
                        <button className="btn btn-sm" onClick={collapseAll}>全部折叠</button>
                        <button className="btn btn-sm" onClick={loadBreakdownData}>🔄 刷新</button>
                      </div>
                    </div>

                    <div className="batch-list">
                      {breakdownData.batches.map(batch => {
                        const filteredPlots = getFilteredPlots(batch.plots)
                        const isExpanded = expandedBatches.has(batch.batchNumber)
                        const usedCount = batch.plots.filter(p => p.status === 'used').length
                        const unusedCount = batch.plots.filter(p => p.status === 'unused').length

                        if (plotFilter !== 'all' && filteredPlots.length === 0) return null

                        return (
                          <div key={batch.batchNumber} className={`batch-group ${isExpanded ? 'expanded' : ''}`}>
                            <div className="batch-header" onClick={() => toggleBatch(batch.batchNumber)}>
                              <div className="batch-header-left">
                                <span className="batch-toggle">{isExpanded ? '▼' : '▶'}</span>
                                <span className="batch-title">第 {batch.batchNumber} 批</span>
                                <span className="batch-chapters text-secondary">
                                  第{batch.chapterStart}-{batch.chapterEnd}章
                                </span>
                              </div>
                              <div className="batch-header-right">
                                <span className="batch-count">{batch.plots.length} 个剧情</span>
                                {usedCount > 0 && <span className="batch-used-badge">✅ {usedCount}</span>}
                                {unusedCount > 0 && <span className="batch-unused-badge">⏳ {unusedCount}</span>}
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="batch-body">
                                {filteredPlots.map(plot => (
                                  <div key={plot.id} className={`plot-card ${plot.status === 'used' ? 'plot-used' : 'plot-unused'}`}>
                                    <div className="plot-card-header">
                                      <span className="plot-id">剧情{plot.id}</span>
                                      <span className={`plot-status-badge ${plot.status === 'used' ? 'status-used' : 'status-unused'}`}>
                                        {plot.status === 'used' ? '✅ 已用' : '⏳ 未用'}
                                      </span>
                                      <span className="plot-episode">第{plot.episode}集</span>
                                    </div>
                                    <div className="plot-card-body">
                                      <div className="plot-scene">
                                        <span className="plot-scene-label">📍</span>
                                        {plot.scene}
                                      </div>
                                      <div className="plot-desc">{plot.description}</div>
                                    </div>
                                    <div className="plot-card-footer">
                                      <span className="plot-hook">{plot.hookType}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ===== 改编规划 ===== */}
            {drawerTab === 'plan' && (
              <PlanTabContent
                currentProject={currentProject}
                adaptPlan={adaptPlan}
                editingPlan={editingPlan}
                setEditingPlan={setEditingPlan}
                activeVolIndex={activeVolIndex}
                setActiveVolIndex={setActiveVolIndex}
                planGenerating={planGenerating}
                setPlanGenerating={setPlanGenerating}
                isRunning={isRunning}
                savePlan={savePlan}
                generatePlan={generatePlan}
                getDefaultConfig={getDefaultConfig}
                addToast={addToast}
                novelInfo={useAdaptStore.getState().novelInfo}
                handleEnsurePlan={handleEnsurePlan}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ==================== 改编规划 Tab 组件 ====================

function PlanTabContent({ currentProject, adaptPlan, editingPlan, setEditingPlan,
  activeVolIndex, setActiveVolIndex, planGenerating, setPlanGenerating,
  isRunning, savePlan, generatePlan, getDefaultConfig, addToast, novelInfo, handleEnsurePlan
}: {
  currentProject: any
  adaptPlan: AdaptPlan | null
  editingPlan: AdaptPlan | null
  setEditingPlan: (p: AdaptPlan | null) => void
  activeVolIndex: number
  setActiveVolIndex: (i: number) => void
  planGenerating: boolean
  setPlanGenerating: (b: boolean) => void
  isRunning: boolean
  savePlan: (path: string, plan: AdaptPlan) => Promise<void>
  generatePlan: (path: string, vol: VolumePlan, llm: any) => Promise<string>
  getDefaultConfig: (cat: ModelCategory) => any
  addToast: (type: 'success' | 'error' | 'info' | 'warning', msg: string) => void
  novelInfo: any
  handleEnsurePlan: () => Promise<void>
}) {
  const plan = editingPlan || adaptPlan
  const totalChapters = novelInfo?.totalChapters || 0

  const initEditingPlan = () => {
    if (!editingPlan) {
      if (adaptPlan) {
        setEditingPlan({ ...adaptPlan, volumes: adaptPlan.volumes.map(v => ({ ...v })) })
      } else {
        setEditingPlan({
          volumes: [createDefaultVolumePlan(0, totalChapters)],
          activeVolumeIndex: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
      }
    }
  }

  const currentVol = plan?.volumes[activeVolIndex]

  const updateVolField = (field: keyof VolumePlan, value: any) => {
    initEditingPlan()
    const current = editingPlan || (adaptPlan ? { ...adaptPlan, volumes: adaptPlan.volumes.map((v: VolumePlan) => ({ ...v })) } : null)
    if (!current) return
    const updated = { ...current, volumes: current.volumes.map((v: VolumePlan, i: number) =>
      i === activeVolIndex ? { ...v, [field]: value } : v
    )}
    setEditingPlan(updated)
  }

  const addVolume = () => {
    initEditingPlan()
    const current = editingPlan || (adaptPlan ? { ...adaptPlan, volumes: adaptPlan.volumes.map((v: VolumePlan) => ({ ...v })) } : null)
    if (!current) return
    const newVol = createDefaultVolumePlan(current.volumes.length, totalChapters)
    const lastVol = current.volumes[current.volumes.length - 1]
    if (lastVol) {
      newVol.chapterRange = [lastVol.chapterRange[1] + 1, Math.min(lastVol.chapterRange[1] + 200, totalChapters)]
    }
    setEditingPlan({ ...current, volumes: [...current.volumes, newVol] })
  }

  const removeVolume = (index: number) => {
    if (!editingPlan || editingPlan.volumes.length <= 1) return
    setEditingPlan({
      ...editingPlan,
      volumes: editingPlan.volumes.filter((_, i) => i !== index),
      activeVolumeIndex: Math.min(editingPlan.activeVolumeIndex, editingPlan.volumes.length - 2)
    })
    if (activeVolIndex >= editingPlan.volumes.length - 1) {
      setActiveVolIndex(Math.max(0, activeVolIndex - 1))
    }
  }

  const handleSave = async () => {
    if (!currentProject || !editingPlan) return
    editingPlan.activeVolumeIndex = activeVolIndex
    await savePlan(currentProject.projectPath, editingPlan)
    addToast('success', '改编规划已保存')
  }

  const handleGenerate = async () => {
    if (!currentProject || !currentVol) return
    const llmConfig = getDefaultConfig('llm')
    if (!llmConfig) {
      addToast('error', '请先在设置中配置 LLM')
      return
    }

    let planToUse: AdaptPlan
    if (editingPlan) {
      planToUse = { ...editingPlan, volumes: editingPlan.volumes.map(v => ({ ...v })) }
    } else if (adaptPlan) {
      planToUse = { ...adaptPlan, volumes: adaptPlan.volumes.map(v => ({ ...v })) }
    } else {
      planToUse = {
        volumes: [createDefaultVolumePlan(0, totalChapters)],
        activeVolumeIndex: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }
    setEditingPlan(planToUse)
    setPlanGenerating(true)

    try {
      const volForGenerate = planToUse.volumes[activeVolIndex]
      if (!volForGenerate) throw new Error('当前卷不存在')
      const result = await generatePlan(currentProject.projectPath, volForGenerate, llmConfig)

      const updated: AdaptPlan = {
        ...planToUse,
        volumes: planToUse.volumes.map((v, i) =>
          i === activeVolIndex ? { ...v, llmPlan: result } : v
        )
      }
      setEditingPlan(updated)
      addToast('success', 'LLM 规划已生成')
    } catch (e) {
      addToast('error', `规划生成失败: ${e instanceof Error ? e.message : String(e)}`)
    }
    setPlanGenerating(false)
  }

  const RangeInput = ({ label, field, min, max }: {
    label: string; field: keyof VolumePlan; min?: number; max?: number
  }) => {
    const val = (currentVol?.[field] || [0, 0]) as [number, number]
    return (
      <div className="plan-form-row">
        <label className="plan-form-label">{label}</label>
        <div className="plan-range-inputs">
          <input type="number" className="plan-input plan-input-sm"
            value={val[0]} min={min} max={max}
            onChange={e => updateVolField(field, [parseInt(e.target.value) || 0, val[1]])}
          />
          <span className="plan-range-sep">~</span>
          <input type="number" className="plan-input plan-input-sm"
            value={val[1]} min={min} max={max}
            onChange={e => updateVolField(field, [val[0], parseInt(e.target.value) || 0])}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="plan-section">
      <div className="plan-header">
        <h2>📐 改编规划</h2>
        <div className="flex gap-sm">
          {!adaptPlan && (
            <button className="btn btn-sm" disabled={isRunning} onClick={() => { initEditingPlan() }}>
              ➕ 创建规划
            </button>
          )}
          <button className="btn btn-sm" disabled={isRunning} onClick={handleEnsurePlan}>
            🤖 自动规划（旧版）
          </button>
        </div>
      </div>

      {!plan ? (
        <EmptyState
          icon="📋"
          title="暂无改编规划"
          description="点击「创建规划」设置改编范围和参数，或点击「自动规划」使用 LLM 快速生成"
          action={{ label: '创建规划', onClick: initEditingPlan }}
        />
      ) : (
        <>
          {/* 卷选择器 */}
          <div className="plan-volume-selector">
            {plan.volumes.map((vol, i) => (
              <button
                key={i}
                className={`plan-vol-btn ${i === activeVolIndex ? 'active' : ''}`}
                onClick={() => setActiveVolIndex(i)}
              >
                {vol.volumeLabel}
                {plan.volumes.length > 1 && editingPlan && (
                  <span className="plan-vol-remove" onClick={(e) => { e.stopPropagation(); removeVolume(i) }}>×</span>
                )}
              </button>
            ))}
            <button className="plan-vol-btn plan-vol-add" onClick={addVolume}>
              + 新增卷
            </button>
          </div>

          {currentVol && (
            <div className="plan-form-grid">
              {/* 左侧：参数表单 */}
              <div className="plan-form">
                <h3 className="plan-form-title">📝 改编参数</h3>

                <div className="plan-form-row">
                  <label className="plan-form-label">卷名称</label>
                  <input type="text" className="plan-input"
                    value={currentVol.volumeLabel}
                    onChange={e => updateVolField('volumeLabel', e.target.value)}
                  />
                </div>

                <RangeInput label="章节范围" field="chapterRange" min={1} max={totalChapters || 9999} />

                <div className="plan-form-row">
                  <label className="plan-form-label">目标集数</label>
                  <input type="number" className="plan-input plan-input-sm"
                    value={currentVol.targetEpisodes} min={1}
                    onChange={e => updateVolField('targetEpisodes', parseInt(e.target.value) || 1)}
                  />
                </div>

                <RangeInput label="单集字数" field="episodeWordCount" min={500} />
                <RangeInput label="剧情点/集" field="plotsPerEpisode" min={1} />
                <RangeInput label="场景/集" field="scenesPerEpisode" min={1} />
                <RangeInput label="Seedance/集" field="seedancePerEpisode" min={3} />

                <div className="plan-form-row plan-form-row-full">
                  <label className="plan-form-label">章集分配原则</label>
                  <textarea className="plan-textarea"
                    value={currentVol.chapterAllocation}
                    onChange={e => updateVolField('chapterAllocation', e.target.value)}
                    rows={2}
                  />
                </div>

                <div className="plan-form-row plan-form-row-full">
                  <label className="plan-form-label">其他要求</label>
                  <textarea className="plan-textarea"
                    value={currentVol.additionalNotes}
                    onChange={e => updateVolField('additionalNotes', e.target.value)}
                    rows={2}
                    placeholder="例如：第20集为付费节点，需要强悬念结尾"
                  />
                </div>

                <div className="plan-form-actions">
                  <button className="btn btn-primary" onClick={handleGenerate}
                    disabled={planGenerating || isRunning}
                  >
                    {planGenerating ? '🤖 生成中...' : '🤖 LLM 辅助规划'}
                  </button>
                  <button className="btn btn-primary" onClick={handleSave}
                    disabled={!editingPlan}
                  >
                    💾 保存规划
                  </button>
                </div>
              </div>

              {/* 右侧：规划预览/编辑 */}
              <div className="plan-preview">
                <h3 className="plan-form-title">📝 规划内容（可编辑）</h3>
                <textarea
                  className="plan-editor"
                  value={currentVol.llmPlan}
                  onChange={e => updateVolField('llmPlan', e.target.value)}
                  placeholder="点击「LLM 辅助规划」生成，或直接输入你的改编规划..."
                />
                {currentVol.llmPlan && (
                  <div className="plan-preview-rendered">
                    <h4>预览</h4>
                    <SimpleMarkdown content={currentVol.llmPlan} />
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
