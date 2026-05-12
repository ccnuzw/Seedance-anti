import { useEffect, useRef } from 'react'
import { usePipelineStore } from '@renderer/stores/pipelineStore'

interface Params {
  episodeNum: number
  resetDisplay: () => void
  syncFromBackend: () => Promise<void>
}

export function usePipelineEpisodeSync(params: Params) {
  const { episodeNum, resetDisplay, syncFromBackend } = params
  const prevEpRef = useRef(episodeNum)

  useEffect(() => {
    if (prevEpRef.current !== episodeNum) {
      prevEpRef.current = episodeNum
      if (!usePipelineStore.getState().isRunning) {
        resetDisplay()
      }
    }
    void syncFromBackend()
  }, [episodeNum, resetDisplay, syncFromBackend])
}
