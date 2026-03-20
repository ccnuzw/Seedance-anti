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

type TabKey = 'dashboard' | 'plots' | 'plan'

export default function BreakdownPage() {
  const { currentProject } = useProjectStore()
  const {
    adaptState, waterLevel, isRunning, logs, streamOutput, error,
    lastStageReport, adaptPlan,
    fetchStatus, initAdapt, startBreakdown, startScript, startAuto,
    pause, abort, clearStream, fix, checkBreakdown, smartNext,
    breakdownAuto, scriptAuto, ensurePlan, loadPlan, savePlan, generatePlan,
    setupEventListeners
  } = useAdaptStore()
  const { getDefaultConfig } = useSettingsStore()
  const { addToast } = useToastStore()
  const streamRef = useRef<HTMLDivElement>(null)
  const [smartResult, setSmartResult] = useState<string | null>(null)

  // 新增：Tab + 剧情点数据
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard')
  const [breakdownData, setBreakdownData] = useState<BreakdownData | null>(null)
  const [planContent, setPlanContent] = useState<string>('')
  const [planLoaded, setPlanLoaded] = useState(false) // [BUG-9] 独立标志
  const [expandedBatches, setExpandedBatches] = useState<Set<number>>(new Set())
  const [plotFilter, setPlotFilter] = useState<'all' | 'unused' | 'used'>('all')
  const [dataLoading, setDataLoading] = useState(false)
  const isFirstRender = useRef(true) // [BUG-11] 首次渲染标志

  // 改编规划相关状态
  const [editingPlan, setEditingPlan] = useState<AdaptPlan | null>(null)
  const [activeVolIndex, setActiveVolIndex] = useState(0)
  const [planGenerating, setPlanGenerating] = useState(false)

  useEffect(() => {
    if (currentProject) {
      fetchStatus(currentProject.projectPath)
      loadPlan(currentProject.projectPath)
    }
  }, [currentProject])

  // 设置 IPC 事件监听（引用计数，页面卸载时清理）
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

  // 切换到剧情列表或规划 Tab 时加载数据
  useEffect(() => {
    if (activeTab === 'plots' && currentProject && !breakdownData) {
      loadBreakdownData()
    }
    // [BUG-9] 用独立标志判断是否已加载
    if (activeTab === 'plan' && currentProject && !planLoaded) {
      loadPlanContent()
    }
  }, [activeTab, currentProject])

  // [BUG-11] 阶段完成后刷新剧情数据（跳过首次挂载）
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
      // 默认展开最后 3 个批次
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
      // [BUG-7 修复] 使用后端 IPC 通道读取文件，避免前端拼接路径
      const raw = await window.feicaiAPI.invoke(
        IPC.FILE_READ, `${currentProject.projectPath}/plot-breakdown.md`
      ) as string | null
      if (!raw) throw new Error('文件不存在')
      // [BUG-8 修复] 宽松匹配改编规划/计划标题
      const planMatch = raw.match(/## (?:改编规划|改编计划|Adaptation Plan)\s*\n([\s\S]*?)(?=\n## |\n---\s*$)/im)
      setPlanContent(planMatch ? planMatch[1].trim() : '暂无改编规划。可点击「生成改编规划」按钮创建。')
    } catch {
      setPlanContent('暂无 plot-breakdown.md 文件。')
    }
    setPlanLoaded(true) // [BUG-9] 标记为已加载
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
    // [BUG-9/10 修复] 重置标志并 await 刷新
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
    adapt_error: '❌ 出错'
  }

  // 水位状态灯
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

  // 最后一次审核是否 FAIL
  const lastLogFail = logs.some(l => l.message.includes('❌') && l.message.includes('质检'))

  // 剧情点过滤
  const getFilteredPlots = (plots: PlotPoint[]) => {
    if (plotFilter === 'unused') return plots.filter(p => p.status === 'unused')
    if (plotFilter === 'used') return plots.filter(p => p.status === 'used')
    return plots
  }

  return (
    <div className="breakdown-page">
      <div className="page-header">
        <h1 className="page-title">📊 剧情拆解</h1>
        <span className="badge badge-info">{stateLabel[adaptState] || adaptState}</span>
      </div>

      {/* Tab 栏 */}
      <div className="breakdown-tabs">
        <button
          className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          📊 控制面板
        </button>
        <button
          className={`tab-btn ${activeTab === 'plots' ? 'active' : ''}`}
          onClick={() => setActiveTab('plots')}
        >
          📋 剧情列表
          {breakdownData && (
            <span className="tab-count">{breakdownData.allPlots.length}</span>
          )}
        </button>
        <button
          className={`tab-btn ${activeTab === 'plan' ? 'active' : ''}`}
          onClick={() => setActiveTab('plan')}
        >
          📐 改编规划
        </button>
      </div>

      {/* ==================== 控制面板 Tab ==================== */}
      {activeTab === 'dashboard' && (
        <>
          {/* 增强版水位仪表盘 */}
          <div className="dashboard-section">
            <div className="progress-card">
              <div className="progress-card-header">
                <span className="progress-card-title">拆解进度</span>
                <span className="progress-card-pct">{breakdownPct}%</span>
              </div>
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${breakdownPct}%` }} />
              </div>
              <div className="progress-card-detail">
                已拆：{processedCh}章 / 总章：{totalCh}章 · 剩余 {unprocessedCh} 章
              </div>
            </div>

            <div className="water-level-grid">
              <div className="water-level-card">
                <div className="wl-value wl-primary">{totalPlots}</div>
                <div className="wl-label">总剧情点</div>
              </div>
              <div className="water-level-card">
                <div className={`wl-value ${unusedPlots < 5 ? 'wl-warning' : 'wl-success'}`}>
                  {unusedPlots}
                </div>
                <div className="wl-label">未用剧情 {plotStatus}</div>
              </div>
              <div className="water-level-card">
                <div className="wl-value wl-primary">{completedEps}</div>
                <div className="wl-label">已创作集数</div>
              </div>
              <div className="water-level-card">
                <div className={`wl-value ${unprocessedCh > 0 ? 'wl-warning' : 'wl-success'}`}>
                  {unprocessedCh}
                </div>
                <div className="wl-label">待拆解章节</div>
              </div>
            </div>

            <div className="smart-suggestion">
              {getSmartSuggestion()}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="breakdown-actions">
            <button className="btn btn-primary" disabled={isRunning} onClick={handleSmartNext}>
              ⏭ 智能下一步
            </button>
            <button className="btn" disabled={isRunning} onClick={() => handleBreakdown(1)}>
              📊 拆解一批 (6章)
            </button>
            <button className="btn" disabled={isRunning} onClick={() => handleBreakdown(3)}>
              📊 × 3 批量拆解
            </button>
            <button className="btn" disabled={isRunning} onClick={() => handleScript(1)}>
              ✍️ 创作一批
            </button>
            <button className="btn" disabled={isRunning} onClick={() => handleScript(3)}>
              ✍️ × 3 批量创作
            </button>
            <button className="btn btn-primary" disabled={isRunning} onClick={handleAuto}>
              🚀 全自动
            </button>
            <button className="btn" disabled={isRunning} onClick={handleBreakdownAuto}>
              📊 拆解到底
            </button>
            <button className="btn" disabled={isRunning} onClick={handleScriptAuto}>
              ✍️ 创作到底
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

            {isRunning && (
              <>
                <button className="btn" onClick={pause}>⏸ 暂停</button>
                <button className="btn" onClick={abort}>⏹ 停止</button>
              </>
            )}
          </div>

          {/* 阶段完成报告卡片 */}
          {lastStageReport && (
            <div className="stage-report-card">
              <div className="stage-report-header">
                <span className="stage-report-title">
                  {lastStageReport.stage === 'breakdown' ? '📊 拆解完成' : '✍️ 创作完成'}
                </span>
                {lastStageReport.batchNum && (
                  <span className="badge badge-info">第 {lastStageReport.batchNum} 批</span>
                )}
              </div>
              <div className="stage-report-body">
                {lastStageReport.chapterRange && (
                  <div className="report-item">
                    <span className="report-label">章节范围</span>
                    <span className="report-value">
                      第{lastStageReport.chapterRange[0]}章 ~ 第{lastStageReport.chapterRange[1]}章
                    </span>
                  </div>
                )}
                {lastStageReport.extractedPlots != null && (
                  <div className="report-item">
                    <span className="report-label">提取剧情</span>
                    <span className="report-value wl-success">{lastStageReport.extractedPlots} 个</span>
                  </div>
                )}
                {lastStageReport.episodeRange && (
                  <div className="report-item">
                    <span className="report-label">创作集数</span>
                    <span className="report-value">{lastStageReport.episodeRange}</span>
                  </div>
                )}
                {lastStageReport.episodeCount != null && (
                  <div className="report-item">
                    <span className="report-label">创作集数</span>
                    <span className="report-value wl-success">{lastStageReport.episodeCount} 集</span>
                  </div>
                )}
                {lastStageReport.summary && (
                  <div className="report-summary">{lastStageReport.summary}</div>
                )}
              </div>
            </div>
          )}

          {/* 智能下一步结果 */}
          {smartResult && (
            <div className="card card-accent mb-lg p-md">
              <p>{smartResult}</p>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="card card-error mb-lg">
              <p className="text-error">❌ {error}</p>
            </div>
          )}

          {/* LLM 流式输出 */}
          {(streamOutput || isRunning) && (
            <>
              <h3 className="mb-sm">📝 LLM 输出</h3>
              <div className="stream-output" ref={streamRef}>
                {streamOutput}
              </div>
            </>
          )}

          {/* 日志面板 */}
          {logs.length > 0 && (
            <>
              <h3 className="mb-sm">📋 执行日志</h3>
              <div className="log-panel">
                {logs.map((entry) => (
                  <div key={entry.id} className={`log-entry log-${entry.level}`}>
                    <span className="log-time">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                    <span>{entry.message}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ==================== 剧情列表 Tab ==================== */}
      {activeTab === 'plots' && (
        <div className="plots-section">
          {dataLoading ? (
            <div className="plots-loading">加载剧情数据...</div>
          ) : !breakdownData ? (
            <EmptyState
              icon="📋"
              title="暂无剧情拆解数据"
              description="请先在控制面板中执行拆解操作"
              action={{
                label: '前往控制面板',
                onClick: () => { setActiveTab('dashboard'); loadBreakdownData() }
              }}
            />
          ) : (
            <>
              {/* 统计摘要 */}
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

              {/* 批次列表 */}
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
                          <span className="batch-title">
                            第 {batch.batchNumber} 批
                          </span>
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

      {/* ==================== 改编规划 Tab ==================== */}
      {activeTab === 'plan' && (
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
  // 初始化编辑状态
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

  // 获取当前编辑中的卷
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
    initEditingPlan()
    setPlanGenerating(true)
    try {
      const result = await generatePlan(currentProject.projectPath, currentVol, llmConfig)
      updateVolField('llmPlan', result)
      addToast('success', 'LLM 规划已生成')
    } catch (e) {
      addToast('error', `规划生成失败: ${e instanceof Error ? e.message : String(e)}`)
    }
    setPlanGenerating(false)
  }

  // 范围输入器辅助函数
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
