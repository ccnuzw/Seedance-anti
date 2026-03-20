import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'
import { IPC } from '@shared/ipc-channels'
import { VISUAL_STYLES, TARGET_MEDIUMS } from '@shared/constants'
import { NOVEL_GENRES } from '@shared/types'
import type { Project, ProjectSourceType } from '@shared/types'
import EmptyState from '@renderer/components/layout/EmptyState'
import './DashboardPage.css'

type WizardStep = 'type' | 'basic' | 'detail'

export default function DashboardPage() {
  const navigate = useNavigate()
  const { projects, loadProjects, setCurrentProject, createProject, deleteProject } = useProjectStore()
  const { addToast } = useToastStore()

  // 向导状态
  const [showWizard, setShowWizard] = useState(false)
  const [wizardStep, setWizardStep] = useState<WizardStep>('type')
  const [sourceType, setSourceType] = useState<ProjectSourceType>('novel')

  // 共有字段
  const [newName, setNewName] = useState('')
  const [newDir, setNewDir] = useState('')

  // 网文改编字段
  const [novelTitle, setNovelTitle] = useState('')
  const [novelGenre, setNovelGenre] = useState('')

  // 原创/导入字段
  const [newStyle, setNewStyle] = useState('')
  const [newMedium, setNewMedium] = useState('')
  const [newEpisodes, setNewEpisodes] = useState(0)

  useEffect(() => {
    loadProjects()
  }, [])

  const resetWizard = () => {
    setShowWizard(false)
    setWizardStep('type')
    setSourceType('novel')
    setNewName('')
    setNewDir('')
    setNovelTitle('')
    setNovelGenre('')
    setNewStyle('')
    setNewMedium('')
    setNewEpisodes(0)
  }

  const handleImportProject = async () => {
    const dirPath = await window.feicaiAPI.invoke(IPC.FILE_SELECT_DIR) as string | null
    if (!dirPath) return

    try {
      const configRaw = await window.feicaiAPI.invoke(IPC.FILE_READ, `${dirPath}/project-config.json`) as string | null
      if (!configRaw) throw new Error('config not found')
      const config = JSON.parse(configRaw)
      const project = await createProject({
        name: config.projectName || '未命名项目',
        sourceType: 'script',
        phase: 'production',
        visualStyle: config.visualStyle || '',
        targetMedium: config.targetMedium || '',
        projectPath: dirPath,
        totalEpisodes: config.totalEpisodes || 0,
        config
      })
      setCurrentProject(project)
      addToast('success', `项目「${project.name}」导入成功`)
      navigate(`/project/${project.id}`)
    } catch {
      addToast('error', '项目导入失败：请确认目录包含 project-config.json')
    }
  }

  const handleSelectDir = async () => {
    const path = await window.feicaiAPI.invoke(IPC.FILE_SELECT_DIR) as string | null
    if (!path) return
    setNewDir(path)
    // 如果目录已有 project-config.json，自动回填
    try {
      const configRaw = await window.feicaiAPI.invoke(IPC.FILE_READ, `${path}/project-config.json`) as string | null
      if (!configRaw) throw new Error('config not found')
      const config = JSON.parse(configRaw)
      if (config.projectName) setNewName(config.projectName)
      if (config.visualStyle) setNewStyle(config.visualStyle)
      if (config.targetMedium) setNewMedium(config.targetMedium)
      if (config.totalEpisodes) setNewEpisodes(config.totalEpisodes)
      addToast('info', '已检测到项目配置，自动填充')
    } catch { /* 无 config 文件，正常 */ }
  }

  const handleCreateProject = async () => {
    if (!newName || !newDir) return
    try {
      const isNovel = sourceType === 'novel'
      const project = await createProject({
        name: newName,
        sourceType,
        phase: isNovel ? 'writing' : 'production',
        visualStyle: newStyle,
        targetMedium: newMedium,
        projectPath: newDir,
        totalEpisodes: isNovel ? 0 : newEpisodes,
        novelTitle: isNovel ? novelTitle : undefined,
        novelGenre: isNovel ? novelGenre : undefined,
        config: {}
      })
      setCurrentProject(project)
      resetWizard()
      addToast('success', `项目「${project.name}」创建成功`)

      if (isNovel) {
        navigate(`/project/${project.id}/novel`)
      } else {
        navigate(`/project/${project.id}`)
      }
    } catch {
      addToast('error', '项目创建失败')
    }
  }

  const handleOpenProject = (project: Project) => {
    setCurrentProject(project)
    navigate(`/project/${project.id}`)
  }

  const handleDeleteProject = async (e: React.MouseEvent, project: Project) => {
    e.stopPropagation()
    if (!confirm(`确定删除项目「${project.name}」？\n此操作将删除数据库中的项目记录（文件系统不受影响）。`)) return
    try {
      await deleteProject(project.id)
      addToast('success', `项目「${project.name}」已删除`)
    } catch {
      addToast('error', '删除失败')
    }
  }

  const totalEpisodes = projects.reduce((sum, p) => sum + (p.totalEpisodes || 0), 0)

  const canProceedToDetail = newName.trim() && newDir.trim()
  const canCreate = (() => {
    if (!canProceedToDetail) return false
    if (sourceType === 'novel') return !!novelTitle.trim()
    return true
  })()

  const SOURCE_TYPES: { type: ProjectSourceType; icon: string; title: string; desc: string }[] = [
    { type: 'novel', icon: '📖', title: '网文改编', desc: '从小说出发，AI 全流程生成剧本和视频提示词' },
    { type: 'original', icon: '✍️', title: '原创剧本', desc: '手写或 AI 辅助创作剧本，再进入制作管线' },
    { type: 'script', icon: '📁', title: '导入已有项目', desc: '导入已有的 FEICAI 项目目录' },
  ]

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
          <button className="btn" onClick={handleImportProject}>
            📁 导入项目
          </button>
          <button className="btn btn-primary" onClick={() => setShowWizard(true)}>
            ✨ 新建项目
          </button>
        </div>
      </div>

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
                    className={`source-type-card ${sourceType === st.type ? 'selected' : ''}`}
                    onClick={() => setSourceType(st.type)}
                  >
                    <span className="stc-icon">{st.icon}</span>
                    <span className="stc-title">{st.title}</span>
                    <span className="stc-desc text-secondary">{st.desc}</span>
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

          {/* Step 2: 基础信息 */}
          {wizardStep === 'basic' && (
            <div className="wizard-content">
              <h3>{sourceType === 'novel' ? '📖 网文改编' : '✍️ 原创剧本'} — 基础信息</h3>
              <div className="form-grid">
                <div className="form-group">
                  <label>项目名称</label>
                  <input
                    className="input"
                    placeholder="输入项目名称"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>项目目录</label>
                  <div className="dir-select">
                    <input
                      className="input"
                      placeholder="选择项目目录"
                      value={newDir}
                      readOnly
                    />
                    <button className="btn btn-sm" onClick={handleSelectDir}>📂 选择</button>
                  </div>
                </div>
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

          {/* Step 3: 详细配置 */}
          {wizardStep === 'detail' && (
            <div className="wizard-content">
              <h3>{sourceType === 'novel' ? '📖 小说信息' : '✍️ 制作配置'}</h3>
              <div className="form-grid">
                {sourceType === 'novel' ? (
                  <>
                    <div className="form-group">
                      <label>小说标题</label>
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
                ) : (
                  <>
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
                      <label>总集数</label>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        placeholder="0 表示自动检测"
                        value={newEpisodes || ''}
                        onChange={(e) => setNewEpisodes(parseInt(e.target.value) || 0)}
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="wizard-actions">
                <button className="btn" onClick={() => setWizardStep('basic')}>← 上一步</button>
                <button
                  className="btn btn-primary"
                  onClick={handleCreateProject}
                  disabled={!canCreate}
                >
                  🚀 创建项目
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
          title="还没有项目"
          description='点击「新建项目」创建一个新的短剧制作项目，或「导入项目」导入已有的 FEICAI 项目目录'
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
                onClick={() => handleOpenProject(project)}
              >
                <div className="project-card-header">
                  <span className="project-icon">🎬</span>
                  <h3>{project.name}</h3>
                  <button
                    className="btn btn-sm project-delete-btn"
                    onClick={(e) => handleDeleteProject(e, project)}
                    title="删除项目"
                  >
                    🗑️
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
