import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { IPC } from '@shared/ipc-channels'
import type { Character, Episode, Scene } from '@shared/types'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { platformAPI } from '@renderer/platform/api'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'

export type AssetTab = 'characters' | 'scenes'

export interface PromptStats {
  totalCount: number
  totalDuration: number
  avgDuration: number
}

export interface PromptSummary {
  index: number
  title: string
  duration: number
  references: Array<{ referenceTag: string; assetType: string }>
}

interface LoadAssetsOptions {
  preserveOnError?: boolean
}

export interface AssetWorkspaceState {
  episodes: Episode[]
  currentEp: number
  tab: AssetTab
  characters: Character[]
  scenes: Scene[]
  filteredCharacters: Character[]
  filteredScenes: Scene[]
  searchQuery: string
  expandedId: string | null
  editingId: string | null
  editText: string
  promptStats: PromptStats | null
  promptSummaries: PromptSummary[]
  canUploadImages: boolean
  handleEpisodeSelect: (episode: number) => void
  handleTabChange: (tab: AssetTab) => void
  handleSearchQueryChange: (value: string) => void
  handleToggleExpand: (id: string) => void
  handleStartEdit: (id: string, currentText: string) => void
  handleCancelEdit: () => void
  handleEditTextChange: (value: string) => void
  handleCopy: (text: string, name: string) => void
  handleUploadImage: (assetType: 'character' | 'scene', assetName: string) => Promise<void>
  handleSave: (assetType: 'character' | 'scene', assetName: string) => Promise<void>
}

export function useAssetWorkspace(): AssetWorkspaceState {
  useProjectSync()

  const [searchParams, setSearchParams] = useSearchParams()
  const { currentProject, episodes, syncEpisodeStatus } = useProjectStore()
  const addToast = useToastStore((state) => state.addToast)
  const canUploadImages = platformAPI.isDesktopBridgeAvailable

  const [tab, setTab] = useState<AssetTab>('characters')
  const [characters, setCharacters] = useState<Character[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [promptStats, setPromptStats] = useState<PromptStats | null>(null)
  const [promptSummaries, setPromptSummaries] = useState<PromptSummary[]>([])
  const deferredSearchQuery = useDeferredValue(searchQuery)

  const assetsLoadTokenRef = useRef(0)
  const promptContextTokenRef = useRef(0)

  const queryEp = Number.parseInt(searchParams.get('ep') || '0', 10)
  const [currentEp, setCurrentEp] = useState(queryEp > 0 ? queryEp : 1)

  const loadAssets = useCallback(async (
    projectId?: string,
    projectPath?: string,
    options?: LoadAssetsOptions
  ): Promise<boolean> => {
    if (!projectId || !projectPath) return false
    const requestToken = ++assetsLoadTokenRef.current
    try {
      const chars = await platformAPI.invoke(IPC.ASSET_LIST_CHARACTERS, projectPath) as Character[]
      const scns = await platformAPI.invoke(IPC.ASSET_LIST_SCENES, projectPath) as Scene[]
      if (assetsLoadTokenRef.current !== requestToken || useProjectStore.getState().currentProject?.id !== projectId) {
        return false
      }
      setCharacters(chars)
      setScenes(scns)
      return true
    } catch {
      if (assetsLoadTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === projectId) {
        if (options?.preserveOnError) return false
        setCharacters([])
        setScenes([])
      }
      return false
    }
  }, [])

  const loadPromptContext = useCallback(async (
    projectId?: string,
    projectPath?: string,
    episodeNum?: number
  ) => {
    if (!projectId || !projectPath || !episodeNum) return
    const requestToken = ++promptContextTokenRef.current
    try {
      const [stats, prompts] = await Promise.all([
        platformAPI.invoke(IPC.ASSET_PROMPT_STATS, projectPath, episodeNum) as Promise<PromptStats>,
        platformAPI.invoke(IPC.ASSET_LOAD_PROMPTS, projectPath, episodeNum) as Promise<PromptSummary[]>
      ])
      if (promptContextTokenRef.current !== requestToken || useProjectStore.getState().currentProject?.id !== projectId) {
        return
      }
      setPromptStats(stats)
      setPromptSummaries(prompts)
    } catch {
      if (promptContextTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === projectId) {
        setPromptStats(null)
        setPromptSummaries([])
      }
    }
  }, [])

  useEffect(() => {
    assetsLoadTokenRef.current += 1
    promptContextTokenRef.current += 1
    setCharacters([])
    setScenes([])
    setSearchQuery('')
    setExpandedId(null)
    setEditingId(null)
    setEditText('')
    setPromptStats(null)
    setPromptSummaries([])
    if (currentProject) {
      void loadAssets(currentProject.id, currentProject.projectPath)
    }
  }, [currentProject?.id, currentProject?.projectPath, currentProject, loadAssets])

  useEffect(() => {
    if (tab === 'characters' && characters.length === 0 && scenes.length > 0) {
      setTab('scenes')
    }
  }, [characters.length, scenes.length, tab])

  useEffect(() => {
    if (currentProject && episodes.length === 0) {
      void syncEpisodeStatus()
    }
  }, [currentProject?.id, episodes.length, syncEpisodeStatus])

  useEffect(() => {
    if (episodes.length === 0) return
    const episodeNumbers = episodes.map((episode) => episode.episodeNumber)
    const resolvedEpisode = episodeNumbers.includes(queryEp)
      ? queryEp
      : episodeNumbers.includes(currentEp)
        ? currentEp
        : episodeNumbers[0]
    setCurrentEp(resolvedEpisode)
    const next = new URLSearchParams(searchParams)
    next.set('ep', String(resolvedEpisode))
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true })
    }
  }, [currentEp, episodes, queryEp, searchParams, setSearchParams])

  useEffect(() => {
    if (currentProject && currentEp > 0) {
      void loadPromptContext(currentProject.id, currentProject.projectPath, currentEp)
    }
  }, [currentProject, currentProject?.id, currentProject?.projectPath, currentEp, loadPromptContext])

  const handleUploadImage = useCallback(async (assetType: 'character' | 'scene', assetName: string) => {
    if (!currentProject) return
    if (!canUploadImages) {
      addToast('warning', '当前网页模式暂不支持直接上传本地参考图')
      return
    }
    try {
      const sourcePath = await platformAPI.invoke(IPC.FILE_SELECT_FILE, [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
      ]) as string | null
      if (!sourcePath) return

      await platformAPI.invoke(IPC.ASSET_UPLOAD_IMAGE, {
        projectPath: currentProject.projectPath,
        assetType,
        assetName,
        sourcePath
      })
      addToast('success', `${assetName} 参考图已上传`)
      const refreshed = await loadAssets(currentProject.id, currentProject.projectPath, { preserveOnError: true })
      if (!refreshed) {
        addToast('warning', '参考图已上传，但素材列表刷新失败')
      }
    } catch (error) {
      addToast('error', `参考图上传失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [addToast, canUploadImages, currentProject, loadAssets])

  const handleCopy = useCallback((text: string, name: string) => {
    navigator.clipboard.writeText(text)
    addToast('success', `已复制 ${name} 提示词`)
  }, [addToast])

  const handleToggleExpand = useCallback((id: string) => {
    if (editingId) return
    setExpandedId((prev) => (prev === id ? null : id))
  }, [editingId])

  const handleStartEdit = useCallback((id: string, currentText: string) => {
    setEditingId(id)
    setEditText(currentText)
    setExpandedId(id)
  }, [])

  const handleCancelEdit = useCallback(() => {
    setEditingId(null)
    setEditText('')
  }, [])

  const handleSave = useCallback(async (assetType: 'character' | 'scene', assetName: string) => {
    if (!currentProject) return
    try {
      const result = await platformAPI.invoke(IPC.ASSET_UPDATE_PROMPT, {
        projectPath: currentProject.projectPath,
        assetType,
        assetName,
        newPromptText: editText
      }) as { success: boolean; error?: string }

      if (!result.success) {
        addToast('error', result.error || '保存失败')
        return
      }

      setEditingId(null)
      setEditText('')
      addToast('success', `${assetName} 提示词已保存`)
      const refreshed = await loadAssets(currentProject.id, currentProject.projectPath, { preserveOnError: true })
      if (!refreshed) {
        addToast('warning', '提示词已保存，但素材列表刷新失败')
      }
    } catch (error) {
      addToast('error', `保存失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [addToast, currentProject, editText, loadAssets])

  const handleEpisodeSelect = useCallback((episode: number) => {
    setCurrentEp(episode)
    const next = new URLSearchParams(searchParams)
    next.set('ep', String(episode))
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const filteredCharacters = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase()
    return query
      ? characters.filter((character) => character.name.toLowerCase().includes(query))
      : characters
  }, [characters, deferredSearchQuery])

  const filteredScenes = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase()
    return query
      ? scenes.filter((scene) => scene.name.toLowerCase().includes(query))
      : scenes
  }, [deferredSearchQuery, scenes])

  return {
    episodes,
    currentEp,
    tab,
    characters,
    scenes,
    filteredCharacters,
    filteredScenes,
    searchQuery,
    expandedId,
    editingId,
    editText,
    promptStats,
    promptSummaries,
    canUploadImages,
    handleEpisodeSelect,
    handleTabChange: setTab,
    handleSearchQueryChange: setSearchQuery,
    handleToggleExpand,
    handleStartEdit,
    handleCancelEdit,
    handleEditTextChange: setEditText,
    handleCopy,
    handleUploadImage,
    handleSave
  }
}
