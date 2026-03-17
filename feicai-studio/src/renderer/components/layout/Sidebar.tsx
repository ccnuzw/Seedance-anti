import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useProjectStore } from '@renderer/stores/projectStore'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import ExportModal from '@renderer/components/ExportModal'
import './Sidebar.css'

export default function Sidebar() {
  const { currentProject, episodes } = useProjectStore()
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

  const NAV_ITEMS_BEFORE = [
    { path: '/', icon: '🏠', label: '仪表盘' },
  ]

  const NAV_ITEMS_AFTER = currentProject
    ? [
        { path: pipelinePath, icon: '⚡', label: '流水线' },
        { path: `/project/${currentProject.id}/batch`, icon: '🚀', label: '批量执行' },
        { path: `/project/${currentProject.id}/assets`, icon: '🎭', label: '素材库' },
        { path: `/project/${currentProject.id}/prompts`, icon: '📐', label: '提示词' },
        { path: `/project/${currentProject.id}/script`, icon: '📖', label: '剧本' },
        { path: `/project/${currentProject.id}/review`, icon: '📊', label: '审核报告' },
      ]
    : []

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
        {NAV_ITEMS_BEFORE.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              `sidebar-nav-item ${isActive ? 'active' : ''}`
            }
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}

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
                <span className="spc-style">{currentProject.visualStyle || '未设定风格'}</span>
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

        {/* 其他菜单项 */}
        {NAV_ITEMS_AFTER.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `sidebar-nav-item ${isActive ? 'active' : ''}`
            }
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}

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
