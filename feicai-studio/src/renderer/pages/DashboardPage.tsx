import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'
import { IPC } from '@shared/ipc-channels'
import { VISUAL_STYLES, TARGET_MEDIUMS } from '@shared/constants'
import {
  BUILTIN_EXPORT_PROFILES,
  BUILTIN_PROJECT_PRESETS,
  BUILTIN_TASK_TEMPLATES,
  buildProjectPresetConfig,
  resolveBuiltinProjectPreset
} from '@shared/template-catalog'
import { NOVEL_GENRES } from '@shared/types'
import type { AppDeliveryStatus, Project, ProjectSourceType } from '@shared/types'
import EmptyState from '@renderer/components/layout/EmptyState'
import { platformAPI } from '@renderer/platform/api'
import './DashboardPage.css'

type WizardStep = 'type' | 'basic' | 'detail'

interface ImportedProjectConfig extends Record<string, unknown> {
  projectName?: string
  sourceType?: ProjectSourceType
  phase?: 'writing' | 'production'
  templateProfileId?: string
  exportProfileId?: string
  visualStyle?: string
  targetMedium?: string
  totalEpisodes?: number
  novelTitle?: string
  novelGenre?: string
}

function getImportErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === 'config not found') {
    return '请确认目录包含 project-config.json'
  }
  return error instanceof Error ? error.message : String(error)
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { projects, loadProjects, setCurrentProject, createProject, deleteProject, loadProject } = useProjectStore()
  const { addToast } = useToastStore()
  const dirSelectTokenRef = useRef(0)
  const webBundleInputRef = useRef<HTMLInputElement | null>(null)

  // 向导状态
  const [showWizard, setShowWizard] = useState(false)
  const [wizardStep, setWizardStep] = useState<WizardStep>('type')
  const [sourceType, setSourceType] = useState<ProjectSourceType>(
    platformAPI.isWebPreview && !platformAPI.capabilities.pipelineRuntime ? 'original' : 'novel'
  )

  // 共有字段
  const [newName, setNewName] = useState('')
  const [newDir, setNewDir] = useState('')

  // 网文改编字段
  const [novelTitle, setNovelTitle] = useState('')
  const [novelGenre, setNovelGenre] = useState('')

  // 原创/导入字段
  const [newStyle, setNewStyle] = useState('')
  const [newMedium, setNewMedium] = useState('')
  const [newEpisodes, setNewEpisodes] = useState(12)
  const [templateProfileId, setTemplateProfileId] = useState('')
  const [exportProfileId, setExportProfileId] = useState('')
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deliveryStatus, setDeliveryStatus] = useState<AppDeliveryStatus | null>(null)
  const [deliveryLoading, setDeliveryLoading] = useState(false)
  const [exportingDeliveryReport, setExportingDeliveryReport] = useState(false)
  const selectedProjectPreset = resolveBuiltinProjectPreset(templateProfileId)
  const isWebPreview = platformAPI.isWebPreview
  const supportsRemoteRuntime = platformAPI.capabilities.pipelineRuntime
  const supportsNovelProjects = !isWebPreview || supportsRemoteRuntime

  const loadProjectConfig = async (projectPath: string) => {
    return platformAPI.invoke(IPC.PROJECT_READ_CONFIG, projectPath) as Promise<ImportedProjectConfig | null>
  }

  useEffect(() => {
    loadProjects()
  }, [])

  useEffect(() => {
    let cancelled = false
    setDeliveryLoading(true)
    platformAPI.invoke(IPC.APP_GET_DELIVERY_STATUS)
      .then((status) => {
        if (!cancelled) {
          setDeliveryStatus(status as AppDeliveryStatus)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          addToast('error', `交付状态加载失败：${getImportErrorMessage(error)}`)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDeliveryLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [addToast, projects.length])

  const resetWizard = () => {
    dirSelectTokenRef.current += 1
    setShowWizard(false)
    setWizardStep('type')
    setSourceType(platformAPI.isWebPreview && !platformAPI.capabilities.pipelineRuntime ? 'original' : 'novel')
    setNewName('')
    setNewDir('')
    setNovelTitle('')
    setNovelGenre('')
    setNewStyle('')
    setNewMedium('')
    setNewEpisodes(12)
    setTemplateProfileId('')
    setExportProfileId('')
  }

  const handleImportProject = async () => {
    if (isWebPreview) {
      webBundleInputRef.current?.click()
      return
    }
    if (importing || creating) return
    setImporting(true)
    try {
      const dirPath = await platformAPI.invoke(IPC.FILE_SELECT_DIR) as string | null
      if (!dirPath) return
      const config = await loadProjectConfig(dirPath)
      if (!config) throw new Error('config not found')
      const project = await createProject({
        name: config.projectName || '未命名项目',
        sourceType: config.sourceType || 'script',
        phase: config.phase || 'production',
        visualStyle: config.visualStyle || '',
        targetMedium: config.targetMedium || '',
        projectPath: dirPath,
        totalEpisodes: config.totalEpisodes || 0,
        novelTitle: config.novelTitle,
        novelGenre: config.novelGenre,
        config
      })
      const loaded = await loadProject(project.id)
      if (!loaded) {
        setCurrentProject(project)
      }
      addToast('success', `项目「${project.name}」导入成功`)
      navigate(`/project/${project.id}/workspace`)
    } catch (e) {
      addToast('error', `项目导入失败：${getImportErrorMessage(e)}`)
    } finally {
      setImporting(false)
    }
  }

  const handleImportWebBundle = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || importing || creating) return
    setImporting(true)
    try {
      const text = await file.text()
      const bundle = JSON.parse(text) as Record<string, unknown>
      const project = await platformAPI.invoke(IPC.PROJECT_IMPORT_BUNDLE, bundle) as Project
      const loaded = await loadProject(project.id)
      if (!loaded) {
        setCurrentProject(project)
      }
      addToast('success', `项目包「${project.name}」导入成功`)
      navigate(`/project/${project.id}/workspace`)
    } catch (error) {
      addToast('error', `项目包导入失败：${getImportErrorMessage(error)}`)
    } finally {
      setImporting(false)
    }
  }

  const handleSelectDir = async () => {
    const requestToken = ++dirSelectTokenRef.current
    try {
      const path = await platformAPI.invoke(IPC.FILE_SELECT_DIR) as string | null
      if (!path) return
      if (dirSelectTokenRef.current !== requestToken) return
      setNewDir(path)
      // 如果目录已有 project-config.json，自动回填
      const config = await loadProjectConfig(path)
      if (dirSelectTokenRef.current !== requestToken) return
      if (!config) throw new Error('config not found')
      if (config.projectName) setNewName(config.projectName)
      if (config.visualStyle) setNewStyle(config.visualStyle)
      if (config.targetMedium) setNewMedium(config.targetMedium)
      if (config.totalEpisodes) setNewEpisodes(config.totalEpisodes)
      if (config.templateProfileId) setTemplateProfileId(config.templateProfileId)
      if (config.exportProfileId) setExportProfileId(config.exportProfileId)
      if (config.novelTitle) setNovelTitle(config.novelTitle)
      if (config.novelGenre) setNovelGenre(config.novelGenre)
      addToast('info', '已检测到项目配置，自动填充')
    } catch (e) {
      if (dirSelectTokenRef.current !== requestToken) return
      if (e instanceof Error && e.message === 'config not found') return
      addToast('error', `目录选择失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleCreateProject = async () => {
    if (!newName || (!isWebPreview && !newDir) || creating || importing) return
    setCreating(true)
    try {
      const isNovel = sourceType === 'novel'
      const phase = isNovel ? 'writing' : 'production'
      const presetConfig = buildProjectPresetConfig(selectedProjectPreset)
      const project = await createProject({
        name: newName,
        sourceType,
        phase,
        visualStyle: newStyle,
        targetMedium: newMedium,
        projectPath: isWebPreview ? '' : newDir,
        totalEpisodes: newEpisodes,
        novelTitle: isNovel ? novelTitle : undefined,
        novelGenre: isNovel ? novelGenre : undefined,
        config: {
          sourceType,
          phase,
          projectName: newName,
          templateProfileId: presetConfig.templateProfileId,
          exportProfileId: exportProfileId || presetConfig.exportProfileId,
          totalEpisodes: newEpisodes,
          visualStyle: newStyle,
          targetMedium: newMedium,
          novelTitle: isNovel ? novelTitle : undefined,
          novelGenre: isNovel ? novelGenre : undefined,
          pipelineSettings: presetConfig.pipelineSettings,
          reviewPolicy: presetConfig.reviewPolicy,
          taskDefaults: presetConfig.taskDefaults,
          createdAt: new Date().toISOString()
        }
      })
      const loaded = await loadProject(project.id)
      if (!loaded) {
        setCurrentProject(project)
      }
      resetWizard()
      addToast('success', `项目「${project.name}」创建成功`)

      if (isNovel) {
        navigate(`/project/${project.id}/workspace`)
      } else {
        navigate(`/project/${project.id}`)
      }
    } catch (e) {
      addToast('error', `项目创建失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setCreating(false)
    }
  }

  const handleOpenProject = async (project: Project) => {
    const loaded = await loadProject(project.id)
    if (!loaded) {
      setCurrentProject(project)
    }
    navigate(`/project/${project.id}/workspace`)
  }

  const handleDeleteProject = async (e: React.MouseEvent, project: Project) => {
    e.stopPropagation()
    if (!confirm(`确定删除项目「${project.name}」？\n此操作将删除数据库中的项目记录（文件系统不受影响）。`)) return
    setDeletingId(project.id)
    try {
      await deleteProject(project.id)
      addToast('success', `项目「${project.name}」已删除`)
    } catch (e) {
      addToast('error', `删除失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setDeletingId(null)
    }
  }

  const handleExportProjectBundle = async (e: React.MouseEvent, project: Project) => {
    e.stopPropagation()
    try {
      const result = await platformAPI.invoke(IPC.EXPORT_ALL, {
        projectPath: project.projectPath,
        projectName: project.name
      }) as { success?: boolean; path?: string; error?: string }
      if (!result.success) {
        throw new Error(result.error || '项目包导出失败')
      }
      addToast('success', `项目包已导出：${result.path || project.name}`)
    } catch (error) {
      addToast('error', `项目包导出失败：${getImportErrorMessage(error)}`)
    }
  }

  const totalEpisodes = projects.reduce((sum, p) => sum + (p.totalEpisodes || 0), 0)
  const deliveryTone = deliveryStatus?.readiness.readyForDelivery
    ? 'ready'
    : (deliveryStatus?.readiness.issueCount || 0) > 0
      ? 'blocked'
      : 'warning'

  const canProceedToDetail = (() => {
    if (!newName.trim()) return false
    if (!isWebPreview && !newDir.trim()) return false
    if (sourceType === 'novel') return !!novelTitle.trim()
    return true
  })()
  const canCreate = canProceedToDetail && newEpisodes > 0

  const SOURCE_TYPES: { type: ProjectSourceType; icon: string; title: string; desc: string }[] = [
    { type: 'novel', icon: '📖', title: '网文改编', desc: '从小说出发，AI 全流程生成剧本和视频提示词' },
    { type: 'original', icon: '✍️', title: '原创剧本', desc: '手写或 AI 辅助创作剧本，再进入制作管线' },
    { type: 'script', icon: '📁', title: '导入已有项目', desc: '导入已有的 FEICAI 项目目录' },
  ]

  const handleExportDeliveryReport = async () => {
    setExportingDeliveryReport(true)
    try {
      const result = await platformAPI.invoke(IPC.APP_EXPORT_DELIVERY_REPORT) as {
        filePath: string
        status: AppDeliveryStatus
      }
      setDeliveryStatus(result.status)
      addToast('success', `交付诊断已导出：${result.filePath}`)
    } catch (error) {
      addToast('error', `交付诊断导出失败：${getImportErrorMessage(error)}`)
    } finally {
      setExportingDeliveryReport(false)
    }
  }

  return (
    <div className="dashboard">
      <div className="page-header-top">
        <div>
          <h1 className="page-title-2xl">
            <span className="title-emoji">🎬</span>
            欢迎使用 FEICAI Studio
          </h1>
          <p className="page-subtitle text-secondary">
            AI 驱动的影视短剧制作工作台
          </p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={handleImportProject} disabled={importing || creating} title={isWebPreview ? '导入浏览器项目包 JSON' : undefined}>
            {importing ? '⏳ 导入中...' : isWebPreview ? '📦 导入项目包' : '📁 导入项目'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowWizard(true)}>
            ✨ 新建项目
          </button>
        </div>
      </div>
      {isWebPreview && (
        <input
          ref={webBundleInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={handleImportWebBundle}
        />
      )}

      {isWebPreview && (
        <section className="card" style={{ marginBottom: 16, borderColor: 'var(--color-warning)' }}>
          <h2 style={{ marginTop: 0 }}>网页预览能力</h2>
          <p className="text-secondary" style={{ marginBottom: 8 }}>
            {supportsRemoteRuntime
              ? '当前浏览器模式已连接远程后端。现在可以直接新建网文改编项目、导入章节、运行制作流水线、查看任务中心和导出基础诊断。'
              : '当前浏览器模式已经支持应用壳、浏览器内项目、剧本保存、LLM 设置本地保存、交付状态预览和基础导出。'}
          </p>
          <p className="text-secondary" style={{ marginBottom: 0 }}>
            {supportsRemoteRuntime
              ? '当前仍不支持直接访问本地项目目录；如需导入现有桌面项目，请使用项目包 JSON。'
              : '本地目录选择、小说导入、后台流水线和真实服务端任务仍需要桌面端或后续 web 后端。'}
          </p>
        </section>
      )}

      <section className={`delivery-status-card card is-${deliveryTone}`}>
        <div className="delivery-status-header">
          <div>
            <h2>交付就绪面板</h2>
            <p className="text-secondary">
              {deliveryLoading
                ? '正在汇总当前应用的交付状态、运行健康度和诊断路径。'
                : deliveryStatus
                  ? `版本 v${deliveryStatus.version} · ${deliveryStatus.packaged ? '正式包' : '开发环境'} · ${deliveryStatus.platform}/${deliveryStatus.arch}`
                  : '当前还没有可用的交付状态数据。'}
            </p>
          </div>
          <div className="delivery-status-actions">
            <button className="btn" onClick={() => navigate('/settings')}>
              打开设置
            </button>
            <button className="btn" onClick={() => navigate('/tasks')}>
              打开任务中心
            </button>
            <button className="btn btn-primary" onClick={() => void handleExportDeliveryReport()} disabled={exportingDeliveryReport}>
              {exportingDeliveryReport ? '导出中...' : '导出交付诊断'}
            </button>
          </div>
        </div>

        {deliveryStatus && (
          <>
            <div className="delivery-status-grid">
              <div className="delivery-metric">
                <span>交付评分</span>
                <strong>{deliveryStatus.readiness.score}</strong>
              </div>
              <div className="delivery-metric">
                <span>LLM 配置</span>
                <strong>{deliveryStatus.readiness.llmConfigCount}</strong>
              </div>
              <div className="delivery-metric">
                <span>项目数</span>
                <strong>{deliveryStatus.readiness.projectCount}</strong>
              </div>
              <div className="delivery-metric">
                <span>队列任务</span>
                <strong>{deliveryStatus.runtime.queuedRunCount}</strong>
              </div>
              <div className="delivery-metric">
                <span>死信任务</span>
                <strong>{deliveryStatus.runtime.deadLetterCount}</strong>
              </div>
              <div className="delivery-metric">
                <span>LLM 调用总数</span>
                <strong>{deliveryStatus.runtime.telemetryCallCount}</strong>
              </div>
            </div>

            <div className="delivery-status-paths text-secondary">
              <span>UserData：{deliveryStatus.paths.userData}</span>
              <span>数据库：{deliveryStatus.paths.database}</span>
              <span>运行日志：{deliveryStatus.paths.runtimeLog}</span>
              <span>诊断导出：{deliveryStatus.paths.reportsDir}</span>
            </div>

            <div className="delivery-status-issues">
              {deliveryStatus.issues.length === 0 ? (
                <div className="delivery-issue is-success">当前没有阻断交付的问题，可以继续联调、验收和正式出包。</div>
              ) : (
                deliveryStatus.issues.map((issue) => (
                  <div key={issue.code} className={`delivery-issue is-${issue.severity}`}>
                    <strong>{issue.severity === 'error' ? '阻断' : issue.severity === 'warning' ? '提醒' : '信息'}</strong>
                    <span>{issue.message}</span>
                  </div>
                ))
              )}
            </div>

            {deliveryStatus.recentErrors.length > 0 && (
              <div className="delivery-status-errors">
                <h3>最近错误</h3>
                {deliveryStatus.recentErrors.slice(0, 3).map((entry) => (
                  <div key={`${entry.timestamp}-${entry.message}`} className="delivery-error-entry">
                    <span>{new Date(entry.timestamp).toLocaleString('zh-CN')}</span>
                    <strong>{entry.scope === 'startup' ? '启动期' : '运行期'}</strong>
                    <span>{entry.message}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* ==================== 新建项目向导 ==================== */}
      {showWizard && (
        <div className="card wizard-dialog">
          {/* 步骤条 */}
          <div className="wizard-steps">
            <div className={`wizard-step ${wizardStep === 'type' ? 'active' : 'done'}`}>
              <span className="step-num">1</span>
              <span className="step-label">选择类型</span>
            </div>
            <div className="wizard-step-line" />
            <div className={`wizard-step ${wizardStep === 'basic' ? 'active' : wizardStep === 'detail' ? 'done' : ''}`}>
              <span className="step-num">2</span>
              <span className="step-label">基础信息</span>
            </div>
            <div className="wizard-step-line" />
            <div className={`wizard-step ${wizardStep === 'detail' ? 'active' : ''}`}>
              <span className="step-num">3</span>
              <span className="step-label">详细配置</span>
            </div>
          </div>

          {/* Step 1: 选择项目类型 */}
          {wizardStep === 'type' && (
            <div className="wizard-content">
              <h3>✨ 选择项目类型</h3>
              <div className="source-type-grid">
                {SOURCE_TYPES.map(st => (
                  <div
                    key={st.type}
                    className={`source-type-card ${sourceType === st.type ? 'selected' : ''} ${
                      isWebPreview && ((st.type === 'novel' && !supportsNovelProjects) || st.type === 'script') ? 'disabled' : ''
                    }`}
                    onClick={() => {
                      if (isWebPreview && ((st.type === 'novel' && !supportsNovelProjects) || st.type === 'script')) return
                      setSourceType(st.type)
                    }}
                  >
                    <span className="stc-icon">{st.icon}</span>
                    <span className="stc-title">{st.title}</span>
                    <span className="stc-desc text-secondary">
                      {isWebPreview && st.type === 'script'
                        ? '网页端请导入项目包 JSON，而不是本地目录'
                        : isWebPreview && st.type === 'novel' && !supportsNovelProjects
                          ? '当前 transport 尚未连接远程运行时'
                          : st.desc}
                    </span>
                  </div>
                ))}
              </div>
              <div className="wizard-actions">
                <button className="btn" onClick={resetWizard}>取消</button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    if (sourceType === 'script') {
                      // 导入已有项目 — 直接走导入流程
                      resetWizard()
                      handleImportProject()
                    } else {
                      setWizardStep('basic')
                    }
                  }}
                >
                  下一步 →
                </button>
              </div>
            </div>
          )}

          {/* Step 2: 项目信息 */}
          {wizardStep === 'basic' && (
            <div className="wizard-content">
              <h3>{sourceType === 'novel' ? '📖 网文改编' : '✍️ 原创剧本'} — 项目信息</h3>
              <div className="form-grid">
                <div className="form-group">
                  <label>项目名称 <span style={{ color: 'var(--color-error)' }}>*</span></label>
                  <input
                    className="input"
                    placeholder="输入项目名称"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>项目目录 <span style={{ color: 'var(--color-error)' }}>*</span></label>
                  <div className="dir-select">
                    <input
                      className="input"
                      placeholder={isWebPreview ? (supportsRemoteRuntime ? '远程后端将自动分配项目空间' : '浏览器内虚拟项目，无需目录') : '选择项目目录'}
                      value={isWebPreview ? (supportsRemoteRuntime ? 'remote://workspace(auto)' : 'browser://workspace') : newDir}
                      readOnly={isWebPreview}
                      onChange={(e) => setNewDir(e.target.value)}
                    />
                    {!isWebPreview && <button className="btn btn-sm" onClick={handleSelectDir} disabled={creating || importing}>📂 选择</button>}
                  </div>
                </div>
                {sourceType === 'novel' && (
                  <>
                    <div className="form-group">
                      <label>小说标题 <span style={{ color: 'var(--color-error)' }}>*</span></label>
                      <input
                        className="input"
                        placeholder="输入小说标题"
                        value={novelTitle}
                        onChange={(e) => setNovelTitle(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>小说类型</label>
                      <input
                        className="input"
                        list="genre-options"
                        placeholder="选择或输入类型"
                        value={novelGenre}
                        onChange={(e) => setNovelGenre(e.target.value)}
                      />
                      <datalist id="genre-options">
                        {NOVEL_GENRES.map(g => <option key={g} value={g} />)}
                      </datalist>
                    </div>
                  </>
                )}
              </div>
              <div className="wizard-actions">
                <button className="btn" onClick={() => setWizardStep('type')}>← 上一步</button>
                <button
                  className="btn btn-primary"
                  onClick={() => setWizardStep('detail')}
                  disabled={!canProceedToDetail}
                >
                  下一步 →
                </button>
              </div>
            </div>
          )}

          {/* Step 3: 制作配置（所有类型统一） */}
          {wizardStep === 'detail' && (
            <div className="wizard-content">
              <h3>⚙️ 制作配置</h3>
              <p className="text-secondary" style={{ marginBottom: 'var(--spacing-md)', fontSize: 'var(--font-size-sm)' }}>
                以下参数将影响整个制作管线的视觉输出与集数规划
              </p>
              <div className="form-grid">
                <div className="form-group">
                  <label>项目预设</label>
                  <select
                    className="input"
                    value={templateProfileId}
                    onChange={(event) => {
                      const nextId = event.target.value
                      const preset = resolveBuiltinProjectPreset(nextId)
                      setTemplateProfileId(nextId)
                      if (preset?.defaultExportProfileId) {
                        setExportProfileId(preset.defaultExportProfileId)
                      }
                    }}
                  >
                    <option value="">不使用预设</option>
                    {BUILTIN_PROJECT_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>{preset.label}</option>
                    ))}
                  </select>
                  {selectedProjectPreset && (
                    <div className="wizard-preset-hint text-secondary">
                      <span>{selectedProjectPreset.description}</span>
                      {(selectedProjectPreset.recommendedTemplateIds || []).length > 0 && (
                        <span>
                          推荐模板：
                          {selectedProjectPreset.recommendedTemplateIds
                            ?.map((templateId) => BUILTIN_TASK_TEMPLATES.find((item) => item.id === templateId)?.label)
                            .filter(Boolean)
                            .join(' / ')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label>默认导出模板</label>
                  <select
                    className="input"
                    value={exportProfileId}
                    onChange={(event) => setExportProfileId(event.target.value)}
                  >
                    <option value="">无默认模板</option>
                    {BUILTIN_EXPORT_PROFILES.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.label}</option>
                    ))}
                  </select>
                  <div className="wizard-preset-hint text-secondary">
                    {BUILTIN_EXPORT_PROFILES.find((profile) => profile.id === exportProfileId)?.description || '创建后导出弹窗会默认选中这里的模板。'}
                  </div>
                </div>
                <div className="form-group">
                  <label>视觉风格</label>
                  <input
                    className="input"
                    list="style-options"
                    placeholder="选择或输入自定义风格"
                    value={newStyle}
                    onChange={(e) => setNewStyle(e.target.value)}
                  />
                  <datalist id="style-options">
                    {VISUAL_STYLES.map(s => <option key={s} value={s} />)}
                  </datalist>
                </div>
                <div className="form-group">
                  <label>目标媒介</label>
                  <input
                    className="input"
                    list="medium-options"
                    placeholder="选择或输入自定义媒介"
                    value={newMedium}
                    onChange={(e) => setNewMedium(e.target.value)}
                  />
                  <datalist id="medium-options">
                    {TARGET_MEDIUMS.map(m => <option key={m} value={m} />)}
                  </datalist>
                </div>
                <div className="form-group">
                  <label>总集数 <span style={{ color: 'var(--color-error)' }}>*</span></label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={999}
                    placeholder="规划总集数（必填）"
                    value={newEpisodes || ''}
                    onChange={(e) => setNewEpisodes(parseInt(e.target.value) || 0)}
                  />
                  <span className="text-secondary" style={{ fontSize: 'var(--font-size-xs)', marginTop: '4px' }}>
                    {sourceType === 'novel'
                      ? '网文改编建议先设定一个预估值，后续可在改编规划中精调'
                      : '设定项目的总集数，建库后将自动生成对应的集数记录'}
                  </span>
                </div>
              </div>
              <div className="wizard-actions">
                <button className="btn" onClick={() => setWizardStep('basic')}>← 上一步</button>
                <button
                  className="btn btn-primary"
                  onClick={handleCreateProject}
                  disabled={!canCreate || creating || importing}
                >
                  {creating ? '⏳ 创建中...' : '🚀 创建项目'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== 项目列表 ==================== */}
      {projects.length === 0 ? (
        <EmptyState
          icon="📋"
          title={isWebPreview ? '网页预览模式下暂无项目' : '还没有项目'}
          description={isWebPreview
            ? supportsRemoteRuntime
              ? '当前浏览器已连接远程运行时。你可以直接新建原创或网文改编项目，也可以导入项目包 JSON。'
              : '浏览器里还不能直接访问本地项目目录。你可以先去设置页配置 LLM，或继续在桌面端进行项目导入和创作。'
            : '点击「新建项目」创建一个新的短剧制作项目，或「导入项目」导入已有的 FEICAI 项目目录'}
          action={isWebPreview ? {
            label: '打开设置',
            onClick: () => navigate('/settings')
          } : undefined}
        />
      ) : (
        <div className="project-grid">
          {projects.map((project) => {
            const sourceLabel = project.sourceType === 'novel'
              ? '📖 网文改编'
              : project.sourceType === 'original'
                ? '✍️ 原创剧本'
                : '📁 导入项目'
            const phaseLabel = project.phase === 'writing' ? '编剧中' : '制作中'
            return (
              <div
                key={project.id}
                className="card project-card"
                onClick={() => void handleOpenProject(project)}
              >
                <div className="project-card-header">
                  <span className="project-icon">🎬</span>
                  <h3>{project.name}</h3>
                  {isWebPreview && (
                    <button
                      className="btn btn-sm project-delete-btn"
                      onClick={(e) => void handleExportProjectBundle(e, project)}
                      title="导出项目包"
                    >
                      📦
                    </button>
                  )}
                  <button
                    className="btn btn-sm project-delete-btn"
                    onClick={(e) => handleDeleteProject(e, project)}
                    title="删除项目"
                    disabled={deletingId === project.id}
                  >
                    {deletingId === project.id ? '…' : '🗑️'}
                  </button>
                </div>
                <div className="project-card-meta text-secondary">
                  <span className="project-source-tag">{sourceLabel}</span>
                  <span className="project-phase-tag">{phaseLabel}</span>
                </div>
                <div className="project-card-info text-secondary">
                  {project.totalEpisodes > 0 && `${project.totalEpisodes} 集`}
                  {project.visualStyle && ` · ${project.visualStyle}`}
                  {project.novelTitle && ` · ${project.novelTitle}`}
                </div>
                <div className="project-card-footer text-secondary">
                  {project.projectPath}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 统计 */}
      <div className="dashboard-stats">
        <div className="card stat-card">
          <div className="stat-icon">📝</div>
          <div className="stat-info">
            <div className="stat-value">{projects.length}</div>
            <div className="stat-label text-secondary">项目</div>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-icon">🎬</div>
          <div className="stat-info">
            <div className="stat-value">{totalEpisodes}</div>
            <div className="stat-label text-secondary">总集数</div>
          </div>
        </div>
      </div>
    </div>
  )
}
