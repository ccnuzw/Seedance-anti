import { NavLink } from 'react-router-dom'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useAdaptStore } from '@renderer/stores/adaptStore'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import './Sidebar.css'

export default function Sidebar() {
  const { currentProject, episodes } = useProjectStore()
  const { waterLevel, novelInfo, projectPath: adaptProjectPath, reviewFailedData, adaptPlan } = useAdaptStore()
  const { context: pipelineContext } = usePipelineStore()

  const completedCount = episodes.filter((episode) => episode.status === 'complete').length
  const progressPct = episodes.length > 0 ? Math.round((completedCount / episodes.length) * 100) : 0

  const pipelineEp = currentProject && pipelineContext?.projectId === currentProject.id
    ? pipelineContext.episodeNum
    : undefined

  const productionPath = currentProject
    ? `/project/${currentProject.id}/production${pipelineEp ? `?tab=pipeline&ep=${pipelineEp}` : ''}`
    : ''

  const isWritingPhase = currentProject?.phase === 'writing'
  const isProductionPhase = currentProject?.phase === 'production'
  const hasCurrentProjectAdaptData = !!currentProject && adaptProjectPath === currentProject.projectPath
  const totalCh = hasCurrentProjectAdaptData ? (waterLevel?.totalChapters || novelInfo?.totalChapters || 0) : 0
  const processedCh = hasCurrentProjectAdaptData ? (waterLevel?.processedChapters || 0) : 0
  const breakdownPct = totalCh > 0 ? Math.round((processedCh / totalCh) * 100) : 0
  const scriptCount = episodes.filter((episode) => episode.hasScript).length
  const hasScripts = episodes.some((episode) => episode.hasScript)
  const handoffReady = hasScripts && !reviewFailedData

  const projectNav = currentProject
    ? [
        {
          path: `/project/${currentProject.id}/workspace`,
          icon: '🧭',
          label: '工作台',
          hint: reviewFailedData ? '有阻塞' : handoffReady ? '可交付' : '推进中',
          end: true
        },
        ...(currentProject.sourceType === 'novel'
          ? [{
              path: `/project/${currentProject.id}/source`,
              icon: '📚',
              label: '内容准备',
              hint: adaptPlan || breakdownPct > 0 ? `${breakdownPct}% 已准备` : totalCh > 0 ? `${totalCh}章待规划` : '待导入'
            }]
          : []),
        {
          path: `/project/${currentProject.id}/script`,
          icon: '✍️',
          label: '剧本创作',
          hint: scriptCount > 0 ? `${scriptCount}集已成稿` : '待开始'
        },
        {
          path: productionPath,
          icon: '🎬',
          label: '画面制作',
          hint: isProductionPhase ? '制作中' : currentProject.sourceType === 'novel' && isWritingPhase ? '待解锁' : '可进入'
        },
        {
          path: `/project/${currentProject.id}/delivery`,
          icon: '📦',
          label: '交付导出',
          hint: handoffReady ? '可检查' : '待补齐'
        },
        {
          path: `/project/${currentProject.id}/settings`,
          icon: '⚙️',
          label: '项目设置',
          hint: '参数与自动化'
        }
      ]
    : []

  return (
    <aside className="sidebar">
      <div className="sidebar-header titlebar-drag">
        <div className="sidebar-logo">
          <span className="logo-icon">🎬</span>
          <span className="sidebar-logo-copy">
            <span className="logo-text">FEICAI</span>
            <span className="logo-tag">Studio</span>
          </span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
        >
          <span className="nav-icon">🏠</span>
          <span className="nav-label">项目</span>
        </NavLink>

        <NavLink
          to="/tasks"
          className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
        >
          <span className="nav-icon">🗂️</span>
          <span className="nav-label">任务中心</span>
        </NavLink>

        {currentProject && (
          <NavLink
            to={`/project/${currentProject.id}/workspace`}
            className={({ isActive }) => `sidebar-project-card ${isActive ? 'active' : ''}`}
          >
            <div className="spc-header">
              <div className="spc-icon-wrapper">
                <span className="spc-icon">🎬</span>
              </div>
              <div className="spc-title-group">
                <span className="spc-name">{currentProject.name}</span>
                <span className="spc-style">
                  {currentProject.sourceType === 'novel'
                    ? `📖 ${currentProject.novelTitle || '网文改编'}`
                    : currentProject.visualStyle || '未设定风格'}
                </span>
              </div>
            </div>

            <div className="spc-meta">
              <div className="spc-meta-item">
                <span className="spc-meta-value">{currentProject.totalEpisodes}</span>
                <span className="spc-meta-label">集数</span>
              </div>
              <div className="spc-meta-divider" />
              <div className="spc-meta-item">
                <span className="spc-meta-value">{completedCount}</span>
                <span className="spc-meta-label">已完成</span>
              </div>
              <div className="spc-meta-divider" />
              <div className="spc-meta-item">
                <span className="spc-meta-value">{progressPct}%</span>
                <span className="spc-meta-label">进度</span>
              </div>
            </div>

            <div className="spc-progress">
              <div className="spc-progress-track">
                <div className="spc-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          </NavLink>
        )}

        {currentProject && projectNav.length > 0 && (
          <>
            <div className="sidebar-group-title">
              <span className="group-icon">🗂️</span>
              <span>当前项目</span>
              {isWritingPhase && <span className="group-phase-badge badge-active">写作中</span>}
              {isProductionPhase && <span className="group-phase-badge badge-done">制作中</span>}
            </div>
            {projectNav.map((item) => {
              const isProductionLocked = item.label === '画面制作' && currentProject.sourceType === 'novel' && isWritingPhase
              return (
                <NavLink
                  key={item.path}
                  to={isProductionLocked ? '#' : item.path}
                  end={item.end}
                  className={({ isActive }) =>
                    `sidebar-nav-item ${isActive && !isProductionLocked ? 'active' : ''} ${isProductionLocked ? 'nav-disabled' : ''}`
                  }
                  onClick={(event) => {
                    if (isProductionLocked) {
                      event.preventDefault()
                    }
                  }}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                  {item.hint && <span className="nav-hint">{item.hint}</span>}
                </NavLink>
              )
            })}
          </>
        )}

        <NavLink
          to="/settings"
          className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
        >
          <span className="nav-icon">⚙️</span>
          <span className="nav-label">设置</span>
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-version text-secondary">v0.1.0</div>
      </div>
    </aside>
  )
}
