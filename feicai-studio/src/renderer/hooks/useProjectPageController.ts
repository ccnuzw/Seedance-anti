import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  readTextFile,
  selectDirectory,
  writeTextFile
} from '@renderer/services/file-io'
import {
  detectProjectDirectory,
  getPlotBreakdownSummary
} from '@renderer/services/project-service'
import { getExceptionMessage } from '@renderer/services/service-contracts'
import {
  invalidateCachedTextFile,
  readCachedTextFile
} from '@renderer/services/file-cache'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'
import type { PipelineSettings, ProjectConfig } from '@shared/types'
import type { PlotBreakdownSummary } from '@shared/ipc-contracts'
import { DEFAULT_PIPELINE_SETTINGS } from '@shared/types'
import { VISUAL_STYLES, TARGET_MEDIUMS } from '@shared/constants'
import type { DetectedProjectInfo } from '@shared/project-detection'
import {
  mergeProjectConfig,
  normalizeProjectConfig
} from '@shared/project-config'
import { resolveProjectArtifactPath } from '@shared/path-resolver'
import { updatePlotBreakdownPlanning } from '@shared/plot-breakdown'
import { useShallow } from 'zustand/react/shallow'
import {
  getProjectEntryLabel,
  getProjectProgress
} from '@renderer/components/project/project-page-view'

export function useProjectPageController() {
  const navigate = useNavigate()
  const { currentProject, episodes, refreshProject, syncEpisodeStatus } =
    useProjectStore(
      useShallow((s) => ({
        currentProject: s.currentProject,
        episodes: s.episodes,
        refreshProject: s.refreshProject,
        syncEpisodeStatus: s.syncEpisodeStatus
      }))
    )
  const { addToast } = useToastStore()
  const [importing, setImporting] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card')
  const [ps, setPs] = useState<PipelineSettings>({
    ...DEFAULT_PIPELINE_SETTINGS
  })
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
  const [plotBreakdownSummary, setPlotBreakdownSummary] =
    useState<PlotBreakdownSummary | null>(null)

  useEffect(() => {
    if (!currentProject) return
    if (episodes.length > 0) return
    void refreshProject()
  }, [currentProject?.id, episodes.length, refreshProject])

  const handleRefreshStatus = async () => {
    if (!currentProject) return
    await syncEpisodeStatus()
    setPlotBreakdownSummary(await getPlotBreakdownSummary(currentProject.id))
    addToast('success', '项目状态已刷新')
  }

  useEffect(() => {
    if (!currentProject) {
      setPlotBreakdownSummary(null)
      return
    }
    void getPlotBreakdownSummary(currentProject.id)
      .then(setPlotBreakdownSummary)
      .catch(() => setPlotBreakdownSummary(null))
  }, [currentProject?.id])

  useEffect(() => {
    if (!showSettings || !currentProject || psLoaded) return
    ;(async () => {
      const configPath = resolveProjectArtifactPath(
        currentProject.projectPath,
        'projectConfig',
        currentProject.config
      )
      try {
        const raw = await readCachedTextFile(configPath)
        if (!raw) {
          throw new Error('missing project config')
        }
        const config = JSON.parse(raw)
        setPs({
          ...DEFAULT_PIPELINE_SETTINGS,
          ...(config.pipelineSettings || {})
        })
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
      } catch {
        setPs({ ...DEFAULT_PIPELINE_SETTINGS })
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
    setPsSaving(true)
    try {
      let config: Record<string, unknown> = {}
      const configPath = resolveProjectArtifactPath(
        currentProject.projectPath,
        'projectConfig',
        currentProject.config
      )
      try {
        const raw = await readCachedTextFile(configPath)
        if (!raw) {
          throw new Error('missing project config')
        }
        config = JSON.parse(raw)
      } catch {
        // 文件不存在时创建新的配置
      }

      config.pipelineSettings = ps
      config.projectName = projectDraft.name.trim() || currentProject.name
      config.visualStyle = projectDraft.visualStyle.trim()
      config.targetMedium = projectDraft.targetMedium.trim()
      config.totalEpisodes = Math.max(0, Number(projectDraft.totalEpisodes) || 0)
      config.chaptersPerEpisode = Math.max(
        0,
        Number(projectDraft.chaptersPerEpisode) || 0
      )
      invalidateCachedTextFile(configPath)
      await writeTextFile(configPath, JSON.stringify(config, null, 2))
      invalidateCachedTextFile(configPath)
      await syncPlotBreakdownPlanningIfPresent(
        currentProject.projectPath,
        {
          ...currentProject.config,
          ...config,
          chaptersPerEpisode: config.chaptersPerEpisode as number
        },
        {
          projectName: config.projectName as string,
          projectType: config.targetMedium as string,
          totalEpisodes: config.totalEpisodes as number,
          chaptersPerEpisode: config.chaptersPerEpisode as number
        }
      )
      await useProjectStore.getState().updateProject(currentProject.id, {
        name: config.projectName as string,
        visualStyle: config.visualStyle as string,
        targetMedium: config.targetMedium as string,
        totalEpisodes: config.totalEpisodes as number,
        config: {
          ...currentProject.config,
          ...config,
          chaptersPerEpisode: config.chaptersPerEpisode as number,
          pipelineSettings: ps
        }
      })
      setPlotBreakdownSummary(await getPlotBreakdownSummary(currentProject.id))
      addToast('success', '项目设置已保存')
    } catch (error) {
      addToast('error', getExceptionMessage(error, '保存失败'))
    }
    setPsSaving(false)
  }

  const handleResetSettings = () => {
    setPs({ ...DEFAULT_PIPELINE_SETTINGS })
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

async function syncPlotBreakdownPlanningIfPresent(
  projectPath: string,
  config: Partial<ProjectConfig>,
  planning: {
    projectName: string
    projectType: string
    totalEpisodes: number
    chaptersPerEpisode: number
  }
): Promise<void> {
  const plotBreakdownPath = resolveProjectArtifactPath(
    projectPath,
    'plotBreakdown',
    config
  )
  const raw = await readCachedTextFile(plotBreakdownPath)
  if (!raw) return
  const next = updatePlotBreakdownPlanning(raw, planning)
  if (next === raw) return
  await writeTextFile(plotBreakdownPath, next)
  invalidateCachedTextFile(plotBreakdownPath)
}
