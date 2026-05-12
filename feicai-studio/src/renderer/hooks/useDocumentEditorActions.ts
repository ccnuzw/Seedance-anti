import { useCallback } from 'react'
import { readTextFile, selectFile } from '@renderer/services/file-io'

type ToastKind = 'success' | 'info' | 'warning' | 'error'

interface UseDocumentEditorActionsParams {
  setContent: (content: string) => void
  save: () => Promise<boolean>
  addToast: (type: ToastKind, message: string) => void
}

export function useDocumentEditorActions(
  params: UseDocumentEditorActionsParams
) {
  const { setContent, save, addToast } = params

  const importMarkdown = useCallback(async () => {
    const filePath = await selectFile([
      { name: 'Markdown', extensions: ['md'] }
    ])
    if (typeof filePath !== 'string' || filePath.length === 0) return

    try {
      const text = await readTextFile(filePath)
      if (text == null) {
        throw new Error('missing file')
      }
      setContent(text)
      addToast('success', 'Markdown 已导入编辑器')
    } catch {
      addToast('error', '导入失败')
    }
  }, [setContent, addToast])

  const saveDocument = useCallback(async (): Promise<boolean> => {
    const ok = await save()
    if (!ok) {
      addToast('error', '保存失败')
    }
    return ok
  }, [save, addToast])

  const ensureSaved = useCallback(
    async (saved: boolean) => {
      if (saved) return true
      return saveDocument()
    },
    [saveDocument]
  )

  return {
    importMarkdown,
    saveDocument,
    ensureSaved
  }
}
