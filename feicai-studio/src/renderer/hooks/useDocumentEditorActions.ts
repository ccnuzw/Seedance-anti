import { useCallback, useEffect, useRef } from 'react'
import { readTextFile, selectFile } from '@renderer/services/file-io'

type ToastKind = 'success' | 'info' | 'warning' | 'error'

interface UseDocumentEditorActionsParams {
  documentKey: string
  setContent: (content: string) => void
  save: () => Promise<boolean>
  addToast: (type: ToastKind, message: string) => void
}

export function useDocumentEditorActions(
  params: UseDocumentEditorActionsParams
) {
  const { documentKey, setContent, save, addToast } = params
  const generation = useRef({ key: documentKey, token: 0 })
  if (generation.current.key !== documentKey) {
    generation.current = {
      key: documentKey,
      token: generation.current.token + 1
    }
  }
  useEffect(
    () => () => {
      generation.current.token++
    },
    []
  )

  const importMarkdown = useCallback(async () => {
    const token = ++generation.current.token
    try {
      const filePath = await selectFile([
        { name: 'Markdown', extensions: ['md'] }
      ])
      if (
        token !== generation.current.token ||
        typeof filePath !== 'string' ||
        !filePath
      )
        return
      const text = await readTextFile(filePath)
      if (token !== generation.current.token) return
      if (text === null) throw new Error('missing file')
      if (
        !window.confirm(
          '导入将替换当前编辑器内容并保留为本地草稿；不会自动写入磁盘原稿。确定导入？'
        )
      )
        return
      setContent(text)
      addToast('success', 'Markdown 已导入为本地草稿，请确认后保存')
    } catch {
      if (token === generation.current.token)
        addToast('error', '导入失败，当前内容未被替换')
    }
  }, [documentKey, setContent, addToast])

  const saveDocument = useCallback(async (): Promise<boolean> => {
    try {
      const ok = await save()
      if (!ok)
        addToast(
          'warning',
          '尚未完成保存：请处理编辑器提示；保存期间的新输入仍保留为草稿'
        )
      return ok
    } catch {
      addToast('error', '保存失败，未丢弃编辑器草稿')
      return false
    }
  }, [save, addToast])

  const ensureSaved = useCallback(
    async (saved: boolean) => saved || (await saveDocument()),
    [saveDocument]
  )
  return { importMarkdown, saveDocument, ensureSaved }
}
