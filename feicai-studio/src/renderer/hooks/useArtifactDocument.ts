import { useCallback, useEffect, useRef, useState } from 'react'
import { readTextFile } from '@renderer/services/file-io'

interface UseArtifactDocumentParams {
  enabled: boolean
  filePath: string
  emptyContent?: string
  onLoadMissing?: () => void
  reloadKey?: string | number
}

export function useArtifactDocument(params: UseArtifactDocumentParams) {
  const { enabled, filePath, emptyContent = '', reloadKey } = params
  const [state, setState] = useState({
    filePath: '',
    content: emptyContent,
    loading: false,
    error: null as string | null
  })
  const callbacks = useRef(params)
  callbacks.current = params
  const request = useRef(0)
  const reload = useCallback(async () => {
    const token = ++request.current
    if (!enabled || !filePath) {
      setState({
        filePath,
        content: callbacks.current.emptyContent ?? '',
        loading: false,
        error: null
      })
      return
    }
    setState((current) => ({
      filePath,
      content: current.filePath === filePath ? current.content : '',
      loading: true,
      error: null
    }))
    try {
      const text = await readTextFile(filePath)
      if (token !== request.current) return
      setState({
        filePath,
        content: text ?? callbacks.current.emptyContent ?? '',
        loading: false,
        error: null
      })
      if (text === null) callbacks.current.onLoadMissing?.()
    } catch {
      if (token !== request.current) return
      setState((current) => ({
        ...current,
        loading: false,
        error: '读取产物失败，请检查磁盘和权限后重试；这不代表文件不存在。'
      }))
    }
  }, [enabled, filePath])

  useEffect(() => {
    void reload()
    return () => {
      request.current++
    }
  }, [reload, reloadKey])

  return {
    content: state.filePath === filePath ? state.content : emptyContent,
    loading: state.filePath !== filePath || state.loading,
    error: state.error,
    reload
  }
}
