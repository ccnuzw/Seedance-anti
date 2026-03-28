import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { IPC } from '@shared/ipc-channels'
import type { Episode } from '@shared/types'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { platformAPI } from '@renderer/platform/api'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'

export interface ParsedPrompt {
  index: number
  title: string
  content: string
  duration: number
  references: Array<{ referenceTag: string; assetType: string }>
}

export type PromptArtifactTab = 'prompts' | 'director' | 'art' | 'assets'
export type PromptStageTone = 'default' | 'warning' | 'success' | 'danger' | 'info'

interface LoadPromptsOptions {
  preserveOnError?: boolean
  preserveEditingState?: boolean
}

interface EpisodeAssetPromptSection {
  type: 'character' | 'scene'
  title: string
  filePath: string
  excerpt: string
}

export interface PromptWorkspaceState {
  episodes: Episode[]
  currentEp: number
  prompts: ParsedPrompt[]
  loading: boolean
  selectedIndex: number | null
  isEditing: boolean
  rawMd: string
  viewTab: PromptArtifactTab
  tabContent: string
  tabLoading: boolean
  actualPrompts: ParsedPrompt[]
  totalDuration: number
  durationOk: boolean
  assetSections: EpisodeAssetPromptSection[]
  storyboardStatusLabel: string
  storyboardStatusTone: PromptStageTone
  storyboardStatusDescription: string
  storyboardFeedback: string
  storyboardFeedbackTitle: string
  storyboardActionLabel: string
  storyboardOutputPath: string
  canStartStoryboardGeneration: boolean
  storyboardBusy: boolean
  episodeCompleted: boolean
  handleEpisodeSelect: (episode: number) => void
  handleViewTabChange: (tab: PromptArtifactTab) => void
  handleSelectPrompt: (index: number) => void
  handleStartEdit: () => void
  handleRawMdChange: (value: string) => void
  handleSave: () => Promise<void>
  handleCancelEdit: () => Promise<void>
  handleReReview: () => Promise<void>
  handleStartStoryboardGeneration: () => Promise<void>
}

function parsePromptsFromMarkdown(raw: string): ParsedPrompt[] {
  const prompts: ParsedPrompt[] = []
  const sections = raw.split(/^## /m).slice(1)

  sections.forEach((section, idx) => {
    const lines = section.trim().split('\n')
    const title = lines[0]?.trim() || `提示词 ${idx + 1}`

    const durationMatch = section.match(/时长[：:]\s*(\d+)\s*[秒s]/i)
      || section.match(/(\d+)\s*[秒s]/i)
    const duration = durationMatch ? parseInt(durationMatch[1]) : 5

    const content = lines
      .slice(1)
      .filter((line) => !line.startsWith('**') && line.trim().length > 0)
      .join('\n')
      .trim()

    const references: ParsedPrompt['references'] = []
    const refMatches = section.matchAll(/@(图片\d+|场景图\d+)/g)
    for (const match of refMatches) {
      references.push({
        referenceTag: match[0],
        assetType: match[1].startsWith('场景') ? 'scene' : 'character'
      })
    }

    if (content.length > 0) {
      prompts.push({ index: idx, title, content, duration, references })
    }
  })

  return prompts
}

function extractEpisodeAssetSection(raw: string, episodeNum: number): string {
  const candidates = [
    new RegExp(`(^|\\n)##\\s*EP0*${episodeNum}\\b[\\s\\S]*?(?=\\n##\\s*EP0*\\d+\\b|$)`, 'i'),
    new RegExp(`(^|\\n)##\\s*第\\s*0*${episodeNum}\\s*集[\\s\\S]*?(?=\\n##\\s*(?:EP0*\\d+|第\\s*\\d+\\s*集)|$)`, 'i'),
    new RegExp(`(^|\\n)###\\s*EP0*${episodeNum}\\b[\\s\\S]*?(?=\\n###\\s*EP0*\\d+\\b|$)`, 'i'),
    new RegExp(`(^|\\n)###\\s*第\\s*0*${episodeNum}\\s*集[\\s\\S]*?(?=\\n###\\s*(?:EP0*\\d+|第\\s*\\d+\\s*集)|$)`, 'i')
  ]

  for (const pattern of candidates) {
    const match = raw.match(pattern)
    if (match?.[0]) return match[0].trim()
  }
  return ''
}

function buildStoryboardOutputPath(projectPath?: string, episodeNum?: number): string {
  if (!projectPath || !episodeNum) return ''
  return `${projectPath.replace(/\/+$/, '')}/outputs/ep${String(episodeNum).padStart(3, '0')}/02-seedance-prompts.md`
}

export function usePromptWorkspace(): PromptWorkspaceState {
  useProjectSync()

  const [searchParams, setSearchParams] = useSearchParams()
  const { currentProject, episodes, syncEpisodeStatus } = useProjectStore()
  const addToast = useToastStore((state) => state.addToast)
  const {
    state: pipelineState,
    context: pipelineContext,
    currentReview,
    setupEventListeners,
    syncFromBackend,
    startPipeline
  } = usePipelineStore()

  const [prompts, setPrompts] = useState<ParsedPrompt[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [rawMd, setRawMd] = useState('')
  const [viewTab, setViewTab] = useState<PromptArtifactTab>('prompts')
  const [tabContent, setTabContent] = useState('')
  const [tabLoading, setTabLoading] = useState(false)
  const [assetSections, setAssetSections] = useState<EpisodeAssetPromptSection[]>([])

  const promptLoadTokenRef = useRef(0)
  const tabLoadTokenRef = useRef(0)

  const queryEp = Number.parseInt(searchParams.get('ep') || '0', 10)
  const queryTab = searchParams.get('tab')
  const [currentEp, setCurrentEp] = useState(queryEp > 0 ? queryEp : 1)
  const epList = useMemo(
    () => episodes.map((episode) => episode.episodeNumber).sort((a, b) => a - b),
    [episodes]
  )

  const loadPrompts = useCallback(async (
    projectId?: string,
    projectPath?: string,
    episodeNum?: number,
    options?: LoadPromptsOptions
  ): Promise<boolean> => {
    if (!projectId || !projectPath || !episodeNum) return false
    const requestToken = ++promptLoadTokenRef.current
    let restored = false
    setLoading(true)
    setSelectedIndex(null)
    if (!options?.preserveEditingState) {
      setIsEditing(false)
    }
    try {
      const raw = await platformAPI.invoke(
        IPC.PROMPT_READ_EPISODE_FILE,
        projectPath,
        episodeNum,
        'prompts'
      ) as string | null
      if (promptLoadTokenRef.current !== requestToken || useProjectStore.getState().currentProject?.id !== projectId) {
        return false
      }
      if (!raw) throw new Error('文件不存在')
      setRawMd(raw)
      setPrompts(parsePromptsFromMarkdown(raw))
      if (options?.preserveEditingState) {
        setIsEditing(false)
      }
      restored = true
    } catch {
      if (promptLoadTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === projectId) {
        if (options?.preserveOnError) return false
        setRawMd('')
        setPrompts([])
      }
    } finally {
      if (promptLoadTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === projectId) {
        setLoading(false)
      }
    }
    return restored
  }, [])

  const loadTabContent = useCallback(async (
    projectId?: string,
    projectPath?: string,
    episodeNum?: number,
    tab?: Exclude<PromptArtifactTab, 'prompts'>
  ) => {
    if (!projectId || !projectPath || !episodeNum || !tab) return
    const requestToken = ++tabLoadTokenRef.current
    setTabLoading(true)
    try {
      if (tab === 'assets') {
        const files = [
          {
            type: 'character' as const,
            title: '人物提示词',
            filePath: `${projectPath.replace(/\/+$/, '')}/assets/character-prompts.md`
          },
          {
            type: 'scene' as const,
            title: '场景提示词',
            filePath: `${projectPath.replace(/\/+$/, '')}/assets/scene-prompts.md`
          }
        ]

        const results = await Promise.all(files.map(async (item) => {
          try {
            const raw = await platformAPI.invoke(IPC.FILE_READ, item.filePath) as string | null
            const excerpt = raw ? extractEpisodeAssetSection(raw, episodeNum) : ''
            return excerpt
              ? { ...item, excerpt }
              : null
          } catch {
            return null
          }
        }))

        if (tabLoadTokenRef.current !== requestToken || useProjectStore.getState().currentProject?.id !== projectId) {
          return
        }

        const sections = results.filter((item): item is EpisodeAssetPromptSection => !!item)
        setAssetSections(sections)
        setTabContent('')
        return
      }

      const raw = await platformAPI.invoke(
        IPC.PROMPT_READ_EPISODE_FILE,
        projectPath,
        episodeNum,
        tab
      ) as string | null
      if (tabLoadTokenRef.current !== requestToken || useProjectStore.getState().currentProject?.id !== projectId) {
        return
      }
      setAssetSections([])
      setTabContent(raw || '')
    } catch {
      if (tabLoadTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === projectId) {
        setTabContent('')
        setAssetSections([])
      }
    } finally {
      if (tabLoadTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === projectId) {
        setTabLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    const cleanup = setupEventListeners()
    return cleanup
  }, [setupEventListeners])

  useEffect(() => {
    void syncFromBackend()
  }, [currentProject?.id, syncFromBackend])

  useEffect(() => {
    if (currentProject && episodes.length === 0) {
      void syncEpisodeStatus()
    }
  }, [currentProject?.id, episodes.length, syncEpisodeStatus])

  useEffect(() => {
    promptLoadTokenRef.current += 1
    tabLoadTokenRef.current += 1
    setCurrentEp(1)
    setPrompts([])
    setRawMd('')
    setTabContent('')
    setAssetSections([])
    setSelectedIndex(null)
    setIsEditing(false)
    setViewTab(queryTab === 'director' || queryTab === 'art' || queryTab === 'assets' ? queryTab : 'prompts')
    setLoading(false)
    setTabLoading(false)
  }, [currentProject?.id, queryTab])

  useEffect(() => {
    if (episodes.length === 0) return
    const resolvedEpisode = epList.includes(queryEp)
      ? queryEp
      : epList.includes(currentEp)
        ? currentEp
        : epList[0]
    setCurrentEp(resolvedEpisode)
    const next = new URLSearchParams(searchParams)
    next.set('ep', String(resolvedEpisode))
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true })
    }
  }, [currentEp, epList, episodes, queryEp, searchParams, setSearchParams])

  useEffect(() => {
    if (currentProject && currentEp > 0) {
      void loadPrompts(currentProject.id, currentProject.projectPath, currentEp)
    }
  }, [currentEp, currentProject, currentProject?.id, currentProject?.projectPath, loadPrompts])

  useEffect(() => {
    if (viewTab !== 'prompts' && currentProject && currentEp > 0) {
      void loadTabContent(currentProject.id, currentProject.projectPath, currentEp, viewTab)
    }
  }, [currentEp, currentProject, currentProject?.id, currentProject?.projectPath, loadTabContent, viewTab])

  const currentEpisodeRecord = useMemo(
    () => episodes.find((episode) => episode.episodeNumber === currentEp),
    [currentEp, episodes]
  )
  const storyboardOutputPath = useMemo(
    () => buildStoryboardOutputPath(currentProject?.projectPath, currentEp),
    [currentEp, currentProject?.projectPath]
  )
  const isCurrentEpisodePipeline = pipelineContext?.projectId === currentProject?.id
    && pipelineContext?.episodeNum === currentEp
  const storyboardBusy = isCurrentEpisodePipeline
    && (pipelineState === 'storyboard_writing' || pipelineState === 'storyboard_reviewing')
  const storyboardReviewFailed = Boolean(
    isCurrentEpisodePipeline
      && currentReview
      && currentReview.stage === 'storyboard'
      && !currentReview.passed
  )
  const storyboardRuntimeFailed = Boolean(isCurrentEpisodePipeline && pipelineState === 'error')
  const episodeCompleted = Boolean(currentEpisodeRecord?.hasSeedancePrompts || (isCurrentEpisodePipeline && pipelineState === 'episode_complete'))
  const canStartStoryboardGeneration = Boolean(currentEpisodeRecord?.hasArtDesign && !storyboardBusy && !isEditing)

  useEffect(() => {
    if (!currentProject || currentEp <= 0 || !isCurrentEpisodePipeline) return
    if (pipelineState === 'episode_complete') {
      void syncEpisodeStatus()
      void loadPrompts(currentProject.id, currentProject.projectPath, currentEp, { preserveOnError: true })
    }
  }, [currentEp, currentProject, isCurrentEpisodePipeline, loadPrompts, pipelineState, syncEpisodeStatus])

  const handleSave = useCallback(async () => {
    if (!currentProject) return
    try {
      await platformAPI.invoke(
        IPC.PROMPT_SAVE_EPISODE_FILE,
        currentProject.projectPath,
        currentEp,
        'prompts',
        rawMd
      )
      setPrompts(parsePromptsFromMarkdown(rawMd))
      setIsEditing(false)
      addToast('success', '提示词已保存')
    } catch {
      addToast('error', '保存失败')
    }
  }, [addToast, currentEp, currentProject, rawMd])

  const handleStartStoryboardGeneration = useCallback(async () => {
    if (!currentProject) return
    if (!currentEpisodeRecord?.hasArtDesign) {
      addToast('warning', '请先完成服化道阶段，再启动分镜 / Seedance 提示词生成')
      return
    }
    const result = await startPipeline({
      projectId: currentProject.id,
      projectPath: currentProject.projectPath,
      episodeNum: currentEp,
      projectName: currentProject.name,
      visualStyle: currentProject.visualStyle,
      targetMedium: currentProject.targetMedium,
      startStage: 'storyboard',
      singleStage: true
    })
    if (result.error) {
      addToast('error', result.error || '启动分镜生成失败')
      return
    }
    addToast('info', `已启动 EP${String(currentEp).padStart(3, '0')} 分镜生成，将自动进入审核`) 
  }, [addToast, currentEp, currentEpisodeRecord?.hasArtDesign, currentProject, startPipeline])

  const handleReReview = useCallback(async () => {
    await handleStartStoryboardGeneration()
  }, [handleStartStoryboardGeneration])

  const handleEpisodeSelect = useCallback((episode: number) => {
    setCurrentEp(episode)
    const next = new URLSearchParams(searchParams)
    next.set('ep', String(episode))
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const handleCancelEdit = useCallback(async () => {
    if (!currentProject) return
    const restored = await loadPrompts(
      currentProject.id,
      currentProject.projectPath,
      currentEp,
      { preserveOnError: true, preserveEditingState: true }
    )
    if (!restored) {
      addToast('warning', '原始提示词加载失败，已保留当前编辑内容')
    }
  }, [addToast, currentEp, currentProject, loadPrompts])

  const actualPrompts = useMemo(
    () => prompts.filter((prompt) => prompt.index > 0),
    [prompts]
  )
  const totalDuration = useMemo(
    () => actualPrompts.reduce((sum, prompt) => sum + prompt.duration, 0),
    [actualPrompts]
  )
  const durationOk = totalDuration >= 90 && totalDuration <= 120

  const storyboardStatus = useMemo(() => {
    if (!currentEpisodeRecord?.hasArtDesign) {
      return {
        label: '待服化道完成',
        tone: 'default' as PromptStageTone,
        description: '当前集还不能直接进入分镜阶段，请先完成服化道设计并产出基础素材提示词。',
        feedback: '',
        feedbackTitle: '',
        actionLabel: '启动分镜生成（~prompt）'
      }
    }
    if (storyboardBusy) {
      if (pipelineState === 'storyboard_reviewing') {
        return {
          label: '审核中',
          tone: 'warning' as PromptStageTone,
          description: '分镜内容已生成，系统正在审核 Seedance 提示词质量，请稍候查看最终结果。',
          feedback: '系统正在执行分镜审核，若审核失败会在此展示修改建议。',
          feedbackTitle: '阶段反馈',
          actionLabel: '分镜审核中…'
        }
      }
      return {
        label: '生成中',
        tone: 'info' as PromptStageTone,
        description: '已开始生成分镜 / Seedance 提示词，完成后会自动进入审核。',
        feedback: '你可以留在当前页等待，也可以稍后通过项目进度视图查看本集状态。',
        feedbackTitle: '阶段反馈',
        actionLabel: '分镜生成中…'
      }
    }
    if (episodeCompleted) {
      return {
        label: '已完成',
        tone: 'success' as PromptStageTone,
        description: '该集已经跑通到可交付的 Seedance 提示词产物，当前页面即可查看最终内容。',
        feedback: `单集已完成，结果文件位于 ${storyboardOutputPath}`,
        feedbackTitle: '单集完成',
        actionLabel: '重新生成分镜（~prompt）'
      }
    }
    if (storyboardReviewFailed || storyboardRuntimeFailed) {
      return {
        label: '失败',
        tone: 'danger' as PromptStageTone,
        description: '本集分镜阶段未通过，请根据审核意见或错误信息调整后重试。',
        feedback: currentReview?.feedback || pipelineContext?.error || '审核未通过，建议检查提示词完整性、镜头拆分与时长分配。',
        feedbackTitle: currentReview?.feedback ? '审核建议' : '失败原因',
        actionLabel: '重新生成分镜（~prompt）'
      }
    }
    if (currentEpisodeRecord?.status === 'storyboard') {
      return {
        label: '审核中',
        tone: 'warning' as PromptStageTone,
        description: '该集已进入分镜阶段，建议等待审核结果或进入项目进度视图确认最终状态。',
        feedback: '如果长时间没有更新，可刷新项目状态或重新进入当前页面。',
        feedbackTitle: '阶段反馈',
        actionLabel: '重新生成分镜（~prompt）'
      }
    }
    return {
      label: '未开始',
      tone: 'default' as PromptStageTone,
      description: '服化道已就绪，可以从这里一键启动分镜生成（~prompt），并在本页查看最终 Seedance 提示词。',
      feedback: '',
      feedbackTitle: '',
      actionLabel: '启动分镜生成（~prompt）'
    }
  }, [currentEpisodeRecord?.hasArtDesign, currentEpisodeRecord?.status, currentReview?.feedback, episodeCompleted, pipelineContext?.error, pipelineState, storyboardBusy, storyboardOutputPath, storyboardReviewFailed, storyboardRuntimeFailed])

  return {
    episodes,
    currentEp,
    prompts,
    loading,
    selectedIndex,
    isEditing,
    rawMd,
    viewTab,
    tabContent,
    tabLoading,
    actualPrompts,
    totalDuration,
    durationOk,
    assetSections,
    storyboardStatusLabel: storyboardStatus.label,
    storyboardStatusTone: storyboardStatus.tone,
    storyboardStatusDescription: storyboardStatus.description,
    storyboardFeedback: storyboardStatus.feedback,
    storyboardFeedbackTitle: storyboardStatus.feedbackTitle,
    storyboardActionLabel: storyboardStatus.actionLabel,
    storyboardOutputPath,
    canStartStoryboardGeneration,
    storyboardBusy,
    episodeCompleted,
    handleEpisodeSelect,
    handleViewTabChange: (tab) => {
      setViewTab(tab)
      const next = new URLSearchParams(searchParams)
      if (tab === 'prompts') {
        next.delete('tab')
      } else {
        next.set('tab', tab)
      }
      setSearchParams(next, { replace: true })
    },
    handleSelectPrompt: setSelectedIndex,
    handleStartEdit: () => setIsEditing(true),
    handleRawMdChange: setRawMd,
    handleSave,
    handleCancelEdit,
    handleReReview,
    handleStartStoryboardGeneration
  }
}
