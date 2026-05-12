import type { MouseEvent } from 'react'
import type { Project } from '@shared/types'

interface Props {
  projects: Project[]
  onOpenProject: (project: Project) => void
  onDeleteProject: (e: MouseEvent, project: Project) => void
}

export default function DashboardProjectGrid(props: Props) {
  const { projects, onOpenProject, onDeleteProject } = props

  if (projects.length === 0) {
    return (
      <div className="dashboard-empty">
        <div className="empty-icon">📋</div>
        <h2>还没有项目</h2>
        <p className="text-secondary">
          点击「新建项目」从小说、剧情或剧本开始
          <br />
          或「导入项目」导入已有的 FEICAI 项目目录
        </p>
      </div>
    )
  }

  return (
    <div className="project-grid">
      {projects.map((project) => (
        <div
          key={project.id}
          className="card project-card"
          onClick={() => onOpenProject(project)}
        >
          <div className="project-card-header">
            <span className="project-icon">🎬</span>
            <h3>{project.name}</h3>
            <button
              className="btn btn-sm project-delete-btn"
              onClick={(e) => onDeleteProject(e, project)}
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
  )
}
