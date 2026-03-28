import type { EpisodeQueueItem } from '@renderer/hooks/useScriptWorkspace'
import EpisodeNav from '@renderer/components/layout/EpisodeNav'

interface LiveMeta {
  sceneCount: number
  dialogCount: number
  charCount: number
}

interface ScriptQueueBoardProps {
  episodes: EpisodeQueueItem[]
  currentEp: number
  supportsGeneration: boolean
  isRunning: boolean
  availableEpisodeCount: number
  scriptEpisodeCount: number
  currentTitle?: string
  liveMeta?: LiveMeta
  hasCurrentScript?: boolean
  pendingPlotForCurrent?: boolean
  saved?: boolean
  loading?: boolean
  selectedEpisodeHasScript?: boolean
  pendingPlotEpisodeSet?: Set<number>
  onEpisodeSelect: (episode: number) => void
  onGenerateEpisode: (episode: number) => void
  layout?: 'default' | 'rail' | 'embedded'
}

export default function ScriptQueueBoard({
  episodes,
  currentEp,
  supportsGeneration,
  isRunning,
  availableEpisodeCount,
  scriptEpisodeCount,
  currentTitle,
  liveMeta,
  hasCurrentScript = false,
  pendingPlotForCurrent = false,
  saved = true,
  loading = false,
  selectedEpisodeHasScript = false,
  pendingPlotEpisodeSet = new Set<number>(),
  onEpisodeSelect,
  onGenerateEpisode,
  layout = 'default'
}: ScriptQueueBoardProps) {
  const isRail = layout === 'rail'
  const isEmbedded = layout === 'embedded'

  const getEpisodeStatusLabel = (episode: EpisodeQueueItem) => {
    if (episode.hasScript) return `${episode.sceneCount} 场已成稿`
    if (episode.hasAssignedPlots) return '剧情已就位，待出稿'
    return supportsGeneration ? '可生成或手写' : '可直接手写'
  }

  return (
    <div className={`as-queue-board card ${isRail ? 'is-rail' : ''} ${isEmbedded ? 'is-embedded' : ''}`}>
      <div className="as-section-head">
        <div className="as-focus-copy">
          <h3>{isRail || isEmbedded ? '选集面板' : '创作队列'}</h3>
          <p className="text-secondary">
            {isRail || isEmbedded
              ? '这里只负责切换集数和看状态，主编辑区保持干净。'
              : '按横向卡片浏览各集状态，先选集，再在下方主工作区完成编辑、质检和送制片。'}
          </p>
        </div>
        <span className="text-secondary text-xs">{scriptEpisodeCount}/{availableEpisodeCount} 已有剧本文件</span>
      </div>
      {isRail && (
        <div className="as-rail-current">
          <div className="as-rail-current-top">
            <strong>EP{String(currentEp).padStart(3, '0')}</strong>
            <span className={`as-script-card-tag ${hasCurrentScript ? 'is-ready' : 'is-empty'}`}>
              {hasCurrentScript ? '已有剧本' : pendingPlotForCurrent ? '待补生成' : '待撰写'}
            </span>
            {!saved && <span className="as-editor-unsaved">未保存</span>}
            {loading && <span className="as-editor-loading">加载中...</span>}
          </div>
          {currentTitle && <div className="as-rail-current-title">{currentTitle}</div>}
          {liveMeta && (
            <div className="as-rail-current-meta">
              <span className="status-chip">场景 {liveMeta.sceneCount}</span>
              <span className="status-chip">对白 {liveMeta.dialogCount}</span>
              <span className="status-chip">字数 {liveMeta.charCount}</span>
              {selectedEpisodeHasScript && <span className="status-chip is-success">已生成文件</span>}
              {!selectedEpisodeHasScript && pendingPlotForCurrent && <span className="status-chip is-warning">已拆到剧情</span>}
              {!selectedEpisodeHasScript && !pendingPlotForCurrent && <span className="status-chip is-warning">尚未拆到剧情</span>}
            </div>
          )}
          <EpisodeNav
            episodes={episodes.map((episode) => ({
              id: `rail-${episode.episode}`,
              projectId: '',
              episodeNumber: episode.episode,
              title: episode.title,
              status: 'idle',
              hasScript: episode.hasScript,
              hasDirectorAnalysis: false,
              hasArtDesign: false,
              hasSeedancePrompts: false,
              createdAt: '',
              updatedAt: ''
            }))}
            currentEp={currentEp}
            onSelect={onEpisodeSelect}
            isDone={(episode) => episode.hasScript}
            isPartial={(episode) => pendingPlotEpisodeSet.has(episode.episodeNumber) && !episode.hasScript}
          />
        </div>
      )}
      {isEmbedded && (
        <div className="as-embedded-nav">
          <EpisodeNav
            episodes={episodes.map((episode) => ({
              id: `embedded-${episode.episode}`,
              projectId: '',
              episodeNumber: episode.episode,
              title: episode.title,
              status: 'idle',
              hasScript: episode.hasScript,
              hasDirectorAnalysis: false,
              hasArtDesign: false,
              hasSeedancePrompts: false,
              createdAt: '',
              updatedAt: ''
            }))}
            currentEp={currentEp}
            onSelect={onEpisodeSelect}
            isDone={(episode) => episode.hasScript}
            isPartial={(episode) => pendingPlotEpisodeSet.has(episode.episodeNumber) && !episode.hasScript}
          />
        </div>
      )}
      <div className="as-queue-track">
        {episodes.map((episode) => (
          <div
            key={episode.episode}
            className={`as-script-card ${currentEp === episode.episode ? 'is-active' : ''} ${episode.hasScript ? 'is-ready' : episode.hasAssignedPlots ? 'is-pending' : 'is-empty'}`}
            onClick={() => onEpisodeSelect(episode.episode)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onEpisodeSelect(episode.episode)
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="as-script-card-head">
              <strong>EP{String(episode.episode).padStart(3, '0')}</strong>
              <span className={`as-script-card-tag ${episode.hasScript ? 'is-ready' : episode.hasAssignedPlots ? 'is-pending' : 'is-empty'}`}>
                {episode.hasScript ? '已成稿' : episode.hasAssignedPlots ? '待补生成' : '待撰写'}
              </span>
            </div>
            <div className="as-script-card-title">{episode.title}</div>
            {isEmbedded ? (
              <div className="as-script-card-status text-secondary">{getEpisodeStatusLabel(episode)}</div>
            ) : (
              <div className="as-script-card-meta">
                <span>{episode.hasScript ? `对白 ${episode.dialogCount}` : episode.hasAssignedPlots ? '剧情已就位' : (supportsGeneration ? '可生成或手写' : '可直接手写')}</span>
                <span>{episode.hasScript ? `字数 ${episode.charCount}` : episode.hasAssignedPlots ? '等待出稿' : '尚无文件'}</span>
              </div>
            )}
            {!isRail && !isEmbedded && (
              <div className="as-script-card-preview text-secondary">
                {episode.preview.slice(0, 88)}
                {episode.preview.length > 88 ? '...' : ''}
              </div>
            )}
            {supportsGeneration && !episode.hasScript && episode.hasAssignedPlots && (
              <div className="as-script-card-actions">
                <button
                  className="btn btn-sm"
                  disabled={isRunning}
                  onClick={(event) => {
                    event.stopPropagation()
                    onGenerateEpisode(episode.episode)
                  }}
                >
                  补生成该集
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
