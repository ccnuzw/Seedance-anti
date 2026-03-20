import type { Episode } from '@shared/types'
import './EpisodeNav.css'

interface EpisodeNavProps {
  episodes: Episode[]
  currentEp: number
  onSelect: (ep: number) => void
  /** 正在运行的集数（显示脉冲动画） */
  runningEp?: number
  /** 判断是否"已完成"的自定义逻辑，默认按 episode.status === 'complete' */
  isDone?: (episode: Episode) => boolean
}

export default function EpisodeNav({ episodes, currentEp, onSelect, runningEp, isDone }: EpisodeNavProps) {
  const sorted = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber)

  const checkDone = isDone ?? ((ep: Episode) => ep.status === 'complete')

  /** 部分完成：有导演分析或服化道但无最终提示词 */
  const checkPartial = (ep: Episode) => {
    return ep.status === 'director' || ep.status === 'art'
  }

  return (
    <div className="epnav">
      <div className="epnav-track">
        {sorted.map((ep) => {
          const num = ep.episodeNumber
          const isActive = num === currentEp
          const done = checkDone(ep)
          const partial = !done && checkPartial(ep)
          const isRunningEp = runningEp === num
          return (
            <button
              key={num}
              className={[
                'epnav-item',
                isActive && 'epnav-active',
                done && !isActive && 'epnav-done',
                partial && !isActive && 'epnav-partial',
                isRunningEp && 'epnav-running'
              ].filter(Boolean).join(' ')}
              onClick={() => onSelect(num)}
              title={`EP${String(num).padStart(3, '0')}${isRunningEp ? ' (运行中)' : ''}`}
            >
              <span className="epnav-num">{String(num).padStart(3, '0')}</span>
              {isRunningEp && <span className="epnav-pulse">▶</span>}
              {done && !isRunningEp && <span className="epnav-check">✓</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
