import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useAdaptStore } from '@renderer/stores/adaptStore'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import { useToastStore } from '@renderer/stores/toastStore'
import { platformAPI } from '@renderer/platform/api'
import { IPC } from '@shared/ipc-channels'
import type { PlotPoint, VolumePlan, AdaptPlan, ModelCategory, ReviewResult } from '@shared/types'
import { createDefaultVolumePlan } from '@shared/types'
import SimpleMarkdown from '@renderer/components/SimpleMarkdown'
import EmptyState from '@renderer/components/layout/EmptyState'
import './BreakdownPage.css'

interface BreakdownPageProps {
  embedded?: boolean
}

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

interface LoadBreakdownOptions {
  preserveOnError?: boolean
}

interface LoadPlanContentOptions {
  preserveOnError?: boolean
}

export default function BreakdownPage({ embedded = false }: BreakdownPageProps) {
  const navigate = useNavigate()
  const { currentProject } = useProjectStore()
  const {
    adaptState, waterLevel, isRunning, logs, streamOutput, error,
    lastStageReport, lastReviewResult, adaptPlan,
    userNotes, awaitingUser, reviewFailedData,
    fetchStatus, initAdapt, startBreakdown, startScript, startAuto,
    pause, abort, clearStream, fix, checkBreakdown, checkScript, smartNext,
    breakdownAuto, scriptAuto, ensurePlan, loadPlan, savePlan, generatePlan, rebuildBreakdown,
    loadNotes, saveNotes, submitGuidance, clearReviewFailed,
    setupEventListeners, resetState
  } = useAdaptStore()
  const { getDefaultConfig } = useSettingsStore()
  const { addToast } = useToastStore()
  const streamRef = useRef<HTMLDivElement>(null)
  const [smartResult, setSmartResult] = useState<string | null>(null)
  const [reviewEpisode, setReviewEpisode] = useState<number | ''>('')
  const [rebuildChapterStart, setRebuildChapterStart] = useState<number | ''>('')
  const [rebuildChapterEnd, setRebuildChapterEnd] = useState<number | ''>('')
  const [rebuildEpisodeStart, setRebuildEpisodeStart] = useState<number | ''>('')
  const [rebuildEpisodeEnd, setRebuildEpisodeEnd] = useState<number | ''>('')

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
  const breakdownLoadTokenRef = useRef(0)
  const planContentLoadTokenRef = useRef(0)

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
    breakdownLoadTokenRef.current += 1
    planContentLoadTokenRef.current += 1
    resetState()
    setSmartResult(null)
    setReviewEpisode('')
    setRebuildChapterStart('')
    setRebuildChapterEnd('')
    setRebuildEpisodeStart('')
    setRebuildEpisodeEnd('')
    setDrawerOpen(false)
    setDrawerTab('plots')
    setBreakdownData(null)
    setPlanContent('')
    setPlanLoaded(false)
    setExpandedBatches(new Set())
    setPlotFilter('all')
    setDataLoading(false)
    setEditingPlan(null)
    setActiveVolIndex(0)
    setPlanGenerating(false)
    setLogsCollapsed(false)
    setNotesOpen(false)
    setNotesDraft('')
    setNotesSaving(false)
    setGuidanceText('')
    if (currentProject) {
      fetchStatus(currentProject.projectPath)
      loadPlan(currentProject.projectPath)
      loadNotes(currentProject.projectPath)
    }
  }, [currentProject?.id])

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
      loadBreakdownData({ preserveOnError: true })
    }
  }, [lastStageReport])

  const loadBreakdownData = async (options?: LoadBreakdownOptions): Promise<boolean> => {
    if (!currentProject) return false
    const projectId = currentProject.id
    const requestToken = ++breakdownLoadTokenRef.current
    setDataLoading(true)
    let loaded = false
    try {
      const data = await platformAPI.invoke(
        IPC.PLOT_GET_BREAKDOWN, currentProject.projectPath
      ) as BreakdownData | null
      if (breakdownLoadTokenRef.current !== requestToken || useProjectStore.getState().currentProject?.id !== projectId) {
        return false
      }
      setBreakdownData(data)
      if (data && data.batches.length > 0) {
        const lastBatches = data.batches.slice(-3).map(b => b.batchNumber)
        setExpandedBatches(new Set(lastBatches))
      }
      loaded = true
    } catch {
      if (breakdownLoadTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === projectId && !options?.preserveOnError) {
        setBreakdownData(null)
      }
    } finally {
      if (breakdownLoadTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === projectId) {
        setDataLoading(false)
      }
    }
    return loaded
  }

  const loadPlanContent = async (options?: LoadPlanContentOptions): Promise<boolean> => {
    if (!currentProject) return false
    const projectId = currentProject.id
    const requestToken = ++planContentLoadTokenRef.current
    let loaded = false
    try {
      const raw = await platformAPI.invoke(
        IPC.PLOT_READ_RAW,
        currentProject.projectPath
      ) as string | null
      if (planContentLoadTokenRef.current !== requestToken || useProjectStore.getState().currentProject?.id !== projectId) {
        return false
      }
      if (!raw) throw new Error('文件不存在')
      const planMatch = raw.match(/## (?:改编规划|改编计划|Adaptation Plan)\s*\n([\s\S]*?)(?=\n## |\n---\s*$)/im)
      setPlanContent(planMatch ? planMatch[1].trim() : '暂无改编规划。可点击「生成改编规划」按钮创建。')
      loaded = true
    } catch {
      if (planContentLoadTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === projectId && !options?.preserveOnError) {
        setPlanContent('暂无 plot-breakdown.md 文件。')
      }
    } finally {
      if (planContentLoadTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === projectId) {
        setPlanLoaded(loaded || !options?.preserveOnError)
      }
    }
    return loaded
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

  const handleInit = async (): Promise<boolean> => {
    if (!currentProject) return false
    const llmConfig = getDefaultConfig('llm')
    if (!llmConfig) {
      addToast('error', '请先在设置中配置 LLM')
      return false
    }
    return initAdapt(currentProject.id, currentProject.projectPath, llmConfig)
  }

  const handleBreakdown = async (count: number) => {
    if (adaptState === 'adapt_idle' && !(await handleInit())) return
    clearStream()
    await startBreakdown(count)
  }

  const handleScript = async (count: number) => {
    if (adaptState === 'adapt_idle' && !(await handleInit())) return
    clearStream()
    await startScript(count)
  }

  const handleAuto = async () => {
    if (adaptState === 'adapt_idle' && !(await handleInit())) return
    clearStream()
    await startAuto()
  }

  const handleSmartNext = async () => {
    if (adaptState === 'adapt_idle' && !(await handleInit())) return
    clearStream()
    const result = await smartNext()
    if (result) {
      setSmartResult(result.description)
      addToast('info', result.description)
    }
  }

  const handleCheckBreakdown = async () => {
    if (adaptState === 'adapt_idle' && !(await handleInit())) return
    clearStream()
    await checkBreakdown()
  }

  const handleRebuildByChapterRange = async () => {
    if (adaptState === 'adapt_idle' && !(await handleInit())) return
    if (rebuildChapterStart === '' || rebuildChapterEnd === '') {
      addToast('warning', '请先填写要重拆的章节范围')
      return
    }
    clearStream()
    const success = await rebuildBreakdown({
      chapterStart: rebuildChapterStart,
      chapterEnd: rebuildChapterEnd
    })
    if (!success) return
    addToast('success', `已开始重拆第${rebuildChapterStart}-${rebuildChapterEnd}章`)
  }

  const handleRebuildByEpisodeRange = async () => {
    if (adaptState === 'adapt_idle' && !(await handleInit())) return
    if (rebuildEpisodeStart === '' || rebuildEpisodeEnd === '') {
      addToast('warning', '请先填写要重拆的集数区间')
      return
    }
    clearStream()
    const success = await rebuildBreakdown({
      episodeStart: rebuildEpisodeStart,
      episodeEnd: rebuildEpisodeEnd
    })
    if (!success) return
    addToast('success', `已开始按第${rebuildEpisodeStart}-${rebuildEpisodeEnd}集关联范围重拆`)
  }

  const handleRebuildBatch = async (batch: BatchInfo) => {
    if (adaptState === 'adapt_idle' && !(await handleInit())) return
    clearStream()
    const success = await rebuildBreakdown({
      chapterStart: batch.chapterStart,
      chapterEnd: batch.chapterEnd
    })
    if (!success) return
    addToast('success', `已开始重拆第${batch.batchNumber}批（第${batch.chapterStart}-${batch.chapterEnd}章）`)
  }

  const handleCheckScript = async () => {
    if (adaptState === 'adapt_idle' && !(await handleInit())) return
    clearStream()
    const ep = reviewEpisode === '' ? undefined : reviewEpisode
    await checkScript(ep)
  }

  const handleFix = async () => {
    clearStream()
    await fix()
  }

  const handleBreakdownAuto = async () => {
    if (adaptState === 'adapt_idle' && !(await handleInit())) return
    clearStream()
    await breakdownAuto()
  }

  const handleScriptAuto = async () => {
    if (adaptState === 'adapt_idle' && !(await handleInit())) return
    clearStream()
    await scriptAuto()
  }

  const handleEnsurePlan = async () => {
    if (adaptState === 'adapt_idle' && !(await handleInit())) return
    clearStream()
    const success = await ensurePlan()
    if (!success) return
    addToast('success', '改编规划已生成')
    setPlanLoaded(false)
    const refreshed = await loadPlanContent({ preserveOnError: true })
    if (!refreshed) {
      addToast('warning', '改编规划已生成，但规划内容刷新失败')
    }
  }

  const handlePause = async () => {
    const success = await pause()
    addToast(success ? 'info' : 'error', success ? '编剧管线已暂停' : '暂停失败')
  }

  const handleAbort = async (options?: { clearIntervention?: boolean }) => {
    const success = await abort()
    if (!success) {
      addToast('error', '停止失败')
      return false
    }
    if (options?.clearIntervention) {
      clearReviewFailed()
    }
    addToast('warning', '编剧管线已停止')
    return true
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
  const planReady = !!adaptPlan
  const scriptsNeedMorePlots = unusedPlots < 4 && unprocessedCh > 0
  const stateToneClass = isRunning
    ? 'badge-warning'
    : adaptState.includes('done')
      ? 'badge-success'
      : adaptState === 'adapt_error'
        ? 'badge-danger'
        : 'badge-info'
  const currentFocus = reviewFailedData
    ? {
        title: '先处理失败项',
        description: reviewFailedData.stage === 'breakdown'
          ? '当前阻塞发生在剧情拆解环节，先把拆解质检问题闭环。'
          : '当前阻塞发生在剧本环节，建议先转到分集剧本处理修订。',
        action: reviewFailedData.stage === 'breakdown' ? '处理拆解问题' : '去分集剧本',
        onClick: () => {
          if (reviewFailedData.stage === 'breakdown') {
            if (!awaitingUser) return
            const el = document.querySelector('.bd-intervention-card')
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          } else if (currentProject) {
            navigate(`/project/${currentProject.id}/script`)
          }
        }
      }
    : totalCh === 0
      ? {
          title: '先补源稿输入',
          description: '当前没有章节输入，规划和拆解都缺少基础材料。',
          action: '打开小说源稿',
          onClick: () => {
            if (!currentProject) return
            navigate(`/project/${currentProject.id}/source`)
          }
        }
      : !planReady && processedCh === 0
        ? {
            title: '先形成规划基础',
            description: '当前还没有稳定的剧情库存与卷级规划，建议先拆解一批章节。',
            action: '开始拆解',
            onClick: () => { void handleBreakdown(1) }
          }
        : scriptsNeedMorePlots
          ? {
              title: '补充剧情库存',
              description: `当前只剩 ${unusedPlots} 个可用剧情点，建议继续拆解，避免剧本写到一半断粮。`,
              action: '继续拆解',
              onClick: () => { void handleBreakdown(1) }
            }
          : {
              title: '把库存转成剧本',
              description: '当前库存和规划已经具备基本条件，可以开始把剧情点转成分集剧本。',
              action: '进入分集剧本',
              onClick: () => {
                if (!currentProject) return
                navigate(`/project/${currentProject.id}/script`)
              }
            }

  const planningRisks = [
    reviewFailedData
      ? '当前存在待处理审核失败项，建议先闭环后再扩张流程。'
      : '',
    totalCh === 0
      ? '当前还没有可用章节输入，规划和拆解都会缺少依据。'
      : '',
    !planReady && processedCh > 0
      ? '已经有拆解结果，但还没有稳定的卷级规划，后续创作可能缺少统一方向。'
      : '',
    scriptsNeedMorePlots
      ? `当前库存仅剩 ${unusedPlots} 个剧情点，继续写作前建议先补库存。`
      : '',
    !isRunning && totalCh > 0 && unprocessedCh === 0 && unusedPlots === 0
      ? '章节已经拆完且库存已用尽，后续主要工作会转向剧本修订与交付。'
      : ''
  ].filter(Boolean)
  const focusMeta = [
    planReady ? '卷级规划已建立' : '卷级规划待建立',
    `库存 ${unusedPlots}/${totalPlots || 0}`,
    `章节覆盖 ${breakdownPct}%`
  ]
  const overviewCards = [
    {
      label: '章节拆解覆盖',
      value: `${breakdownPct}%`,
      detail: `已拆 ${processedCh} / ${totalCh || 0} 章`,
      tone: 'accent'
    },
    {
      label: '可用剧情库存',
      value: `${unusedPlots}`,
      detail: plotStatus,
      tone: unusedPlots < 5 ? 'warn' : 'ok'
    },
    {
      label: '已转剧本集数',
      value: `${completedEps}`,
      detail: '已生成剧本',
      tone: 'accent'
    },
    {
      label: '待补拆解章节',
      value: `${unprocessedCh}`,
      detail: unprocessedCh > 0 ? '还有源稿待处理' : '当前已拆完',
      tone: unprocessedCh > 0 ? 'warn' : 'ok'
    }
  ] as const
  const advancedToolsSummary = [
    reviewEpisode !== '' ? `复查剧本第 ${reviewEpisode} 集` : '可指定集数复查剧本',
    rebuildChapterStart !== '' || rebuildChapterEnd !== '' ? '章节重拆参数已填写' : '支持按章节范围重拆',
    rebuildEpisodeStart !== '' || rebuildEpisodeEnd !== '' ? '集区间重拆参数已填写' : '支持按集区间重拆'
  ]

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
      {!embedded && (
        <div className="bd-page-header">
          <div className="bd-header-left">
            <div>
              <h1 className="page-title">改编规划</h1>
              <p className="text-secondary bd-page-desc">
                在这里统一决定“还要不要继续拆解”“库存够不够写剧本”“卷规划是否已经稳定”。
              </p>
            </div>
            <span className={`badge ${stateToneClass}`}>
              {stateLabel[adaptState] || adaptState}
            </span>
          </div>
          <div className="bd-header-right">
            {currentProject && (
              <>
                <button className="btn btn-sm" onClick={() => navigate(`/project/${currentProject.id}/script`)}>
                  ✍️ 分集剧本
                </button>
                <button className="btn btn-sm" onClick={() => navigate(`/project/${currentProject.id}/script?tab=issues`)}>
                  🛠️ 质检修订
                </button>
              </>
            )}
            {isRunning && (
              <>
                <button className="btn btn-sm" onClick={handlePause}>⏸ 暂停</button>
                <button className="btn btn-sm btn-danger" onClick={() => { void handleAbort() }}>⏹ 停止</button>
              </>
            )}
          </div>
        </div>
      )}

      <section className="card bd-hero">
        <div className="bd-hero-main">
          <div className="bd-section-label">内容准备 / 改编规则</div>
          <div className="bd-hero-copy">
            <h2>{currentFocus.title}</h2>
            <p className="text-secondary">{currentFocus.description}</p>
          </div>
          <div className="bd-hero-meta">
            {focusMeta.map((item) => (
              <span key={item} className="bd-hero-chip">{item}</span>
            ))}
          </div>
          <div className="bd-hero-actions">
            <button className="btn btn-primary" onClick={currentFocus.onClick}>
              {currentFocus.action}
            </button>
            <button className="btn" disabled={isRunning} onClick={handleSmartNext}>
              推荐推进
            </button>
            {currentProject && (
              <button className="btn" onClick={() => navigate(`/project/${currentProject.id}/workspace`)}>
                返回总控台
              </button>
            )}
          </div>
        </div>
        <div className="bd-hero-side">
          <div className="bd-hero-side-head">
            <h3>当前缺口</h3>
            <span className="text-secondary text-xs">{planningRisks.length > 0 ? `${planningRisks.length} 项待关注` : '当前无显式阻塞'}</span>
          </div>
          <div className="bd-risk-list">
            {planningRisks.length === 0 ? (
              <div className="bd-risk-item is-ok">当前规划侧没有显式阻塞，可以根据库存和剧本覆盖决定是否继续创作。</div>
            ) : (
              planningRisks.map((risk) => (
                <div key={risk} className="bd-risk-item">{risk}</div>
              ))
            )}
          </div>
        </div>
      </section>

      <div className="bd-grid">
        <div className="bd-left">
          <section className="card bd-overview-card">
            <div className="bd-panel-head">
              <div>
                <div className="bd-panel-title">阶段概览</div>
                <p className="text-secondary">先判断覆盖率、库存和剧本转化是否处在可继续推进的状态。</p>
              </div>
              <span className="badge badge-info">总库存 {totalPlots}</span>
            </div>
            <div className="bd-overview-grid">
              {overviewCards.map((card) => (
                <div key={card.label} className={`bd-overview-item tone-${card.tone}`}>
                  <span className="bd-overview-label">{card.label}</span>
                  <strong>{card.value}</strong>
                  <span className="bd-overview-detail">{card.detail}</span>
                </div>
              ))}
            </div>
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
            <div className="bd-suggestion">{getSmartSuggestion()}</div>
          </section>

          <section className="card bd-actions-card">
            <div className="bd-panel-head">
              <div>
                <div className="bd-panel-title">执行控制台</div>
                <p className="text-secondary">把操作按“判断下一步 / 补库存 / 转剧本 / 精细修复”重新分层，避免按钮堆叠。</p>
              </div>
              {isRunning && (
                <div className="bd-inline-actions">
                  <button className="btn btn-sm" onClick={handlePause}>暂停</button>
                  <button className="btn btn-sm btn-danger" onClick={() => { void handleAbort() }}>停止</button>
                </div>
              )}
            </div>
            <div className="bd-action-stack">
              <div className="bd-action-group bd-action-group-highlight">
                <div className="bd-action-group-head">
                  <div>
                    <div className="bd-action-group-title">决策推进</div>
                    <p className="text-secondary">先让系统告诉你当前最合理的下一步，再决定是否全自动连续推进。</p>
                  </div>
                </div>
                <div className="bd-action-grid bd-action-grid-2">
                  <button className="btn btn-primary bd-action-button" disabled={isRunning} onClick={handleSmartNext}>
                    推荐推进
                  </button>
                  <button className="btn btn-primary bd-action-button" disabled={isRunning} onClick={handleAuto}>
                    自动推进到底
                  </button>
                </div>
              </div>

              <div className="bd-action-dual">
                <div className="bd-action-group">
                  <div className="bd-action-group-head">
                    <div>
                      <div className="bd-action-group-title">补充剧情库存</div>
                      <p className="text-secondary">适合库存不足、后面还有章节未拆时使用。</p>
                    </div>
                  </div>
                  <div className="bd-action-grid bd-action-grid-2">
                    <button className="btn bd-action-button" disabled={isRunning} onClick={() => handleBreakdown(1)}>
                      补 1 批库存
                    </button>
                    <button className="btn bd-action-button" disabled={isRunning} onClick={handleBreakdownAuto}>
                      一直拆到完
                    </button>
                  </div>
                </div>
                <div className="bd-action-group">
                  <div className="bd-action-group-head">
                    <div>
                      <div className="bd-action-group-title">转成分集剧本</div>
                      <p className="text-secondary">库存和规划稳定后，把剧情点继续推进成剧本产出。</p>
                    </div>
                  </div>
                  <div className="bd-action-grid bd-action-grid-2">
                    <button className="btn bd-action-button" disabled={isRunning} onClick={() => handleScript(1)}>
                      生成 1 集
                    </button>
                    <button className="btn bd-action-button" disabled={isRunning} onClick={handleScriptAuto}>
                      一直写到完
                    </button>
                  </div>
                </div>
              </div>

              <details className="bd-action-advanced">
                <summary>
                  <span>高级检查工具</span>
                  <span className="bd-summary-hint">{advancedToolsSummary[0]}</span>
                </summary>
                <div className="bd-advanced-list">
                  <div className="bd-advanced-row">
                    <button className="btn btn-sm" disabled={isRunning} onClick={handleCheckBreakdown}>
                      复查拆解
                    </button>
                    <div className="bd-field-inline">
                      <input
                        type="number"
                        className="bd-input"
                        min={1}
                        value={reviewEpisode}
                        onChange={e => {
                          const val = e.target.value
                          setReviewEpisode(val === '' ? '' : Math.max(1, parseInt(val, 10) || 1))
                        }}
                        placeholder="集数"
                      />
                      <button className="btn btn-sm" disabled={isRunning} onClick={handleCheckScript}>
                        复查剧本
                      </button>
                    </div>
                    {lastLogFail && !isRunning && (
                      <button className="btn btn-sm btn-danger" onClick={handleFix}>
                        修正失败批次
                      </button>
                    )}
                  </div>
                  <div className="bd-advanced-row">
                    <div className="bd-field-inline">
                      <input
                        type="number"
                        className="bd-input"
                        min={1}
                        max={totalCh || 9999}
                        value={rebuildChapterStart}
                        onChange={e => {
                          const val = e.target.value
                          setRebuildChapterStart(val === '' ? '' : Math.max(1, parseInt(val, 10) || 1))
                        }}
                        placeholder="起章"
                      />
                      <span className="text-secondary text-xs">-</span>
                      <input
                        type="number"
                        className="bd-input"
                        min={1}
                        max={totalCh || 9999}
                        value={rebuildChapterEnd}
                        onChange={e => {
                          const val = e.target.value
                          setRebuildChapterEnd(val === '' ? '' : Math.max(1, parseInt(val, 10) || 1))
                        }}
                        placeholder="止章"
                      />
                      <button className="btn btn-sm" disabled={isRunning} onClick={handleRebuildByChapterRange}>
                        按章节重拆
                      </button>
                    </div>
                  </div>
                  <div className="bd-advanced-row">
                    <div className="bd-field-inline">
                      <input
                        type="number"
                        className="bd-input"
                        min={1}
                        value={rebuildEpisodeStart}
                        onChange={e => {
                          const val = e.target.value
                          setRebuildEpisodeStart(val === '' ? '' : Math.max(1, parseInt(val, 10) || 1))
                        }}
                        placeholder="起集"
                      />
                      <span className="text-secondary text-xs">-</span>
                      <input
                        type="number"
                        className="bd-input"
                        min={1}
                        value={rebuildEpisodeEnd}
                        onChange={e => {
                          const val = e.target.value
                          setRebuildEpisodeEnd(val === '' ? '' : Math.max(1, parseInt(val, 10) || 1))
                        }}
                        placeholder="止集"
                      />
                      <button className="btn btn-sm" disabled={isRunning || !breakdownData} onClick={handleRebuildByEpisodeRange}>
                        按集区间重拆
                      </button>
                    </div>
                  </div>
                </div>
              </details>
            </div>
          </section>

          {awaitingUser && reviewFailedData && (
            <div className="bd-intervention-card">
              <div className="bd-intervention-header">
                <span className="bd-intervention-icon">⚠️</span>
                <span className="bd-intervention-title">
                  {reviewFailedData.stage === 'breakdown' ? '拆解' : '剧本'}质检未通过，需要人工指导
                </span>
              </div>
              <div className="bd-intervention-body">
                <p className="bd-intervention-desc">
                  已重试 {reviewFailedData.retryCount} 次仍未通过质检。请结合右侧实时输出里的报告，补充修正方向后再重试。
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
                      const success = await submitGuidance(guidanceText.trim())
                      if (!success) return
                      setGuidanceText('')
                    }}
                  >
                    提交指导并重试
                  </button>
                  <button className="btn" onClick={() => { void handleAbort({ clearIntervention: true }) }}>中止</button>
                </div>
              </div>
            </div>
          )}

          <div className="bd-support-grid">
            <div className="bd-notes-card">
              <div className="bd-notes-header" onClick={() => setNotesOpen(!notesOpen)}>
                <span>用户指导笔记</span>
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
                        const success = await saveNotes(currentProject.projectPath, notesDraft)
                        setNotesSaving(false)
                        if (!success) return
                        addToast('success', '用户笔记已保存')
                      }}
                    >
                      {notesSaving ? '保存中...' : '保存笔记'}
                    </button>
                    {notesDraft !== userNotes && (
                      <span className="bd-notes-dirty">有未保存的修改</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {lastStageReport && (
              <div className="bd-report-card">
                <div className="bd-report-header">
                  <span className="bd-report-title">
                    {lastStageReport.stage === 'breakdown' ? '拆解完成' : '创作完成'}
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
                    <div className="bd-report-summary">
                      <SimpleMarkdown content={lastStageReport.summary} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {lastReviewResult && (
            <div className="bd-review-card">
              {(() => {
                const r = lastReviewResult as ReviewResult
                return (
                  <>
                    <div className="bd-review-header">
                      <span className="bd-review-title">
                        {r.stage === 'breakdown'
                          ? '拆解质检'
                          : r.stage === 'script'
                          ? '剧本质检'
                          : '质检结果'}
                      </span>
                      <span className={`badge ${r.passed ? 'badge-success' : 'badge-danger'}`}>
                        {r.passed ? 'PASS' : 'FAIL'} · 得分 {r.score.toFixed(1)}
                      </span>
                    </div>
                    <div className="bd-review-body">
                      <div className="bd-review-feedback">
                        <SimpleMarkdown content={r.feedback} />
                      </div>
                      {r.issues && r.issues.length > 0 && (
                        <div className="bd-review-issues">
                          <div className="bd-review-issues-title">问题列表（{r.issues.length}）</div>
                          <ul>
                            {r.issues.map((iss, idx) => (
                              <li key={idx} className={`issue-${iss.severity}`}>
                                <span className="issue-severity">[{iss.severity.toUpperCase()}]</span>
                                <span className="issue-desc">{iss.description}</span>
                                {iss.location && (
                                  <span className="issue-location"> @ {iss.location}</span>
                                )}
                                {iss.suggestion && (
                                  <span className="issue-suggestion"> · 建议：{iss.suggestion}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </>
                )
              })()}
            </div>
          )}

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

        <div className="bd-right">
          <div className="bd-output-panel">
            <div className="bd-output-header">
              <span className="bd-output-title">
                实时输出
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

          <div className={`bd-log-panel ${logsCollapsed ? 'collapsed' : ''}`}>
            <div className="bd-log-header" onClick={() => setLogsCollapsed(!logsCollapsed)}>
              <span className="bd-log-title">
                执行日志
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
            📋 剧情库存
            {breakdownData && (
              <span className="bd-drawer-tab-count">{breakdownData.allPlots.length}</span>
            )}
          </button>
          <button
            className={`bd-drawer-tab ${drawerOpen && drawerTab === 'plan' ? 'active' : ''}`}
            onClick={() => openDrawer('plan')}
          >
            📐 卷级规划
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
                    title="暂无剧情库存"
                    description="请先在上方推进区执行一轮拆解，系统才会沉淀剧情库存。"
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
                          <option value="all">全部库存</option>
                          <option value="unused">仅看可用</option>
                          <option value="used">仅看已消耗</option>
                        </select>
                        <button className="btn btn-sm" onClick={expandAll}>全部展开</button>
                        <button className="btn btn-sm" onClick={collapseAll}>全部折叠</button>
                        <button
                          className="btn btn-sm"
                          onClick={async () => {
                            const refreshed = await loadBreakdownData({ preserveOnError: true })
                            if (!refreshed) {
                              addToast('warning', '剧情数据刷新失败，已保留当前内容')
                            }
                          }}
                        >
                          🔄 刷新
                        </button>
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
                                <button
                                  className="btn btn-sm"
                                  disabled={isRunning}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void handleRebuildBatch(batch)
                                  }}
                                >
                                  重拆本批
                                </button>
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
  savePlan: (path: string, plan: AdaptPlan) => Promise<boolean>
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
  const currentVolStatus = currentVol?.llmPlan ? '正文已生成' : '待生成正文'
  const volumeStats = currentVol
    ? [
        { label: '章节范围', value: `${currentVol.chapterRange[0]} - ${currentVol.chapterRange[1]}` },
        { label: '目标集数', value: `${currentVol.targetEpisodes}` },
        { label: '单集字数', value: `${currentVol.episodeWordCount[0]} - ${currentVol.episodeWordCount[1]}` },
        { label: '正文状态', value: currentVolStatus }
      ]
    : []

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
    const planToSave: AdaptPlan = {
      ...editingPlan,
      activeVolumeIndex: activeVolIndex,
      updatedAt: new Date().toISOString(),
      volumes: editingPlan.volumes.map(v => ({ ...v }))
    }
    const success = await savePlan(currentProject.projectPath, planToSave)
    if (!success) return
    setEditingPlan(planToSave)
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
      {!plan ? (
        <EmptyState
          icon="📋"
          title="还没有卷级规划"
          description="先明确每一卷覆盖哪些章节、计划拆成多少集，再让 LLM 补正文规划。"
          action={{ label: '新建规划', onClick: initEditingPlan }}
        />
      ) : (
        <>
          <section className="plan-hero">
            <div className="plan-hero-copy">
              <div className="bd-section-label">卷级规划</div>
              <h2>先确定卷结构，再写规划正文</h2>
              <p className="text-secondary">
                主要操作集中在上方，卷导航固定在左侧，正文编辑独立成主工作区，减少当前页面的信息干扰。
              </p>
            </div>
            <div className="plan-hero-meta">
              <div className="plan-overview-item">
                <span className="plan-overview-label">当前卷</span>
                <strong>{currentVol?.volumeLabel || '—'}</strong>
              </div>
              <div className="plan-overview-item">
                <span className="plan-overview-label">卷数量</span>
                <strong>{plan.volumes.length}</strong>
              </div>
              <div className="plan-overview-item">
                <span className="plan-overview-label">当前状态</span>
                <strong>{currentVolStatus}</strong>
              </div>
            </div>
            <div className="plan-hero-actions">
              {!adaptPlan && (
                <button className="btn" disabled={isRunning} onClick={() => { initEditingPlan() }}>
                  新建规划
                </button>
              )}
              <button className="btn" disabled={isRunning} onClick={handleEnsurePlan}>
                快速自动规划
              </button>
              <button className="btn btn-primary" onClick={handleGenerate} disabled={planGenerating || isRunning || !currentVol}>
                {planGenerating ? '生成中...' : '生成本卷正文'}
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={!editingPlan}>
                保存卷规划
              </button>
            </div>
          </section>

          <div className="plan-workspace">
            <aside className="plan-sidebar">
              <section className="plan-card">
                <div className="plan-card-head">
                  <div>
                    <div className="plan-card-title">卷导航</div>
                    <p className="text-secondary">先选中当前要编辑的卷，再处理它的范围和正文。</p>
                  </div>
                  <button className="btn btn-sm" onClick={addVolume}>新增卷</button>
                </div>
                <div className="plan-volume-list">
                  {plan.volumes.map((vol, i) => (
                    <button
                      key={i}
                      className={`plan-volume-item ${i === activeVolIndex ? 'active' : ''}`}
                      onClick={() => setActiveVolIndex(i)}
                    >
                      <span className="plan-volume-index">卷 {i + 1}</span>
                      <strong>{vol.volumeLabel}</strong>
                      <span className="plan-volume-meta">第 {vol.chapterRange[0]} - {vol.chapterRange[1]} 章 · {vol.targetEpisodes} 集</span>
                      <span className="plan-volume-state">{vol.llmPlan ? '正文已生成' : '待生成正文'}</span>
                      {plan.volumes.length > 1 && editingPlan && (
                        <span className="plan-vol-remove" onClick={(e) => { e.stopPropagation(); removeVolume(i) }}>×</span>
                      )}
                    </button>
                  ))}
                </div>
              </section>

              {currentVol && (
                <section className="plan-card">
                  <div className="plan-card-head">
                    <div>
                      <div className="plan-card-title">当前卷摘要</div>
                      <p className="text-secondary">只保留当前做决策最需要的几个数字。</p>
                    </div>
                  </div>
                  <div className="plan-stats-grid">
                    {volumeStats.map((item) => (
                      <div key={item.label} className="plan-stat-item">
                        <span className="plan-overview-label">{item.label}</span>
                        <strong>{item.value}</strong>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </aside>

            {currentVol && (
              <div className="plan-main">
                <section className="plan-card plan-constraints-card">
                  <div className="plan-card-head">
                    <div>
                      <div className="plan-card-title">本卷约束设置</div>
                      <p className="text-secondary">约束参数集中在这里，避免和正文编辑混在一起。</p>
                    </div>
                  </div>
                  <div className="plan-constraint-grid">
                    <div className="plan-form-row">
                      <label className="plan-form-label">卷名称</label>
                      <input type="text" className="plan-input"
                        value={currentVol.volumeLabel}
                        onChange={e => updateVolField('volumeLabel', e.target.value)}
                      />
                    </div>

                    <div className="plan-form-row">
                      <label className="plan-form-label">目标集数</label>
                      <input type="number" className="plan-input plan-input-sm"
                        value={currentVol.targetEpisodes} min={1}
                        onChange={e => updateVolField('targetEpisodes', parseInt(e.target.value) || 1)}
                      />
                    </div>

                    <RangeInput label="章节范围" field="chapterRange" min={1} max={totalChapters || 9999} />
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
                        placeholder="例如：第20集是关键付费节点，需要强悬念收尾；本卷重点强化成长和反转。"
                      />
                    </div>
                  </div>
                </section>

                <section className="plan-card plan-editor-card">
                  <div className="plan-card-head">
                    <div>
                      <div className="plan-card-title">规划正文</div>
                      <p className="text-secondary">主工作区只处理正文内容，方便集中编辑和阅读预览。</p>
                    </div>
                  </div>
                  <textarea
                    className="plan-editor"
                    value={currentVol.llmPlan}
                    onChange={e => updateVolField('llmPlan', e.target.value)}
                    placeholder="先点击“生成本卷正文”，或者直接手写这一卷的核心节奏、集数安排与人物推进。"
                  />
                  {currentVol.llmPlan && (
                    <div className="plan-preview-rendered">
                      <h4>阅读预览</h4>
                      <SimpleMarkdown content={currentVol.llmPlan} />
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
