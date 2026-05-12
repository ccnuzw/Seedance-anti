import { useCallback, useEffect, useRef, useState } from 'react'
import {
  invalidateCachedTextFile,
  readCachedTextFile
} from '@renderer/services/file-cache'
import { writeTextFile } from '@renderer/services/file-io'

interface UseEpisodeTextFileParams {
  enabled: boolean
  episodeNum: number
  getFilePath: (episodeNum: number) => string
  emptyContent: string | ((episodeNum: number) => string)
  onLoadMissing?: (episodeNum: number) => void
  onSaveSuccess?: () => void | Promise<void>
}

function resolveEmptyContent(
  emptyContent: UseEpisodeTextFileParams['emptyContent'],
  episodeNum: number
): string {
  return typeof emptyContent === 'function'
    ? emptyContent(episodeNum)
    : emptyContent
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

  const [content, setContent] = useState(() =>
    resolveEmptyContent(emptyContent, episodeNum)
  )
  const [saved, setSaved] = useState(true)
  const [loading, setLoading] = useState(false)
  const emptyContentRef = useRef(emptyContent)
  const getFilePathRef = useRef(getFilePath)
  const onLoadMissingRef = useRef(onLoadMissing)
  const onSaveSuccessRef = useRef(onSaveSuccess)

  useEffect(() => {
    emptyContentRef.current = emptyContent
  }, [emptyContent])

  useEffect(() => {
    getFilePathRef.current = getFilePath
  }, [getFilePath])

  useEffect(() => {
    onLoadMissingRef.current = onLoadMissing
  }, [onLoadMissing])

  useEffect(() => {
    onSaveSuccessRef.current = onSaveSuccess
  }, [onSaveSuccess])

  const reload = useCallback(
    async (ep = episodeNum) => {
      if (!enabled) return
      const filePath = getFilePathRef.current(ep)
      invalidateCachedTextFile(filePath)
      setLoading(true)
      try {
        const text = await readCachedTextFile(filePath)
        if (text == null) {
          throw new Error('missing text file')
        }
        setContent(text)
      } catch {
        setContent(resolveEmptyContent(emptyContentRef.current, ep))
        onLoadMissingRef.current?.(ep)
      }
      setSaved(true)
      setLoading(false)
    },
    [enabled, episodeNum]
  )

  useEffect(() => {
    if (enabled && episodeNum > 0) {
      void reload(episodeNum)
    }
  }, [enabled, episodeNum, reload])

  const save = useCallback(
    async (nextContent?: string) => {
      if (!enabled) return false
      const filePath = getFilePathRef.current(episodeNum)
      try {
        invalidateCachedTextFile(filePath)
        await writeTextFile(filePath, nextContent ?? content)
        invalidateCachedTextFile(filePath)
        await onSaveSuccessRef.current?.()
        setSaved(true)
        return true
      } catch {
        return false
      }
    },
    [enabled, getFilePath, episodeNum, content, onSaveSuccess]
  )

  const updateContent = useCallback((nextContent: string) => {
    setContent(nextContent)
    setSaved(false)
  }, [])

  return {
    content,
    setContent: updateContent,
    setRawContent: setContent,
    saved,
    setSaved,
    loading,
    reload,
    save
  }
}
