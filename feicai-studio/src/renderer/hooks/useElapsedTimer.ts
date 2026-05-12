import { useEffect, useState } from 'react'

export function useElapsedTimer(
  startedAt: number | null,
  running: boolean
): number {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!startedAt || !running) {
      if (startedAt && !running) {
        setElapsed(Math.round((Date.now() - startedAt) / 1000))
      }
      return
    }

    const tick = () => setElapsed(Math.round((Date.now() - startedAt) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt, running])

  return elapsed
}
