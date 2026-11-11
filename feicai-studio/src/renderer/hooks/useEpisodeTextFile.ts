import { useCallback } from 'react'
import { useProjectTextFile } from './useProjectTextFile'

interface UseEpisodeTextFileParams {
  enabled: boolean
  episodeNum: number
  getFilePath: (episodeNum: number) => string
  emptyContent: string | ((episodeNum: number) => string)
  onLoadMissing?: (episodeNum: number) => void
  onSaveSuccess?: () => void | Promise<void>
}

export function useEpisodeTextFile(params: UseEpisodeTextFileParams) {
  const {
    enabled,
    episodeNum,
    getFilePath,
    emptyContent,
    onLoadMissing,
    onSaveSuccess
  } = params
  const active = enabled && Number.isInteger(episodeNum) && episodeNum > 0
  const document = useProjectTextFile({
    enabled: active,
    filePath: active ? getFilePath(episodeNum) : '',
    emptyContent:
      typeof emptyContent === 'function'
        ? emptyContent(episodeNum)
        : emptyContent,
    onLoadMissing: () => onLoadMissing?.(episodeNum),
    onSaveSuccess
  })
  const reload = useCallback(
    async (ep = episodeNum) => {
      // An old callback must never load another episode into the active file's editor.
      if (ep === episodeNum) await document.reload()
    },
    [episodeNum, document.reload]
  )
  return { ...document, reload }
}
