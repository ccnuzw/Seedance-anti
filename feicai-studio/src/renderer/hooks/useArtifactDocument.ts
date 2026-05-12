import { useCallback, useEffect, useRef, useState } from 'react'
import {
  readCachedTextFile,
  invalidateCachedTextFile
} from '@renderer/services/file-cache'

interface UseArtifactDocumentParams {
  enabled: boolean
  filePath: string
  emptyContent?: string
  onLoadMissing?: () => void
  reloadKey?: string | number
}

export function useArtifactDocument(params: UseArtifactDocumentParams) {
  const {
    enabled,
    filePath,
    emptyContent = '',
    onLoadMissing,
    reloadKey
  } = params

  const [content, setContent] = useState(emptyContent)
  const [loading, setLoading] = useState(false)
  const emptyContentRef = useRef(emptyContent)
  const onLoadMissingRef = useRef(onLoadMissing)

  useEffect(() => {
    emptyContentRef.current = emptyContent
  }, [emptyContent])

  useEffect(() => {
    onLoadMissingRef.current = onLoadMissing
  }, [onLoadMissing])

  const reload = useCallback(async () => {
    if (!enabled || !filePath) return
    invalidateCachedTextFile(filePath)
    setLoading(true)
    try {
      const text = await readCachedTextFile(filePath)
      if (text == null) {
        throw new Error('missing artifact')
      }
      setContent(text)
    } catch {
      setContent(emptyContentRef.current)
      onLoadMissingRef.current?.()
    }
    setLoading(false)
  }, [enabled, filePath])

  useEffect(() => {
    if (enabled && filePath) {
      void reload()
      return
    }
    setContent(emptyContentRef.current)
  }, [enabled, filePath, reload, reloadKey])

  return {
    content,
    loading,
    reload
  }
}
