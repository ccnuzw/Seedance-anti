import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { readTextFile, selectDirectory } from '@renderer/services/file-io'
import {
  detectProjectDirectory,
  getPlotBreakdownSummary,
  getProjectPipelineState,
  saveProjectSettings
} from '@renderer/services/project-service'
import { getExceptionMessage } from '@renderer/services/service-contracts'
import { invalidateCachedTextFile } from '@renderer/services/file-cache'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'
import type {
  Episode,
  ProjectConfig,
  ProjectPipelineState
} from '@shared/types'
import { buildProductionRows } from '@renderer/utils/project-production-view'
import {
  pipelineSettingsDraft,
  validatePipelineSettingsDraft,
  type PipelineSettingsDraft
} from '@renderer/components/project/pipeline-settings-draft'
import type { PlotBreakdownSummary } from '@shared/ipc-contracts'
import { VISUAL_STYLES, TARGET_MEDIUMS } from '@shared/constants'
import type { DetectedProjectInfo } from '@shared/project-detection'
import {
  mergeProjectConfig,
  normalizeProjectConfig
} from '@shared/project-config'
import { resolveProjectArtifactPath } from '@shared/path-resolver'
import { useShallow } from 'zustand/react/shallow'
import {
  getProjectEntryLabel,
  getProjectProgress
} from '@renderer/components/project/project-page-view'

export function useProjectPageController() {
  const navigate = useNavigate()
  const { currentProject, episodes } = useProjectStore(
    useShallow((s) => ({
      currentProject: s.currentProject,
      episodes: s.episodes
    }))
  )
  const { addToast } = useToastStore()
  const [importing, setImporting] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card')
  const [ps, setPs] = useState<PipelineSettingsDraft>(() =>
    pipelineSettingsDraft()
  )
  const [projectDraft, setProjectDraft] = useState({
    name: '',
    visualStyle: '',
    targetMedium: '',
    totalEpisodes: 0,
    chaptersPerEpisode: 0
  })
  const [psLoaded, setPsLoaded] = useState(false)
  const [psSaving, setPsSaving] = useState(false)
  const [pendingImport, setPendingImport] = useState<{
    targetPath: string
    config: Partial<ProjectConfig> | null
    detected: DetectedProjectInfo
  } | null>(null)
  const [production, setProduction] = useState<{
    projectId: string
    episodes: Episode[]
    pipeline: ProjectPipelineState | null
    hasSource: boolean | null
    waterline: PlotBreakdownSummary | null
    loading: boolean
    error: string | null
    warning: string | null
  } | null>(null)
  const requestEpoch = useRef(0)
  const projectId = currentProject?.id
  const visibleProduction =
    production?.projectId === projectId ? production : null
  const plotBreakdownSummary = visibleProduction?.waterline || null

  const loadProduction = useCallback(
    async (notify = false) => {
      if (!currentProject) return
      const project = currentProject
      const epoch = ++requestEpoch.current
      setProduction((previous) => ({
        projectId: project.id,
        episodes: previous?.projectId === project.id ? previous.episodes : [],
        pipeline: previous?.projectId === project.id ? previous.pipeline : null,
        hasSource:
          previous?.projectId === project.id ? previous.hasSource : null,
        waterline:
          previous?.projectId === project.id ? previous.waterline : null,
        loading: true,
        error: null,
        warning: null
      }))
      const entry = normalizeProjectConfig(project.config).entryStage || 'novel'
      const results = await Promise.allSettled([
        useProjectStore
          .getState()
          .syncEpisodeStatus()
          .then(() => useProjectStore.getState().episodes),
        getProjectPipelineState(project.projectPath),
        entry === 'novel'
          ? getPlotBreakdownSummary(project.id)
          : Promise.resolve(null),
        entry === 'novel'
          ? readTextFile(
              resolveProjectArtifactPath(
                project.projectPath,
                'sourceNovel',
                project.config
              )
            )
          : Promise.resolve(null)
      ])
      if (
        epoch !== requestEpoch.current ||
        useProjectStore.getState().currentProject?.id !== project.id
      )
        return
      const [episodeResult, pipelineResult, waterlineResult, sourceResult] =
        results
      const waterline =
        waterlineResult.status === 'fulfilled' ? waterlineResult.value : null
      const sourceKnown = sourceResult.status === 'fulfilled'
      const hasSource =
        entry !== 'novel'
          ? null
          : !sourceKnown
            ? null
            : !!sourceResult.value?.trim() ||
                (waterline?.totalSourceChapters || 0) > 0
              ? true
              : waterline
                ? false
                : null
      const errors = results.flatMap((result, index) =>
        result.status === 'rejected'
          ? [
              `${['分集状态', '导演 / 服化道审核快照', '剧情库存', '小说原文'][index]}读取失败：${getExceptionMessage(result.reason, '请刷新重试')}`
            ]
          : []
      )
      setProduction({
        projectId: project.id,
        episodes:
          episodeResult.status === 'fulfilled' ? episodeResult.value : [],
        pipeline:
          pipelineResult.status === 'fulfilled' ? pipelineResult.value : null,
        hasSource,
        waterline,
        loading: false,
        error:
          episodeResult.status === 'rejected'
            ? '分集状态读取失败，请刷新重试。'
            : null,
        warning: errors.length ? `部分状态未知：${errors.join('；')}` : null
      })
      if (notify)
        addToast(
          errors.length ? 'error' : 'success',
          errors.length ? '部分状态读取失败，请重试' : '项目状态已刷新'
        )
    },
    [currentProject, addToast]
  )

  useEffect(() => {
    void loadProduction()
    return () => {
      requestEpoch.current++
    }
  }, [loadProduction])

  const handleRefreshStatus = () => loadProduction(true)
  const productionRows = useMemo(
    () =>
      currentProject && visibleProduction && !visibleProduction.error
        ? buildProductionRows({
            project: currentProject,
            episodes: visibleProduction.episodes,
            pipeline: visibleProduction.pipeline,
            hasSource: visibleProduction.hasSource,
            readyEpisodeNumbers:
              visibleProduction.waterline?.readyEpisodeNumbers ?? null,
            usedEpisodeNumbers:
              visibleProduction.waterline?.usedEpisodeNumbers ?? null
          })
        : [],
    [currentProject, visibleProduction]
  )

  useEffect(() => {
    setPsLoaded(false)
    setShowSettings(false)
  }, [projectId])

  useEffect(() => {
    if (!showSettings || !currentProject || psLoaded) return
    ;(async () => {
      const configPath = resolveProjectArtifactPath(
        currentProject.projectPath,
        'projectConfig',
        currentProject.config
      )
      try {
        const raw = await readTextFile(configPath)
        if (useProjectStore.getState().currentProject?.id !== currentProject.id)
          return
        const config = raw !== null ? JSON.parse(raw) : currentProject.config
        if (!config || typeof config !== 'object' || Array.isArray(config))
          throw new Error('项目配置必须为对象')
        setPs(pipelineSettingsDraft(config.pipelineSettings))
        setProjectDraft({
          name: config.projectName || currentProject.name,
          visualStyle: config.visualStyle || currentProject.visualStyle,
          targetMedium: config.targetMedium || currentProject.targetMedium,
          totalEpisodes: Number(
            config.totalEpisodes || currentProject.totalEpisodes || 0
          ),
          chaptersPerEpisode: Math.max(
            0,
            Number(config.chaptersPerEpisode || 0) || 0
          )
        })
      } catch (error) {
        if (useProjectStore.getState().currentProject?.id !== currentProject.id)
          return
        const message = getExceptionMessage(error, '读取项目配置失败')
        setPs({ ...pipelineSettingsDraft(), configError: message })
        addToast('error', message)
        setProjectDraft({
          name: currentProject.name,
          visualStyle: currentProject.visualStyle,
          targetMedium: currentProject.targetMedium,
          totalEpisodes: currentProject.totalEpisodes,
          chaptersPerEpisode: Math.max(
            0,
            Number(currentProject.config?.chaptersPerEpisode || 0) || 0
          )
        })
      }
      setPsLoaded(true)
    })()
  }, [showSettings, currentProject, psLoaded])

  const handleSaveSettings = async () => {
    if (!currentProject) return
    const validation = validatePipelineSettingsDraft(ps)
    if (!validation.settings) {
      addToast(
        'error',
        validation.issues.map((issue) => issue.message).join('；')
      )
      return
    }
    const settings = validation.settings
    setPsSaving(true)
    try {
      let config: Record<string, unknown> = {}
      const configPath = resolveProjectArtifactPath(
        currentProject.projectPath,
        'projectConfig',
        currentProject.config
      )
      const raw = await readTextFile(configPath)
      config = raw !== null ? JSON.parse(raw) : { ...currentProject.config }
      if (!config || typeof config !== 'object' || Array.isArray(config))
        throw new Error('项目配置必须为对象')

      config.pipelineSettings = settings
      config.projectName = projectDraft.name.trim() || currentProject.name
      config.visualStyle = projectDraft.visualStyle.trim()
      config.targetMedium = projectDraft.targetMedium.trim()
      config.totalEpisodes = Math.max(
        0,
        Number(projectDraft.totalEpisodes) || 0
      )
      config.chaptersPerEpisode = Math.max(
        0,
        Number(projectDraft.chaptersPerEpisode) || 0
      )
      const updated = await saveProjectSettings(currentProject.id, {
        name: config.projectName as string,
        visualStyle: config.visualStyle as string,
        targetMedium: config.targetMedium as string,
        totalEpisodes: config.totalEpisodes as number,
        config: {
          ...currentProject.config,
          ...config,
          chaptersPerEpisode: config.chaptersPerEpisode as number,
          pipelineSettings: settings
        }
      })
      if (useProjectStore.getState().currentProject?.id === currentProject.id) {
        useProjectStore.setState((state) => ({
          currentProject: updated,
          projects: state.projects.map((item) =>
            item.id === updated.id ? updated : item
          )
        }))
        invalidateCachedTextFile(configPath)
        const summary = await getPlotBreakdownSummary(currentProject.id)
        setProduction((previous) =>
          previous?.projectId === currentProject.id
            ? { ...previous, waterline: summary }
            : previous
        )
      }
      addToast('success', '项目设置已保存')
    } catch (error) {
      addToast('error', getExceptionMessage(error, '保存失败'))
    }
    setPsSaving(false)
  }

  const handleResetSettings = () => {
    setPs(pipelineSettingsDraft())
    addToast('info', '已恢复默认值（需保存生效）')
  }

  const handleImportProject = async () => {
    setImporting(true)
    const dirPath = await selectDirectory()
    if (typeof dirPath === 'string' && dirPath.length > 0) {
      try {
        const detected = await detectProjectDirectory(dirPath)
        const targetPath = detected.resolvedPath || dirPath
        const configRaw = await readTextFile(
          resolveProjectArtifactPath(targetPath, 'projectConfig')
        )
        const parsedConfig = configRaw
          ? (JSON.parse(configRaw) as Partial<ProjectConfig>)
          : {}
        const normalizedConfig = normalizeProjectConfig(parsedConfig)
        const config = mergeProjectConfig(
          normalizedConfig,
          detected.suggestedConfig
        )
        setPendingImport({ targetPath, config, detected })
        if (targetPath !== dirPath) {
          addToast('info', `已自动定位到项目目录：${targetPath}`)
        }
      } catch (error) {
        addToast(
          'error',
          getExceptionMessage(
            error,
            '项目导入失败：请确认目录包含 project-config.json'
          )
        )
      }
    }
    setImporting(false)
  }

  const confirmImportProject = async () => {
    if (!pendingImport?.config) return
    try {
      const project = await useProjectStore.getState().createProject({
        name: pendingImport.config.projectName || '未命名项目',
        visualStyle: pendingImport.config.visualStyle || '',
        targetMedium: pendingImport.config.targetMedium || '',
        projectPath: pendingImport.targetPath,
        totalEpisodes: pendingImport.config.totalEpisodes || 0,
        config: pendingImport.config
      })
      useProjectStore.getState().setCurrentProject(project)
      setPendingImport(null)
      addToast('success', `项目「${project.name}」导入成功`)
      navigate(`/project/${project.id}/health`)
    } catch (error) {
      addToast('error', getExceptionMessage(error, '项目导入失败'))
    }
  }

  const progress = useMemo(() => getProjectProgress(episodes), [episodes])
  const entryLabel = getProjectEntryLabel(currentProject?.config)

  return {
    currentProject,
    episodes,
    importing,
    showSettings,
    setShowSettings,
    viewMode,
    setViewMode,
    ps,
    setPs,
    projectDraft,
    setProjectDraft,
    psLoaded,
    setPsLoaded,
    psSaving,
    pendingImport,
    productionRows,
    productionLoading: !visibleProduction || visibleProduction.loading,
    productionError: visibleProduction?.error || null,
    productionWarning: visibleProduction?.warning || null,
    plotBreakdownSummary,
    setPendingImport,
    handleRefreshStatus,
    handleSaveSettings,
    handleResetSettings,
    handleImportProject,
    confirmImportProject,
    progress,
    entryLabel,
    visualStyles: VISUAL_STYLES,
    targetMediums: TARGET_MEDIUMS,
    navigate
  }
}
