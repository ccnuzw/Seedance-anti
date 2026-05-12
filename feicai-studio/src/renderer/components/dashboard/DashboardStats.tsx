interface Props {
  projectCount: number
  totalEpisodes: number
}

export default function DashboardStats({ projectCount, totalEpisodes }: Props) {
  return (
    <div className="dashboard-stats">
      <div className="card stat-card">
        <div className="stat-icon">📝</div>
        <div className="stat-info">
          <div className="stat-value">{projectCount}</div>
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
  )
}
