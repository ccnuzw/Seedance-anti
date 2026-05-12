import { useCallback, useEffect, useRef, useState } from 'react'
import {
  invalidateCachedTextFile,
  readCachedTextFile
} from '@renderer/services/file-cache'
import { writeTextFile } from '@renderer/services/file-io'

interface UseProjectTextFileParams {
  enabled: boolean
  filePath: string
  emptyContent: string
  onLoadMissing?: () => void
  onSaveSuccess?: () => void | Promise<void>
}

export function useProjectTextFile(params: UseProjectTextFileParams) {
  const { enabled, filePath, emptyContent, onLoadMissing, onSaveSuccess } =
    params

  const [content, setContent] = useState(emptyContent)
  const [saved, setSaved] = useState(true)
  const [loading, setLoading] = useState(false)
  const emptyContentRef = useRef(emptyContent)
  const filePathRef = useRef(filePath)
  const onLoadMissingRef = useRef(onLoadMissing)
  const onSaveSuccessRef = useRef(onSaveSuccess)

  useEffect(() => {
    emptyContentRef.current = emptyContent
  }, [emptyContent])

  useEffect(() => {
    filePathRef.current = filePath
  }, [filePath])

  useEffect(() => {
    onLoadMissingRef.current = onLoadMissing
  }, [onLoadMissing])

  useEffect(() => {
    onSaveSuccessRef.current = onSaveSuccess
  }, [onSaveSuccess])

  const reload = useCallback(async () => {
    if (!enabled || !filePathRef.current) return
    invalidateCachedTextFile(filePathRef.current)
    setLoading(true)
    try {
      const text = await readCachedTextFile(filePathRef.current)
      if (text == null) {
        throw new Error('missing text file')
      }
      setContent(text)
    } catch {
      setContent(emptyContentRef.current)
      onLoadMissingRef.current?.()
    }
    setSaved(true)
    setLoading(false)
  }, [enabled])

  useEffect(() => {
    if (enabled && filePathRef.current) {
      void reload()
      return
    }
    setContent(emptyContentRef.current)
    setSaved(true)
  }, [enabled, filePath, reload])

  const save = useCallback(
    async (nextContent?: string) => {
      if (!enabled || !filePathRef.current) return false
      try {
        invalidateCachedTextFile(filePathRef.current)
        await writeTextFile(filePathRef.current, nextContent ?? content)
        invalidateCachedTextFile(filePathRef.current)
        await onSaveSuccessRef.current?.()
        setSaved(true)
        return true
      } catch {
        return false
      }
    },
    [enabled, filePath, content, onSaveSuccess]
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
    loading,
    reload,
    save
  }
}
