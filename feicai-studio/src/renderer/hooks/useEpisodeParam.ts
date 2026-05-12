import { useEffect, useState } from 'react'

export function useEpisodeParam(urlEp: number) {
  const [currentEp, setCurrentEp] = useState(urlEp)

  useEffect(() => {
    if (urlEp !== currentEp) {
      setCurrentEp(urlEp)
    }
  }, [urlEp, currentEp])

  return [currentEp, setCurrentEp] as const
}
