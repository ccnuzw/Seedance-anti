import { getEpisodeCardSummary, PROJECT_STATUS_MAP } from './project-page-view'
import { isEpisodeComplete } from '@shared/episode-status'
import type { Episode, Project } from '@shared/types'

interface Props {
  currentProject: Project
  episodes: Episode[]
  viewMode: 'card' | 'list'
  setViewMode: (mode: 'card' | 'list') => void
  progressPct: number
  completedCount: number
  navigateToPipeline: (episodeNumber?: number) => void
}

export default function ProjectEpisodeCollection(props: Props) {
  const {
    episodes,
    viewMode,
    setViewMode,
    progressPct,
    completedCount,
    navigateToPipeline
  } = props

  return (
    <>
      <div className="progress-section">
        <div className="progress-bar-bg">
          <div
            className="progress-bar-fill"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="progress-text text-secondary">
          {completedCount} / {episodes.length} 集已完成 ({progressPct}%)
        </div>
      </div>

      <div className="view-toggle">
        <button
          className={`view-toggle-btn ${viewMode === 'card' ? 'active' : ''}`}
          onClick={() => setViewMode('card')}
          title="卡片视图"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <rect x="1" y="1" width="6" height="6" rx="1" />
            <rect x="9" y="1" width="6" height="6" rx="1" />
            <rect x="1" y="9" width="6" height="6" rx="1" />
            <rect x="9" y="9" width="6" height="6" rx="1" />
          </svg>
        </button>
        <button
          className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
          onClick={() => setViewMode('list')}
          title="列表视图"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <rect x="1" y="2" width="14" height="2" rx="0.5" />
            <rect x="1" y="7" width="14" height="2" rx="0.5" />
            <rect x="1" y="12" width="14" height="2" rx="0.5" />
          </svg>
        </button>
      </div>

      {episodes.length === 0 ? (
        <div className="episode-empty text-secondary">
          暂无集数数据。点击「流水线」开始处理。
        </div>
      ) : viewMode === 'card' ? (
        <div className="episode-grid">
          {episodes.map((episode) => {
            const status =
              PROJECT_STATUS_MAP[episode.status] || PROJECT_STATUS_MAP.idle
            const isComplete = isEpisodeComplete(episode.status)
            const summary = getEpisodeCardSummary(episode)

            return (
              <div
                key={episode.id}
                className={`ep-card ${isComplete ? 'ep-card--done' : ''}`}
                onClick={() => navigateToPipeline(episode.episodeNumber)}
              >
                <div
                  className={`ep-card-stripe ${isComplete ? 'stripe--done' : ''}`}
                />
                <div className="ep-card-body">
                  <div className="ep-card-hero">
                    <span className="ep-num">
                      {String(episode.episodeNumber).padStart(2, '0')}
                    </span>
                    <div className="ep-card-hero-right">
                      <h3 className="ep-title">
                        {episode.title || `第${episode.episodeNumber}集`}
                      </h3>
                      <span className={`ep-status ${status.cls}`}>
                        {status.emoji} {status.label}
                      </span>
                    </div>
                  </div>

                  <div className="ep-artifacts-row">
                    <span
                      className={`ep-artifact ${episode.hasScript ? 'on' : ''}`}
                      title="剧本"
                    >
                      📖 剧本
                    </span>
                    <span
                      className={`ep-artifact ${episode.hasDirectorAnalysis ? 'on' : ''}`}
                      title="导演"
                    >
                      🎬 导演
                    </span>
                    <span
                      className={`ep-artifact ${episode.hasArtDesign ? 'on' : ''}`}
                      title="服化道"
                    >
                      🎨 服化道
                    </span>
                    <span
                      className={`ep-artifact ${episode.hasSeedancePrompts ? 'on' : ''}`}
                      title="提示词"
                    >
                      📐 提示词
                    </span>
                  </div>

                  <div className="ep-card-footer">
                    <span className="ep-meta">
                      {summary.stageLabel}
                      <span className="ep-meta-dot">·</span>
                      {summary.progress}%<span className="ep-meta-dot">·</span>
                      {summary.promptCountLabel}
                      <span className="ep-meta-dot">·</span>
                      {summary.durationLabel}
                    </span>
                    <span className="ep-launch">启动 →</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="episode-table-wrapper">
          <table className="episode-table">
            <thead>
              <tr>
                <th>集数</th>
                <th>标题</th>
                <th>产物</th>
                <th>状态</th>
                <th>提示词数</th>
                <th>总时长</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {episodes.map((episode) => {
                const status =
                  PROJECT_STATUS_MAP[episode.status] || PROJECT_STATUS_MAP.idle
                return (
                  <tr key={episode.id} className="episode-row">
                    <td className="ep-number">
                      EP{String(episode.episodeNumber).padStart(2, '0')}
                    </td>
                    <td className="ep-title">{episode.title || '-'}</td>
                    <td>
                      <span className={`badge ${status.cls}`}>
                        {status.emoji} {status.label}
                      </span>
                    </td>
                    <td>
                      <div className="file-indicators">
                        <span
                          className={`fi-dot ${episode.hasScript ? 'fi-script' : 'fi-missing'}`}
                          title="剧本"
                        >
                          📖
                        </span>
                        <span
                          className={`fi-dot ${episode.hasDirectorAnalysis ? 'fi-director' : 'fi-missing'}`}
                          title="导演分析"
                        >
                          🎬
                        </span>
                        <span
                          className={`fi-dot ${episode.hasArtDesign ? 'fi-art' : 'fi-missing'}`}
                          title="服化道"
                        >
                          🎨
                        </span>
                        <span
                          className={`fi-dot ${episode.hasSeedancePrompts ? 'fi-prompt' : 'fi-missing'}`}
                          title="提示词"
                        >
                          📐
                        </span>
                      </div>
                    </td>
                    <td className="text-secondary">
                      {episode.totalPrompts ?? '-'}
                    </td>
                    <td className="text-secondary">
                      {episode.totalDurationSeconds
                        ? `${episode.totalDurationSeconds}s`
                        : '-'}
                    </td>
                    <td>
                      <button
                        className="btn btn-sm"
                        onClick={() =>
                          navigateToPipeline(episode.episodeNumber)
                        }
                      >
                        ▶
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
