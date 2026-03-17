import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'
import { IPC } from '@shared/ipc-channels'
import { VISUAL_STYLES, TARGET_MEDIUMS } from '@shared/constants'
import type { Project } from '@shared/types'
import './DashboardPage.css'

export default function DashboardPage() {
  const navigate = useNavigate()
  const { projects, loadProjects, setCurrentProject, createProject, deleteProject } = useProjectStore()
  const { addToast } = useToastStore()
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDir, setNewDir] = useState('')
  const [newStyle, setNewStyle] = useState('')
  const [newMedium, setNewMedium] = useState('')
  const [newEpisodes, setNewEpisodes] = useState(0)

  useEffect(() => {
    loadProjects()
  }, [])

  const handleImportProject = async () => {
    const dirPath = await window.feicaiAPI.invoke(IPC.FILE_SELECT_DIR) as string | null
    if (!dirPath) return

    try {
      const configRaw = await window.feicaiAPI.invoke(IPC.FILE_READ, `${dirPath}/project-config.json`) as string
      const config = JSON.parse(configRaw)
      const project = await createProject({
        name: config.projectName || '未命名项目',
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

  const handleCreateProject = async () => {
    if (!newName || !newDir) return
    try {
      const project = await createProject({
        name: newName,
        visualStyle: newStyle,
        targetMedium: newMedium,
        projectPath: newDir,
        totalEpisodes: newEpisodes,
        config: {}
      })
      setCurrentProject(project)
      setShowNewDialog(false)
      setNewName(''); setNewDir(''); setNewStyle(''); setNewMedium(''); setNewEpisodes(0)
      addToast('success', `项目「${project.name}」创建成功`)
      navigate(`/project/${project.id}`)
    } catch {
      addToast('error', '项目创建失败')
    }
  }

  const handleSelectDir = async () => {
    const path = await window.feicaiAPI.invoke(IPC.FILE_SELECT_DIR) as string | null
    if (!path) return
    setNewDir(path)
    // 如果目录已有 project-config.json，自动回填表单
    try {
      const configRaw = await window.feicaiAPI.invoke(IPC.FILE_READ, `${path}/project-config.json`) as string
      const config = JSON.parse(configRaw)
      if (config.projectName) setNewName(config.projectName)
      if (config.visualStyle) setNewStyle(config.visualStyle)
      if (config.targetMedium) setNewMedium(config.targetMedium)
      if (config.totalEpisodes) setNewEpisodes(config.totalEpisodes)
      addToast('info', '已检测到项目配置，自动填充')
    } catch { /* 无 config 文件，正常 */ }
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

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-title">
            <span className="title-emoji">🎬</span>
            欢迎使用 FEICAI Studio
          </h1>
          <p className="dashboard-subtitle text-secondary">
            AI 驱动的影视短剧制作工作台
          </p>
        </div>
        <div className="dashboard-actions">
          <button className="btn" onClick={handleImportProject}>
            📁 导入项目
          </button>
          <button className="btn btn-primary" onClick={() => setShowNewDialog(true)}>
            ✨ 新建项目
          </button>
        </div>
      </div>

      {/* 新建项目对话框 */}
      {showNewDialog && (
        <div className="card new-project-dialog">
          <h3>✨ 新建项目</h3>
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
          </div>
          <div className="form-actions">
            <button className="btn" onClick={() => setShowNewDialog(false)}>取消</button>
            <button
              className="btn btn-primary"
              onClick={handleCreateProject}
              disabled={!newName || !newDir}
            >
              创建
            </button>
          </div>
        </div>
      )}

      {/* 项目列表 */}
      {projects.length === 0 ? (
        <div className="dashboard-empty">
          <div className="empty-icon">📋</div>
          <h2>还没有项目</h2>
          <p className="text-secondary">
            点击「新建项目」创建一个新的短剧制作项目<br />
            或「导入项目」导入已有的 FEICAI 项目目录
          </p>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((project) => (
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
                {project.totalEpisodes} 集
                {project.visualStyle && ` · ${project.visualStyle}`}
              </div>
              <div className="project-card-footer text-secondary">
                {project.projectPath}
              </div>
            </div>
          ))}
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
