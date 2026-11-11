import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import { readTextFile } from '@renderer/services/file-io'
import { invalidateCachedTextFile } from '@renderer/services/file-cache'
import {
  DocumentSession,
  TextDraftRepository,
  registerDocumentSession
} from '@renderer/stores/documentDraftStore'

interface UseProjectTextFileParams {
  enabled: boolean
  filePath: string
  emptyContent: string
  onLoadMissing?: () => void
  onSaveSuccess?: () => void | Promise<void>
}

export function useProjectTextFile(params: UseProjectTextFileParams) {
  const { enabled, filePath } = params
  const callbacks = useRef(params)
  callbacks.current = params
  const [session] = useState(
    () =>
      new DocumentSession(
        {
          read: readTextFile,
          write: async (path, text, expected) => {
            const result = await window.feicaiAPI.writeTextFile(
              path,
              text,
              expected
            )
            invalidateCachedTextFile(path)
            return result
          }
        },
        new TextDraftRepository()
      )
  )
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const activePath = enabled ? filePath : ''
  const pathRef = useRef(activePath)
  pathRef.current = activePath

  useEffect(() => registerDocumentSession(session), [session])
  useEffect(() => {
    void session
      .open(activePath, callbacks.current.emptyContent)
      .then((result) => {
        if (result === 'missing') callbacks.current.onLoadMissing?.()
      })
    return session.cancelLoad
  }, [session, activePath])

  useEffect(() => {
    const checkDisk = () => {
      if (pathRef.current)
        void session.open(pathRef.current, callbacks.current.emptyContent)
    }
    window.addEventListener('focus', checkDisk)
    return () => window.removeEventListener('focus', checkDisk)
  }, [session])

  const reload = useCallback(async () => {
    const result = await session.open(
      pathRef.current,
      callbacks.current.emptyContent
    )
    if (result === 'missing') callbacks.current.onLoadMissing?.()
  }, [session])

  const save = useCallback(
    async (nextContent?: string) => {
      const path = pathRef.current
      const onSuccess = callbacks.current.onSaveSuccess
      if (!path || session.getSnapshot().filePath !== path) return false
      const ok = await session.save(nextContent)
      if (ok) {
        try {
          await onSuccess?.()
        } catch {
          /* The disk commit has already succeeded. */
        }
      }
      return ok
    },
    [session]
  )

  const overwriteConflict = useCallback(async () => {
    const onSuccess = callbacks.current.onSaveSuccess
    if (
      !window.confirm(
        '磁盘原稿已更新。确定以当前草稿覆盖磁盘版本？原稿备份由写入服务保留。'
      )
    )
      return false
    const ok = await session.save(undefined, true)
    if (ok) {
      try {
        await onSuccess?.()
      } catch {
        /* Disk is already committed. */
      }
    }
    return ok
  }, [session])

  const matching = state.filePath === activePath
  return {
    ...state,
    content: matching ? state.content : '',
    loading: !matching || state.loading,
    setContent: session.update,
    reload,
    saved:
      matching &&
      state.saved &&
      !state.recovery &&
      !state.draftReadError &&
      state.loaded,
    save,
    documentSession: session,
    overwriteConflict
  }
}
