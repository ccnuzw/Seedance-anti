import { memo } from 'react'
import { fmtTime } from '@renderer/utils/pipeline-view'

interface Props {
  episodeNum: number
  totalElapsed: number
  isEngineMatch: boolean
  hasNextEpisode: boolean
  onNextEpisode: () => void
}

function PipelineCompleteBanner(props: Props) {
  const {
    episodeNum,
    totalElapsed,
    isEngineMatch,
    hasNextEpisode,
    onNextEpisode
  } = props

  return (
    <div className="pipeline-complete-banner">
      <span>
        ✅ EP{String(episodeNum).padStart(2, '0')} 全流程完成！
        {isEngineMatch && `总耗时 ${fmtTime(totalElapsed)}`}
      </span>
      {hasNextEpisode && (
        <button className="btn btn-primary" onClick={onNextEpisode}>
          ▶ 开始下一集 (EP{String(episodeNum + 1).padStart(2, '0')})
        </button>
      )}
    </div>
  )
}

export default memo(PipelineCompleteBanner)
