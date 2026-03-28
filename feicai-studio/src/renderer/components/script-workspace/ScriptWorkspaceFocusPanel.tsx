import EpisodeNav from '@renderer/components/layout/EpisodeNav'
import type { Episode } from '@shared/types'

interface LiveMeta {
  sceneCount: number
  dialogCount: number
  charCount: number
}

interface ScriptWorkspaceFocusPanelProps {
  episodes: Episode[]
  currentEp: number
  hasCurrentScript: boolean
  pendingPlotForCurrent: boolean
  saved: boolean
  loading: boolean
  liveTitle: string
  liveMeta: LiveMeta
  selectedEpisodeHasScript: boolean
  pendingPlotEpisodeSet: Set<number>
  onEpisodeSelect: (episode: number) => void
}

export default function ScriptWorkspaceFocusPanel({
  episodes,
  currentEp,
  hasCurrentScript,
  pendingPlotForCurrent,
  saved,
  loading,
  liveTitle,
  liveMeta,
  selectedEpisodeHasScript,
  pendingPlotEpisodeSet,
  onEpisodeSelect
}: ScriptWorkspaceFocusPanelProps) {
  return (
    <div className="as-focus-card card">
      <div className="as-section-head">
        <div className="as-focus-copy">
          <h3>当前工作区</h3>
          <p className="text-secondary">当前集状态、选集导航和编辑上下文集中展示，切换时不会丢失工作感知。</p>
        </div>
        <div className="as-focus-badges">
          <span className="as-editor-chip">当前 EP{String(currentEp).padStart(3, '0')}</span>
          <span className={`as-editor-chip ${hasCurrentScript ? 'is-ready' : 'is-empty'}`}>
            {hasCurrentScript ? '已有剧本' : pendingPlotForCurrent ? '待补生成' : '待撰写'}
          </span>
          {!saved && <span className="as-editor-unsaved">未保存</span>}
          {loading && <span className="as-editor-loading">加载中...</span>}
        </div>
      </div>
      <div className="as-focus-meta">
        <span className="as-editor-chip">标题 {liveTitle}</span>
        <span className="as-editor-chip">场景 {liveMeta.sceneCount}</span>
        <span className="as-editor-chip">对白 {liveMeta.dialogCount}</span>
        <span className="as-editor-chip">字数 {liveMeta.charCount}</span>
        {selectedEpisodeHasScript && <span className="as-editor-chip is-ready">已生成文件</span>}
        {!selectedEpisodeHasScript && pendingPlotForCurrent && <span className="as-editor-chip is-empty">已拆到剧情</span>}
        {!selectedEpisodeHasScript && !pendingPlotForCurrent && <span className="as-editor-chip is-empty">尚未拆到剧情</span>}
      </div>
      <EpisodeNav
        episodes={episodes}
        currentEp={currentEp}
        onSelect={onEpisodeSelect}
        isDone={(episode) => episode.hasScript}
        isPartial={(episode) => pendingPlotEpisodeSet.has(episode.episodeNumber) && !episode.hasScript}
      />
    </div>
  )
}
