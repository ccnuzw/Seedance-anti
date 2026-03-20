import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useAdaptStore } from '@renderer/stores/adaptStore'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import ExportModal from '@renderer/components/ExportModal'
import './Sidebar.css'

export default function Sidebar() {
  const navigate = useNavigate()
  const { currentProject, episodes, updatePhase } = useProjectStore()
  const { waterLevel, novelInfo } = useAdaptStore()
  const { context: pipelineContext } = usePipelineStore()
  const [showExport, setShowExport] = useState(false)

  // 计算进度
  const completedCount = episodes.filter(e => e.status === 'complete').length
  const progressPct = episodes.length > 0 ? Math.round((completedCount / episodes.length) * 100) : 0

  // 流水线链接自动带上当前运行/上次运行的集数
  const pipelineEp = pipelineContext?.episodeNum
  const pipelinePath = currentProject
    ? `/project/${currentProject.id}/pipeline${pipelineEp ? `?ep=${pipelineEp}` : ''}`
    : ''

  const isWritingPhase = currentProject?.phase === 'writing'
  const isProductionPhase = currentProject?.phase === 'production'

  // 编剧管线导航 + 进度指示
  const totalCh = waterLevel?.totalChapters || novelInfo?.totalChapters || 0
  const processedCh = waterLevel?.processedChapters || 0
  const breakdownPct = totalCh > 0 ? Math.round((processedCh / totalCh) * 100) : 0
  const scriptCount = waterLevel?.completedEpisodes || 0

  const WRITING_NAV = currentProject
    ? [
        { path: `/project/${currentProject.id}/novel`, icon: '📖', label: '小说管理', hint: totalCh > 0 ? `${totalCh}章` : '' },
        { path: `/project/${currentProject.id}/breakdown`, icon: '📊', label: '剧情拆解', hint: breakdownPct > 0 ? `${breakdownPct}%` : '' },
        { path: `/project/${currentProject.id}/adapt-script`, icon: '✍️', label: '剧本创作', hint: scriptCount > 0 ? `${scriptCount}集` : '' },
      ]
    : []

  // 制作管线导航
  const PRODUCTION_NAV = currentProject
    ? [
        { path: pipelinePath, icon: '⚡', label: '流水线' },
        { path: `/project/${currentProject.id}/batch`, icon: '🚀', label: '批量执行' },
        { path: `/project/${currentProject.id}/assets`, icon: '🎭', label: '素材库' },
        { path: `/project/${currentProject.id}/prompts`, icon: '📐', label: '提示词' },
        { path: `/project/${currentProject.id}/script`, icon: '📝', label: '剧本编辑' },
        { path: `/project/${currentProject.id}/review`, icon: '🔍', label: '审核报告' },
      ]
    : []

  const handleUpgradePhase = async () => {
    await updatePhase('production')
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header titlebar-drag">
        <div className="sidebar-logo">
          <span className="logo-icon">🎬</span>
          <span className="logo-text">FEICAI</span>
          <span className="logo-tag">Studio</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {/* 仪表盘 */}
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `sidebar-nav-item ${isActive ? 'active' : ''}`
          }
        >
          <span className="nav-icon">🏠</span>
          <span className="nav-label">仪表盘</span>
        </NavLink>

        {/* 项目卡片 */}
        {currentProject && (
          <NavLink
            to={`/project/${currentProject.id}`}
            className={({ isActive }) =>
              `sidebar-project-card ${isActive ? 'active' : ''}`
            }
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
                <div
                  className="spc-progress-fill"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          </NavLink>
        )}

        {/* 编剧管线分组 */}
        {currentProject && currentProject.sourceType === 'novel' && WRITING_NAV.length > 0 && (
          <>
            <div className="sidebar-group-title">
              <span className="group-icon">📖</span>
              <span>编剧管线</span>
              {isWritingPhase && <span className="group-phase-badge badge-active">进行中</span>}
              {isProductionPhase && <span className="group-phase-badge badge-done">已完成</span>}
            </div>
            {WRITING_NAV.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `sidebar-nav-item ${isActive ? 'active' : ''}`
                }
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
                {item.hint && <span className="nav-hint">{item.hint}</span>}
              </NavLink>
            ))}
          </>
        )}

        {/* 阶段升级按钮 */}
        {currentProject && currentProject.sourceType === 'novel' && isWritingPhase && (
          <button
            className="sidebar-phase-upgrade-btn"
            onClick={handleUpgradePhase}
            title="确认剧本已就绪，进入制作阶段"
          >
            <span className="nav-icon">🚀</span>
            <span className="nav-label">进入制作阶段</span>
          </button>
        )}

        {/* 分组分隔线 */}
        {currentProject && <div className="sidebar-group-divider" />}

        {/* 制作管线分组 */}
        {currentProject && PRODUCTION_NAV.length > 0 && (
          <>
            <div className="sidebar-group-title">
              <span className="group-icon">🎬</span>
              <span>制作管线</span>
              {isProductionPhase && <span className="group-phase-badge badge-active">进行中</span>}
              {currentProject.sourceType === 'novel' && isWritingPhase && <span className="group-phase-badge badge-locked">🔒 待解锁</span>}
            </div>
            {PRODUCTION_NAV.map((item) => (
              <NavLink
                key={item.path}
                to={currentProject.sourceType === 'novel' && isWritingPhase ? '#' : item.path}
                className={({ isActive }) =>
                  `sidebar-nav-item ${isActive && !(currentProject.sourceType === 'novel' && isWritingPhase) ? 'active' : ''} ${currentProject.sourceType === 'novel' && isWritingPhase ? 'nav-disabled' : ''}`
                }
                onClick={(e) => {
                  if (currentProject.sourceType === 'novel' && isWritingPhase) {
                    e.preventDefault()
                  }
                }}
                title={currentProject.sourceType === 'novel' && isWritingPhase ? '完成剧本创作后解锁' : item.label}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </NavLink>
            ))}
          </>
        )}

        {/* 设置 */}
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `sidebar-nav-item ${isActive ? 'active' : ''}`
          }
        >
          <span className="nav-icon">⚙️</span>
          <span className="nav-label">设置</span>
        </NavLink>

        {currentProject && (
          <button className="sidebar-nav-item sidebar-export-btn" onClick={() => setShowExport(true)}>
            <span className="nav-icon">📦</span>
            <span className="nav-label">导出</span>
          </button>
        )}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-version text-secondary">v0.1.0</div>
      </div>

      <ExportModal open={showExport} onClose={() => setShowExport(false)} />
    </aside>
  )
}
