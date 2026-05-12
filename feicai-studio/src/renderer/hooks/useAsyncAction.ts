import { useCallback, useState } from 'react'

export function useAsyncAction() {
  const [running, setRunning] = useState(false)

  const run = useCallback(async <T>(action: () => Promise<T>): Promise<T> => {
    setRunning(true)
    try {
      return await action()
    } finally {
      setRunning(false)
    }
  }, [])

  return {
    running,
    run
  }
}
