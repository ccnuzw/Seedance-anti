import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEpisodeTextFile } from './useEpisodeTextFile'
import { parsePromptsFromMarkdown } from '@renderer/utils/prompt-markdown'

interface UsePromptDocumentParams {
  enabled: boolean
  episodeNum: number
  getFilePath: (episodeNum: number) => string
  onSaveSuccess?: () => void | Promise<void>
}

export function usePromptDocument(params: UsePromptDocumentParams) {
  const { enabled, episodeNum, getFilePath, onSaveSuccess } = params
  const [isEditing, setIsEditing] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const {
    content: rawMd,
    setContent: setRawMd,
    loading,
    reload,
    save
  } = useEpisodeTextFile({
    enabled,
    episodeNum,
    getFilePath,
    emptyContent: '',
    onSaveSuccess
  })

  const prompts = useMemo(() => parsePromptsFromMarkdown(rawMd), [rawMd])

  useEffect(() => {
    setSelectedIndex(null)
    setIsEditing(false)
  }, [episodeNum])

  const reloadPrompts = useCallback(
    async (ep = episodeNum) => {
      setSelectedIndex(null)
      setIsEditing(false)
      await reload(ep)
    },
    [episodeNum, reload]
  )

  const startEditing = useCallback(() => {
    setIsEditing(true)
  }, [])

  const cancelEditing = useCallback(async () => {
    await reloadPrompts(episodeNum)
  }, [episodeNum, reloadPrompts])

  const saveDraft = useCallback(async () => {
    const ok = await save()
    if (ok) {
      setIsEditing(false)
    }
    return ok
  }, [save])

  return {
    rawMd,
    setRawMd,
    prompts,
    loading,
    isEditing,
    selectedIndex,
    setSelectedIndex,
    startEditing,
    cancelEditing,
    reloadPrompts,
    saveDraft
  }
}
