import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  readTextFile,
  selectDirectory,
  selectFile
} from '@renderer/services/file-io'
import { detectProjectDirectory } from '@renderer/services/project-service'
import { getExceptionMessage } from '@renderer/services/service-contracts'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'
import { VISUAL_STYLES, TARGET_MEDIUMS } from '@shared/constants'
import {
  mergeProjectConfig,
  normalizeProjectConfig
} from '@shared/project-config'
import { resolveProjectArtifactPath } from '@shared/path-resolver'
import type {
  Project,
  ProjectConfig,
  ProjectEntryStage,
  ProjectWorkflowMode
} from '@shared/types'
import type { DetectedProjectInfo } from '@shared/project-detection'
import {
  ENTRY_OPTIONS,
  getDashboardStats,
  getEntryOption,
  type WizardStep
} from '@renderer/components/dashboard/dashboard-page-view'
import { useShallow } from 'zustand/react/shallow'

export function useDashboardPageController() {
  const navigate = useNavigate()
  const {
    projects,
    loadProjects,
    setCurrentProject,
    createProject,
    deleteProject
  } = useProjectStore(
    useShallow((s) => ({
      projects: s.projects,
      loadProjects: s.loadProjects,
      setCurrentProject: s.setCurrentProject,
      createProject: s.createProject,
      deleteProject: s.deleteProject
    }))
  )
  const { addToast } = useToastStore()

  const [showNewDialog, setShowNewDialog] = useState(false)
  const [wizardStep, setWizardStep] = useState<WizardStep>(1)
  const [newName, setNewName] = useState('')
  const [newDir, setNewDir] = useState('')
  const [newStyle, setNewStyle] = useState('')
  const [newMedium, setNewMedium] = useState('')
  const [newEpisodes, setNewEpisodes] = useState(12)
  const [sourceNovelFilePath, setSourceNovelFilePath] = useState('')
  const [entryStage, setEntryStage] = useState<ProjectEntryStage>('novel')
  const [workflowMode, setWorkflowMode] = useState<ProjectWorkflowMode>(
    'novel_to_shortdrama'
  )
  const [pendingImport, setPendingImport] = useState<{
    targetPath: string
    config: Partial<ProjectConfig> | null
    detected: DetectedProjectInfo
  } | null>(null)

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  const selectedOption = useMemo(() => getEntryOption(entryStage), [entryStage])
  const stats = useMemo(() => getDashboardStats(projects), [projects])

  const resetWizard = () => {
    setShowNewDialog(false)
    setWizardStep(1)
    setNewName('')
    setNewDir('')
    setNewStyle('')
    setNewMedium('')
    setNewEpisodes(12)
    setSourceNovelFilePath('')
    setEntryStage('novel')
    setWorkflowMode('novel_to_shortdrama')
  }

  const openNewProjectWizard = () => {
    resetWizard()
    setShowNewDialog(true)
  }

  const handleImportProject = async () => {
    const dirPath = await selectDirectory()
    if (typeof dirPath !== 'string' || dirPath.length === 0) return

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

  const confirmImportProject = async () => {
    if (!pendingImport?.config) return
    try {
      const project = await createProject({
        name: pendingImport.config.projectName || '未命名项目',
        visualStyle: pendingImport.config.visualStyle || '',
        targetMedium: pendingImport.config.targetMedium || '',
        projectPath: pendingImport.targetPath,
        totalEpisodes: pendingImport.config.totalEpisodes || 0,
        config: pendingImport.config
      })
      setCurrentProject(project)
      setPendingImport(null)
      addToast('success', `项目「${project.name}」导入成功`)
      navigate(`/project/${project.id}/health`)
    } catch (error) {
      addToast('error', getExceptionMessage(error, '项目导入失败'))
    }
  }

  const handleCreateProject = async () => {
    if (!newName || !newDir) return
    try {
      const config = normalizeProjectConfig({
        projectName: newName,
        totalEpisodes: newEpisodes,
        visualStyle: newStyle,
        targetMedium: newMedium,
        entryStage,
        workflowMode
      })
      const project = await createProject({
        name: newName,
        visualStyle: newStyle,
        targetMedium: newMedium,
        projectPath: newDir,
        totalEpisodes: newEpisodes,
        config,
        sourceNovelFilePath:
          entryStage === 'novel' && sourceNovelFilePath
            ? sourceNovelFilePath
            : undefined
      })
      setCurrentProject(project)
      resetWizard()
      addToast('success', `项目「${project.name}」创建成功`)
      navigate(`/project/${project.id}/health`)
    } catch (error) {
      addToast('error', getExceptionMessage(error, '项目创建失败'))
    }
  }

  const handleSelectDir = async () => {
    const path = await selectDirectory()
    if (typeof path !== 'string' || path.length === 0) return
    const detected = await detectProjectDirectory(path)
    const targetPath = detected.resolvedPath || path
    setNewDir(targetPath)
    if (targetPath !== path) {
      addToast('info', `已自动定位到项目目录：${targetPath}`)
    }
    try {
      const configRaw = await readTextFile(
        resolveProjectArtifactPath(targetPath, 'projectConfig')
      )
      if (!configRaw) {
        throw new Error('missing project config')
      }
      const config = normalizeProjectConfig(
        JSON.parse(configRaw) as Partial<ProjectConfig>
      )
      if (config.projectName) setNewName(config.projectName)
      if (config.visualStyle) setNewStyle(config.visualStyle)
      if (config.targetMedium) setNewMedium(config.targetMedium)
      if (config.totalEpisodes) setNewEpisodes(config.totalEpisodes)
      if (config.entryStage) setEntryStage(config.entryStage)
      if (config.workflowMode) setWorkflowMode(config.workflowMode)
      addToast('info', '已检测到项目配置，自动填充')
    } catch {
      // 无配置文件时保持手动输入
    }
  }

  const handleSelectSourceNovelFile = async () => {
    const filePath = await selectFile([
      { name: '小说文本', extensions: ['txt', 'md', 'markdown'] },
      { name: '所有文件', extensions: ['*'] }
    ])
    if (!filePath) return
    setSourceNovelFilePath(filePath)
    if (!newName) {
      const filename = filePath
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.(txt|md|markdown)$/i, '')
      if (filename) setNewName(filename)
    }
    addToast('info', '已选择整本小说，创建时会自动拆分章节')
  }

  const handleChooseEntry = (entryOption: (typeof ENTRY_OPTIONS)[number]) => {
    setEntryStage(entryOption.entryStage)
    setWorkflowMode(entryOption.workflowMode)
    setWizardStep(2)
  }

  const handleOpenProject = (project: Project) => {
    setCurrentProject(project)
    navigate(`/project/${project.id}`)
  }

  const handleDeleteProject = async (e: MouseEvent, project: Project) => {
    e.stopPropagation()
    if (
      !confirm(
        `确定删除项目「${project.name}」？\n此操作将删除数据库中的项目记录（文件系统不受影响）。`
      )
    )
      return
    try {
      await deleteProject(project.id)
      addToast('success', `项目「${project.name}」已删除`)
    } catch (error) {
      addToast('error', getExceptionMessage(error, '删除失败'))
    }
  }

  return {
    projects,
    stats,
    navigate,
    showNewDialog,
    setShowNewDialog,
    wizardStep,
    setWizardStep,
    newName,
    setNewName,
    newDir,
    setNewDir,
    newStyle,
    setNewStyle,
    newMedium,
    setNewMedium,
    newEpisodes,
    setNewEpisodes,
    sourceNovelFilePath,
    setSourceNovelFilePath,
    entryStage,
    setEntryStage,
    workflowMode,
    selectedOption,
    pendingImport,
    setPendingImport,
    resetWizard,
    openNewProjectWizard,
    handleImportProject,
    confirmImportProject,
    handleCreateProject,
    handleSelectDir,
    handleSelectSourceNovelFile,
    handleChooseEntry,
    handleOpenProject,
    handleDeleteProject,
    visualStyles: VISUAL_STYLES,
    targetMediums: TARGET_MEDIUMS,
    entryOptions: ENTRY_OPTIONS
  }
}
