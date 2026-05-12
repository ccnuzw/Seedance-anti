import { useEffect } from 'react'

export function usePipelineEventLifecycle(
  setupEventListeners: () => () => void
) {
  useEffect(() => {
    const cleanup = setupEventListeners()
    return cleanup
  }, [setupEventListeners])
}
