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
  const document = useEpisodeTextFile({
    enabled,
    episodeNum,
    getFilePath,
    emptyContent: '',
    onSaveSuccess
  })
  const {
    content: rawMd,
    setContent: setRawMd,
    reload,
    save,
    documentSession
  } = document
  const prompts = useMemo(() => parsePromptsFromMarkdown(rawMd), [rawMd])
  const filePath = enabled ? getFilePath(episodeNum) : ''
  useEffect(() => {
    setSelectedIndex(null)
    setIsEditing(false)
  }, [filePath])

  const reloadPrompts = useCallback(
    async (ep = episodeNum) => {
      setSelectedIndex(null)
      await reload(ep)
    },
    [episodeNum, reload]
  )
  const startEditing = useCallback(() => setIsEditing(true), [])
  const cancelEditing = useCallback(async () => {
    if (documentSession.hasPendingChanges()) {
      if (
        !window.confirm('确定丢弃此文件的本地草稿和未保存修改，使用磁盘版本？')
      )
        return
      documentSession.discardDraft()
      if (documentSession.hasPendingChanges()) return
    }
    setIsEditing(false)
  }, [documentSession])
  const saveDraft = useCallback(async () => {
    const ok = await save()
    if (ok) setIsEditing(false)
    return ok
  }, [save])
  return {
    ...document,
    rawMd,
    setRawMd,
    prompts,
    isEditing,
    selectedIndex,
    setSelectedIndex,
    startEditing,
    cancelEditing,
    reloadPrompts,
    saveDraft
  }
}
