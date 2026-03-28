import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useAdaptStore } from '@renderer/stores/adaptStore'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import { useToastStore } from '@renderer/stores/toastStore'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { platformAPI } from '@renderer/platform/api'
import { IPC } from '@shared/ipc-channels'
import {
  DEFAULT_PIPELINE_SETTINGS,
  DEFAULT_PROJECT_TASK_DEFAULTS,
  DEFAULT_REVIEW_POLICY,
  type ReviewResult
} from '@shared/types'

interface ScriptFile {
  episode: number
  filename: string
  title: string
  preview: string
  fullContent: string
  sceneCount: number
  dialogCount: number
  charCount: number
}

interface ScriptEpisodeDoc {
  episode: number
  filename: string
  content: string
}

interface DirectorStageState {
  key: 'idle' | 'analyzing' | 'reviewing' | 'done' | 'failed'
  label: string
  tone: 'default' | 'info' | 'warning' | 'success' | 'danger'
  description: string
}

interface BreakdownData {
  allPlots: Array<{
    episode: number
  }>
}

interface LoadScriptsOptions {
  preserveOnError?: boolean
}

interface LoadScriptContentOptions {
  preserveOnError?: boolean
}

export interface EpisodeQueueItem {
  episode: number
  hasScript: boolean
  hasAssignedPlots: boolean
  title: string
  preview: string
  sceneCount: number
  dialogCount: number
  charCount: number
}

function extractScriptMeta(content: string): { sceneCount: number; dialogCount: number; charCount: number } {
  const sceneCount = (content.match(/^※/gm) || []).length
  const dialogCount = (content.match(/^.+?[（(].+?[)）][：:]/gm) || []).length
  const charCount = content.replace(/\s/g, '').length
  return { sceneCount, dialogCount, charCount }
}

function extractScriptTitle(content: string, episode: number): string {
  const titleMatch = content.match(/# 第\d+集[：:](.+)/)
  return titleMatch?.[1]?.trim() || `第${episode}集`
}

function buildEmptyScriptPlaceholder(episode: number): string {
  return `# 第${episode}集：未命名\n\n> 当前集还没有剧本文件。你可以先通过“剧本生成环节”生成，也可以直接在这里开始撰写。\n`
}

function resolveDirectorStageState(input: {
  episodeStatus?: string
  hasDirectorAnalysis?: boolean
  pipelineState?: string
  pipelineEpisode?: number
  isPipelineRunning?: boolean
  pipelineError?: string | null
  reviewFeedback?: string | null
}): DirectorStageState {
  const {
    episodeStatus,
    hasDirectorAnalysis,
    pipelineState,
    pipelineEpisode,
    isPipelineRunning,
    pipelineError,
    reviewFeedback
  } = input

  const isCurrentDirectorRun = pipelineEpisode !== undefined && (
    pipelineState === 'director_analyzing'
    || pipelineState === 'director_reviewing'
    || pipelineState === 'director_done'
    || pipelineState === 'error'
  )

  if (isCurrentDirectorRun && isPipelineRunning && pipelineState === 'director_analyzing') {
    return {
      key: 'analyzing',
      label: '分析中',
      tone: 'info',
      description: '已触发导演分析，正在生成导演阶段结果。'
    }
  }

  if (isCurrentDirectorRun && isPipelineRunning && pipelineState === 'director_reviewing') {
    return {
      key: 'reviewing',
      label: '审核中',
      tone: 'warning',
      description: '导演分析已生成，正在执行审核校验。'
    }
  }

  if (isCurrentDirectorRun && pipelineState === 'error') {
    return {
      key: 'failed',
      label: '失败',
      tone: 'danger',
      description: pipelineError || reviewFeedback || '导演阶段执行失败，请查看日志或重试。'
    }
  }

  if (hasDirectorAnalysis || episodeStatus === 'director' || episodeStatus === 'art' || episodeStatus === 'storyboard' || episodeStatus === 'complete') {
    return {
      key: 'done',
      label: '已完成',
      tone: 'success',
      description: '导演分析结果已可查看，可继续推进后续制作阶段。'
    }
  }

  return {
    key: 'idle',
    label: '未开始',
    tone: 'default',
    description: '当前集尚未启动导演分析。'
  }
}

export function useScriptWorkspace() {
  useProjectSync()

  const [searchParams, setSearchParams] = useSearchParams()
  const { currentProject, episodes, loadEpisodes, syncEpisodeStatus } = useProjectStore()
  const {
    state: pipelineState,
    context: pipelineContext,
    isRunning: pipelineRunning,
    currentReview,
    startPipeline,
    setupEventListeners: setupPipelineEventListeners,
    syncFromBackend
  } = usePipelineStore()
  const {
    waterLevel,
    adaptState,
    isRunning,
    streamOutput,
    logs,
    error,
    fetchStatus,
    initAdapt,
    startScript,
    pause,
    abort,
    clearStream,
    reScript,
    generateEpisode,
    revise,
    setupEventListeners,
    lastStageReport,
    lastReviewResult,
    reviewFailedData,
    fix
  } = useAdaptStore()
  const { getDefaultConfig } = useSettingsStore()
  const { addToast } = useToastStore()

  const [scripts, setScripts] = useState<ScriptFile[]>([])
  const [assignedPlotEpisodes, setAssignedPlotEpisodes] = useState<number[]>([])
  const [currentEp, setCurrentEp] = useState(0)
  const [editorContent, setEditorContent] = useState('')
  const [saved, setSaved] = useState(true)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(true)
  const [reviseTarget, setReviseTarget] = useState<number | null>(null)
  const [reviseNotes, setReviseNotes] = useState('')
  const [batchDrawerOpen, setBatchDrawerOpen] = useState(false)
  const [batchDraftCount, setBatchDraftCount] = useState(3)
  const [directorOutput, setDirectorOutput] = useState('')
  const [directorOutputLoading, setDirectorOutputLoading] = useState(false)

  const streamRef = useRef<HTMLDivElement>(null)
  const scriptsLoadTokenRef = useRef(0)
  const scriptContentLoadTokenRef = useRef(0)
  const preferredEpisodeRef = useRef(0)
  const projectIdentityRef = useRef<string | null>(null)
  const editorContentRef = useRef('')

  const activeReviewResult = (reviewFailedData?.result as ReviewResult | undefined) ?? lastReviewResult
  const pipelineSettings = useMemo(
    () => ({ ...DEFAULT_PIPELINE_SETTINGS, ...(currentProject?.config.pipelineSettings || {}) }),
    [currentProject?.config.pipelineSettings]
  )
  const reviewPolicy = useMemo(
    () => ({ ...DEFAULT_REVIEW_POLICY, ...(currentProject?.config.reviewPolicy || {}) }),
    [currentProject?.config.reviewPolicy]
  )
  const taskDefaults = useMemo(
    () => ({ ...DEFAULT_PROJECT_TASK_DEFAULTS, ...(currentProject?.config.taskDefaults || {}) }),
    [currentProject?.config.taskDefaults]
  )
  const queryEp = Number.parseInt(searchParams.get('ep') || '0', 10)
  const supportsGeneration = currentProject?.sourceType === 'novel'
  const availableEpisodes = useMemo(
    () => episodes.map((episode) => episode.episodeNumber).sort((a, b) => a - b),
    [episodes]
  )
  const scriptMap = useMemo(
    () => new Map(scripts.map((script) => [script.episode, script])),
    [scripts]
  )
  const assignedPlotEpisodeSet = useMemo(
    () => new Set(assignedPlotEpisodes),
    [assignedPlotEpisodes]
  )
  const pendingPlotEpisodeSet = useMemo(
    () => new Set(assignedPlotEpisodes.filter((episode) => !scriptMap.has(episode))),
    [assignedPlotEpisodes, scriptMap]
  )
  const currentScript = useMemo(
    () => scriptMap.get(currentEp) || null,
    [currentEp, scriptMap]
  )
  const episodeQueue = useMemo<EpisodeQueueItem[]>(
    () => availableEpisodes.map((episode) => {
      const script = scriptMap.get(episode)
      if (script) {
        return {
          episode,
          hasScript: true,
          hasAssignedPlots: true,
          title: script.title,
          preview: script.preview,
          sceneCount: script.sceneCount,
          dialogCount: script.dialogCount,
          charCount: script.charCount
        }
      }
      const hasAssignedPlots = assignedPlotEpisodeSet.has(episode)
      return {
        episode,
        hasScript: false,
        hasAssignedPlots,
        title: `第${episode}集`,
        preview: hasAssignedPlots
          ? '该集已拆到剧情，但还没有剧本文件。可以直接补生成这一集。'
          : supportsGeneration
            ? '尚未拆到该集剧情，可直接手动撰写，或先回到改编规划补剧情。'
            : '尚未保存剧本文件，可直接在右侧工作区开始撰写。',
        sceneCount: 0,
        dialogCount: 0,
        charCount: 0
      }
    }),
    [availableEpisodes, assignedPlotEpisodeSet, scriptMap, supportsGeneration]
  )
  const liveMeta = useMemo(() => extractScriptMeta(editorContent), [editorContent])
  const liveTitle = useMemo(() => extractScriptTitle(editorContent, currentEp || 1), [editorContent, currentEp])
  const recentLogs = useMemo(() => logs.slice(-40), [logs])
  const selectedEpisodeRecord = episodes.find((episode) => episode.episodeNumber === currentEp) || null
  const currentPipelineMatchesEpisode = pipelineContext?.projectId === currentProject?.id && pipelineContext?.episodeNum === currentEp
  const directorReviewFeedback = useMemo(() => {
    if (!currentPipelineMatchesEpisode) return null
    const review = currentReview || null
    if (!review || review.stage !== 'director' || review.result !== 'FAIL') return null
    const reasons = [
      review.feedback,
      ...((Array.isArray(review.issues) ? review.issues : []).map((issue) => [issue.description, issue.suggestion].filter(Boolean).join('：')))
    ]
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
    return reasons.length > 0 ? reasons.join('；') : null
  }, [currentPipelineMatchesEpisode, currentReview])
  const directorStageState = useMemo(() => resolveDirectorStageState({
    episodeStatus: selectedEpisodeRecord?.status,
    hasDirectorAnalysis: selectedEpisodeRecord?.hasDirectorAnalysis,
    pipelineState: currentPipelineMatchesEpisode ? pipelineState : undefined,
    pipelineEpisode: currentPipelineMatchesEpisode ? currentEp : undefined,
    isPipelineRunning: currentPipelineMatchesEpisode ? pipelineRunning : false,
    pipelineError: currentPipelineMatchesEpisode && pipelineState === 'error'
      ? '导演阶段执行失败，请查看日志并重试。'
      : null,
    reviewFeedback: directorReviewFeedback
  }), [
    currentEp,
    currentPipelineMatchesEpisode,
    directorReviewFeedback,
    pipelineRunning,
    pipelineState,
    selectedEpisodeRecord?.hasDirectorAnalysis,
    selectedEpisodeRecord?.status
  ])
  const directorStatusHint = useMemo(() => {
    if (directorStageState.key === 'failed' && directorReviewFeedback) {
      return `审核未通过：${directorReviewFeedback}`
    }
    return directorStageState.description
  }, [directorReviewFeedback, directorStageState.description, directorStageState.key])
  const pendingPlotForCurrent = pendingPlotEpisodeSet.has(currentEp)
  const selectedEpisodeHasScript = !!selectedEpisodeRecord?.hasScript
  const maxBatchCount = useMemo(() => {
    const candidates = [
      waterLevel?.pendingScriptEpisodes || 0,
      waterLevel?.unusedPlots || 0,
      availableEpisodes.length
    ].filter((value) => value > 0)
    const ceiling = candidates.length > 0 ? Math.max(...candidates) : 3
    const baseMax = Math.max(1, Math.min(8, ceiling))
    if (reviewPolicy.qaMode === 'strict') return Math.max(1, Math.min(baseMax, 2))
    if (reviewPolicy.qaMode === 'lenient') return Math.max(1, Math.min(baseMax, 4))
    return Math.max(1, Math.min(baseMax, 6))
  }, [availableEpisodes.length, reviewPolicy.qaMode, waterLevel?.pendingScriptEpisodes, waterLevel?.unusedPlots])

  const effectiveScriptPassScore = reviewPolicy.adaptScriptPassScore ?? pipelineSettings.passScore
  const scriptAutoRepairRounds = reviewPolicy.scriptAutoRepairRounds ?? 0
  const defaultBatchModeLabel = taskDefaults.defaultBatchMode === 'independent'
    ? '独立并行'
    : taskDefaults.defaultBatchMode === 'sequential_on_success'
      ? '成功后串行'
      : '始终串行'
  const batchActionLabel = reviewPolicy.qaMode === 'strict'
    ? '小批推进'
    : reviewPolicy.qaMode === 'report_only'
      ? '快速批量'
      : '批量推进'
  const strategyChips = [
    `通过线 ${effectiveScriptPassScore} 分`,
    `自动修订 ${scriptAutoRepairRounds} 轮`,
    `默认批量 ${defaultBatchModeLabel}`,
    `批量上限 ${maxBatchCount} 集`
  ]
  const batchConstraintText = reviewPolicy.qaMode === 'strict'
    ? '严格模式会把批量生成收紧为小批推进，优先确保每轮问题可控。'
    : reviewPolicy.qaMode === 'report_only'
      ? '仅报告模式会放宽批量上限，更适合先铺开成稿后再集中回看问题。'
      : '宽松模式允许适度批量推进，但建议每轮完成后及时回看问题面板。'

  const generationStatusText = !supportsGeneration
    ? '当前项目不启用自动生成，你可以直接在右侧工作区逐集撰写、保存并送入制作。'
    : reviewFailedData
      ? '当前存在待修订问题，建议优先闭环后再继续生成。'
      : (waterLevel?.pendingScriptEpisodes || 0) > 0
        ? `当前有 ${waterLevel?.pendingScriptEpisodes || 0} 集已拆到剧情但还没有剧本文件，可直接补生成指定集。当前剧本通过线为 ${effectiveScriptPassScore} 分。`
        : (waterLevel?.unusedPlots || 0) > 0
          ? `当前仍有 ${waterLevel?.unusedPlots || 0} 个可用剧情点，可继续顺序生成新剧本。默认按${defaultBatchModeLabel}策略推进。`
          : '当前可用剧情点已不足，建议先回到改编规划补充剧情库存。'

  useEffect(() => {
    editorContentRef.current = editorContent
  }, [editorContent])

  const updateEpisodeSearchParam = useCallback((episode: number) => {
    const nextParams = new URLSearchParams(searchParams)
    if (nextParams.get('ep') === String(episode)) return
    nextParams.set('ep', String(episode))
    if (nextParams.toString() === searchParams.toString()) return
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])

  const refreshScripts = useCallback(async (
    projectId?: string,
    projectPath?: string,
    options?: LoadScriptsOptions
  ): Promise<ScriptFile[] | null> => {
    if (!projectId || !projectPath) return null
    const requestToken = ++scriptsLoadTokenRef.current
    try {
      const docs = await platformAPI.invoke(
        IPC.SCRIPT_LIST_EPISODES,
        projectPath
      ) as ScriptEpisodeDoc[]
      if (scriptsLoadTokenRef.current !== requestToken || useProjectStore.getState().currentProject?.id !== projectId) {
        return null
      }
      const nextScripts = docs
        .map(({ episode, filename, content }) => ({
          episode,
          filename,
          title: extractScriptTitle(content, episode),
          preview: content.substring(0, 240),
          fullContent: content,
          ...extractScriptMeta(content)
        }))
        .sort((a, b) => a.episode - b.episode)
      setScripts(nextScripts)
      return nextScripts
    } catch {
      if (scriptsLoadTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === projectId) {
        if (!options?.preserveOnError) {
          setScripts([])
        }
      }
      return null
    }
  }, [])

  const refreshAssignedPlotEpisodes = useCallback(async (projectPath?: string): Promise<void> => {
    if (!projectPath) return
    try {
      const data = await platformAPI.invoke(
        IPC.PLOT_GET_BREAKDOWN,
        projectPath
      ) as BreakdownData | null
      const nextEpisodes = data
        ? [...new Set(data.allPlots.map((plot) => plot.episode))].sort((a, b) => a - b)
        : []
      setAssignedPlotEpisodes(nextEpisodes)
    } catch {
      setAssignedPlotEpisodes([])
    }
  }, [])

  const loadScriptContent = useCallback(async (
    projectId?: string,
    projectPath?: string,
    episode?: number,
    options?: LoadScriptContentOptions
  ): Promise<boolean> => {
    if (!projectId || !projectPath || !episode) return false
    const requestToken = ++scriptContentLoadTokenRef.current
    setLoading(true)
    let loaded = false
    try {
      const text = await platformAPI.invoke(
        IPC.SCRIPT_READ_EPISODE,
        projectPath,
        episode
      ) as string | null
      if (scriptContentLoadTokenRef.current !== requestToken || useProjectStore.getState().currentProject?.id !== projectId) {
        return false
      }
      if (!text) throw new Error('file not found')
      setEditorContent(text)
      loaded = true
    } catch {
      if (scriptContentLoadTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === projectId) {
        if (!options?.preserveOnError) {
          setEditorContent(buildEmptyScriptPlaceholder(episode))
        }
      }
    } finally {
      if (scriptContentLoadTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === projectId) {
        setLoading(false)
        setSaved(true)
      }
    }
    return loaded
  }, [])

  const ensureAdaptReady = useCallback(async () => {
    if (!currentProject) return false
    const llmConfig = getDefaultConfig('llm')
    if (!llmConfig) {
      addToast('error', '请先在设置中配置 LLM')
      return false
    }
    if (adaptState !== 'adapt_idle') return true
    return initAdapt(currentProject.id, currentProject.projectPath, llmConfig)
  }, [adaptState, addToast, currentProject, getDefaultConfig, initAdapt])

  const refreshAfterScriptMutation = useCallback(async () => {
    if (!currentProject) return
    const preferredEpisode = preferredEpisodeRef.current
    const nextScripts = await refreshScripts(currentProject.id, currentProject.projectPath, { preserveOnError: true })
    await refreshAssignedPlotEpisodes(currentProject.projectPath)
    await syncEpisodeStatus()
    if (!nextScripts) {
      addToast('warning', '剧本已更新，但剧本列表刷新失败')
      return
    }
    if (preferredEpisode > 0) {
      setCurrentEp(preferredEpisode)
      await loadScriptContent(currentProject.id, currentProject.projectPath, preferredEpisode, { preserveOnError: true })
      return
    }
    if (currentEp > 0 && nextScripts.some((script) => script.episode === currentEp)) {
      await loadScriptContent(currentProject.id, currentProject.projectPath, currentEp, { preserveOnError: true })
    }
  }, [addToast, currentEp, currentProject, loadScriptContent, refreshAssignedPlotEpisodes, refreshScripts, syncEpisodeStatus])

  useEffect(() => {
    if (currentProject && episodes.length === 0) {
      void loadEpisodes(currentProject.id)
    }
  }, [currentProject?.id, episodes.length, loadEpisodes])

  useEffect(() => {
    const projectIdentity = currentProject ? `${currentProject.id}:${currentProject.projectPath}` : null
    const isProjectChanged = projectIdentityRef.current !== projectIdentity
    projectIdentityRef.current = projectIdentity
    scriptsLoadTokenRef.current += 1
    scriptContentLoadTokenRef.current += 1
    setScripts([])
    preferredEpisodeRef.current = 0
    if (isProjectChanged) {
      setCurrentEp(0)
    }
    setEditorContent('')
    setSaved(true)
    setLoading(false)
    setSaving(false)
    setPreviewOpen(true)
    setReviseTarget(null)
    setReviseNotes('')
    setBatchDrawerOpen(false)
    setBatchDraftCount(3)
    if (currentProject) {
      void fetchStatus(currentProject.projectPath)
      void refreshScripts(currentProject.id, currentProject.projectPath)
      void refreshAssignedPlotEpisodes(currentProject.projectPath)
    }
  }, [currentProject?.id, currentProject?.projectPath, fetchStatus, refreshAssignedPlotEpisodes, refreshScripts])

  useEffect(() => {
    const cleanup = setupEventListeners()
    return cleanup
  }, [setupEventListeners])

  useEffect(() => {
    const cleanup = setupPipelineEventListeners()
    return cleanup
  }, [setupPipelineEventListeners])

  useEffect(() => {
    void syncFromBackend()
  }, [currentProject?.id, syncFromBackend])

  useEffect(() => {
    if (!currentProject) return
    if (!lastStageReport || !['script', 'revision'].includes(lastStageReport.stage)) return
    void refreshAfterScriptMutation()
  }, [currentProject?.id, lastStageReport, refreshAfterScriptMutation])

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight
    }
  }, [logs.length, streamOutput])

  useEffect(() => {
    if (availableEpisodes.length === 0) return
    let resolvedEpisode = availableEpisodes[0]
    setCurrentEp((prev) => {
      const preferredEpisode = preferredEpisodeRef.current
      const fallback = preferredEpisode > 0 && availableEpisodes.includes(preferredEpisode)
        ? preferredEpisode
        : prev > 0 && availableEpisodes.includes(prev)
          ? prev
          : availableEpisodes[0]
      resolvedEpisode = queryEp > 0 && availableEpisodes.includes(queryEp)
        ? queryEp
        : fallback
      return resolvedEpisode === prev ? prev : resolvedEpisode
    })
    preferredEpisodeRef.current = resolvedEpisode
    updateEpisodeSearchParam(resolvedEpisode)
  }, [availableEpisodes, queryEp, updateEpisodeSearchParam])

  useEffect(() => {
    if (!currentProject || currentEp <= 0) {
      setDirectorOutput('')
      setDirectorOutputLoading(false)
      return
    }

    let cancelled = false
    const loadDirectorOutput = async () => {
      setDirectorOutputLoading(true)
      try {
        const raw = await platformAPI.invoke(
          IPC.PROMPT_READ_EPISODE_FILE,
          currentProject.projectPath,
          currentEp,
          'director'
        ) as string | null
        if (!cancelled) {
          setDirectorOutput(raw || '')
        }
      } catch {
        if (!cancelled) {
          setDirectorOutput('')
        }
      } finally {
        if (!cancelled) {
          setDirectorOutputLoading(false)
        }
      }
    }

    void loadDirectorOutput()
    return () => {
      cancelled = true
    }
  }, [currentEp, currentProject?.id, currentProject?.projectPath, selectedEpisodeRecord?.hasDirectorAnalysis, pipelineState])

  const handleCreateScript = useCallback(async (count: number) => {
    if (!supportsGeneration || !currentProject) return false
    const ready = await ensureAdaptReady()
    if (!ready) return false
    clearStream()
    const success = await startScript(count)
    if (!success) return false
    await refreshAfterScriptMutation()
    return true
  }, [clearStream, currentProject, ensureAdaptReady, refreshAfterScriptMutation, startScript, supportsGeneration])

  const handleReCreate = useCallback(async (episode: number) => {
    if (!supportsGeneration || !currentProject) return
    preferredEpisodeRef.current = episode
    setCurrentEp(episode)
    const ready = await ensureAdaptReady()
    if (!ready) return
    clearStream()
    const success = await reScript(episode)
    if (!success) return
    await refreshAfterScriptMutation()
  }, [clearStream, currentProject, ensureAdaptReady, reScript, refreshAfterScriptMutation, supportsGeneration])

  const handleGenerateEpisode = useCallback(async (episode: number) => {
    if (!supportsGeneration || !currentProject) return
    preferredEpisodeRef.current = episode
    setCurrentEp(episode)
    const ready = await ensureAdaptReady()
    if (!ready) return
    clearStream()
    const success = await generateEpisode(episode)
    if (!success) return
    await refreshAfterScriptMutation()
  }, [clearStream, currentProject, ensureAdaptReady, generateEpisode, refreshAfterScriptMutation, supportsGeneration])

  const handleRevise = useCallback(async () => {
    if (!supportsGeneration || !currentProject || !reviseTarget || !reviseNotes.trim()) return
    const ready = await ensureAdaptReady()
    if (!ready) return
    clearStream()
    const success = await revise(reviseTarget, reviseNotes.trim())
    if (!success) return
    setReviseTarget(null)
    setReviseNotes('')
    await refreshAfterScriptMutation()
  }, [clearStream, currentProject, ensureAdaptReady, refreshAfterScriptMutation, revise, reviseNotes, reviseTarget, supportsGeneration])

  const handleFix = useCallback(async () => {
    if (!supportsGeneration) return
    const success = await fix()
    if (!success) return
    addToast('success', '质检问题已修正')
    await refreshAfterScriptMutation()
  }, [addToast, fix, refreshAfterScriptMutation, supportsGeneration])

  const handlePause = useCallback(async () => {
    const success = await pause()
    addToast(success ? 'info' : 'error', success ? '编剧管线已暂停' : '暂停失败')
  }, [addToast, pause])

  const handleAbort = useCallback(async () => {
    const success = await abort()
    addToast(success ? 'warning' : 'error', success ? '编剧管线已停止' : '停止失败')
  }, [abort, addToast])

  const handleStartDirectorAnalysis = useCallback(async () => {
    if (!currentProject || !selectedEpisodeRecord?.hasScript || currentEp <= 0) {
      addToast('warning', '请先确保当前集已有剧本并已保存，再启动导演分析')
      return false
    }
    if (!saved) {
      addToast('warning', '当前剧本还有未保存修改，请先保存后再启动导演分析')
      return false
    }
    const llmConfig = getDefaultConfig('llm')
    if (!llmConfig) {
      addToast('error', '请先在设置中配置 LLM')
      return false
    }

    const result = await startPipeline({
      projectId: currentProject.id,
      projectPath: currentProject.projectPath,
      episodeNum: currentEp,
      projectName: currentProject.name,
      visualStyle: currentProject.visualStyle,
      targetMedium: currentProject.targetMedium,
      startStage: 'director',
      singleStage: true
    })

    if (result.error) {
      addToast('error', result.error)
      return false
    }

    addToast('info', `已启动 EP${String(currentEp).padStart(3, '0')} 导演分析（~start）`)
    return true
  }, [addToast, currentEp, currentProject, getDefaultConfig, saved, selectedEpisodeRecord?.hasScript, startPipeline])

  const handleViewDirectorOutput = useCallback(async () => {
    if (!currentProject || currentEp <= 0) return false
    const next = new URLSearchParams(searchParams)
    next.set('ep', String(currentEp))
    next.set('tab', 'director')
    setSearchParams(next, { replace: true })
    if (!directorOutput.trim()) {
      addToast('info', '当前还没有可展示的导演分析内容，若已启动请稍候刷新。')
      return false
    }
    addToast('success', '已加载导演分析结果，可在当前页面查看。')
    return true
  }, [addToast, currentEp, currentProject, directorOutput, searchParams, setSearchParams])

  const handleReload = useCallback(async () => {
    const reloaded = await loadScriptContent(currentProject?.id, currentProject?.projectPath, currentEp, { preserveOnError: true })
    if (!reloaded) {
      addToast('warning', `EP${String(currentEp).padStart(3, '0')} 重新加载失败，已保留当前内容`)
    }
  }, [addToast, currentEp, currentProject, loadScriptContent])

  const handleSave = useCallback(async () => {
    if (!currentProject || currentEp <= 0 || saving) return
    setSaving(true)
    try {
      await platformAPI.invoke(
        IPC.SCRIPT_SAVE_EPISODE,
        currentProject.projectPath,
        currentEp,
        editorContent
      )
      setSaved(true)
      addToast('success', '剧本已保存')
      await Promise.all([
        syncEpisodeStatus(),
        refreshScripts(currentProject.id, currentProject.projectPath, { preserveOnError: true })
      ])
    } catch (saveError) {
      addToast('error', `保存失败：${saveError instanceof Error ? saveError.message : String(saveError)}`)
    } finally {
      setSaving(false)
    }
  }, [addToast, currentEp, currentProject, editorContent, refreshScripts, saving, syncEpisodeStatus])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMeta = event.metaKey || event.ctrlKey
      if (isMeta && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!saved) {
          void handleSave()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave, saved])

  const handleEpisodeSelect = useCallback((episode: number) => {
    if (episode === currentEp) return
    if (!saved) {
      const confirmed = window.confirm(`EP${String(currentEp).padStart(3, '0')} 仍有未保存修改，确定切换？`)
      if (!confirmed) return
    }
    preferredEpisodeRef.current = episode
    setCurrentEp(episode)
    updateEpisodeSearchParam(episode)
  }, [currentEp, saved, updateEpisodeSearchParam])

  const handleEditorChange = useCallback((value: string) => {
    if (value === editorContentRef.current) return
    setEditorContent(value)
    setSaved(false)
  }, [])

  const handleTogglePreview = useCallback(() => {
    setPreviewOpen((value) => !value)
  }, [])

  const handleOpenRevise = useCallback(() => {
    setReviseTarget(currentEp)
  }, [currentEp])

  const handleReviseNotesChange = useCallback((value: string) => {
    setReviseNotes(value)
  }, [])

  const handleCancelRevise = useCallback(() => {
    setReviseTarget(null)
    setReviseNotes('')
  }, [])

  const handleOpenBatchDrawer = useCallback(() => {
    if (!supportsGeneration) return
    setBatchDraftCount((current) => Math.min(Math.max(current, 2), maxBatchCount))
    setBatchDrawerOpen(true)
  }, [maxBatchCount, supportsGeneration])

  const handleCloseBatchDrawer = useCallback(() => {
    setBatchDrawerOpen(false)
  }, [])

  const handleBatchDraftCountChange = useCallback((value: number) => {
    const normalized = Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 1), maxBatchCount) : 1
    setBatchDraftCount(normalized)
  }, [maxBatchCount])

  const handleSubmitBatchCreate = useCallback(async () => {
    const success = await handleCreateScript(batchDraftCount)
    if (success) {
      setBatchDrawerOpen(false)
    }
  }, [batchDraftCount, handleCreateScript])

  return {
    currentProject,
    episodes,
    scripts,
    waterLevel,
    adaptState,
    isRunning,
    streamOutput,
    recentLogs,
    error,
    reviewFailedData,
    activeReviewResult,
    supportsGeneration,
    availableEpisodes,
    currentEp,
    currentScript,
    episodeQueue,
    pendingPlotEpisodeSet,
    pendingPlotForCurrent,
    selectedEpisodeRecord,
    selectedEpisodeHasScript,
    directorStageState,
    directorStatusHint,
    directorOutput,
    directorOutputLoading,
    editorContent,
    liveMeta,
    liveTitle,
    saved,
    loading,
    saving,
    previewOpen,
    reviseTarget,
    reviseNotes,
    batchDrawerOpen,
    batchDraftCount,
    maxBatchCount,
    generationStatusText,
    effectiveScriptPassScore,
    scriptAutoRepairRounds,
    batchActionLabel,
    batchConstraintText,
    strategyChips,
    streamRef,
    clearStream,
    handleCreateScript,
    handleReCreate,
    handleGenerateEpisode,
    handleRevise,
    handleFix,
    handlePause,
    handleAbort,
    handleStartDirectorAnalysis,
    handleViewDirectorOutput,
    handleReload,
    handleSave,
    handleEpisodeSelect,
    handleEditorChange,
    handleTogglePreview,
    handleOpenRevise,
    handleReviseNotesChange,
    handleCancelRevise,
    handleOpenBatchDrawer,
    handleCloseBatchDrawer,
    handleBatchDraftCountChange,
    handleSubmitBatchCreate
  }
}
