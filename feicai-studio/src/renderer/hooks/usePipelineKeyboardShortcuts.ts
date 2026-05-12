import { useEffect } from 'react'

interface Params {
  isRunning: boolean
  canStart: boolean
  onStart: () => void
  onStop: () => void
}

export function usePipelineKeyboardShortcuts(params: Params) {
  const { isRunning, canStart, onStart, onStop } = params

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey
      if (isMeta && e.key === 'Enter' && !isRunning && canStart) {
        e.preventDefault()
        onStart()
      }
      if (isMeta && e.key === 'p' && isRunning) {
        e.preventDefault()
        onStop()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isRunning, canStart, onStart, onStop])
}
