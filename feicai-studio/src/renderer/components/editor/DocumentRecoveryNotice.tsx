import { useSyncExternalStore } from 'react'
import type { DocumentSession } from '@renderer/stores/documentDraftStore'
import './DocumentRecovery.css'

interface Props {
  session: DocumentSession
  onOverwriteConflict: () => Promise<boolean>
  onRetry: () => Promise<void>
}

export default function DocumentRecoveryNotice({
  session,
  onOverwriteConflict,
  onRetry
}: Props) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const discard = () => {
    if (
      window.confirm('确定丢弃此文件的本地草稿和未保存修改，使用当前磁盘版本？')
    )
      session.discardDraft()
  }
  return (
    <div className="document-recovery-area">
      {(state.loading || state.saving) && (
        <p role="status">
          {state.loading
            ? '正在读取磁盘文件…'
            : '正在保存；后续输入仍会保留为草稿…'}
        </p>
      )}
      {state.recovery && (
        <section
          className="document-notice"
          role="status"
          aria-label="发现可恢复草稿"
        >
          <strong>发现此文件的本地草稿</strong>
          <p>
            {new Date(state.recovery.updatedAt).toLocaleString()}{' '}
            的修改尚未保存到磁盘。下方当前显示磁盘原稿；恢复前不会覆盖原稿。
          </p>
          <div className="document-notice-actions">
            <button
              className="btn btn-primary"
              disabled={state.loading}
              onClick={session.restoreDraft}
            >
              恢复草稿
            </button>
            <button className="btn" disabled={state.loading} onClick={discard}>
              丢弃草稿，使用磁盘版本
            </button>
          </div>
        </section>
      )}
      {state.conflict && (
        <section
          className="document-notice"
          role="alert"
          aria-label="磁盘版本冲突"
        >
          <strong>磁盘原稿与草稿的基础版本不同</strong>
          <p>
            其他操作已更新磁盘文件，未自动覆盖。请先比较版本，再选择处理方式。
          </p>
          <details>
            <summary>查看当前磁盘版本</summary>
            <pre>{state.diskContent ?? '（磁盘文件已不存在）'}</pre>
          </details>
          <div className="document-notice-actions">
            <button
              className="btn"
              disabled={state.loading || state.saving}
              onClick={discard}
            >
              丢弃草稿，保留磁盘版本
            </button>
            <button
              className="btn btn-danger"
              disabled={!!state.recovery || state.loading || state.saving}
              onClick={() => void onOverwriteConflict()}
            >
              以当前草稿覆盖磁盘…
            </button>
          </div>
        </section>
      )}
      {state.error && (
        <section className="document-notice" role="alert">
          <p>{state.error}</p>
          <button className="btn" onClick={() => void onRetry()}>
            重新读取磁盘
          </button>
        </section>
      )}
      {state.persistenceError && (
        <section className="document-notice" role="alert">
          <p>{state.persistenceError}</p>
          <div className="document-notice-actions">
            <button className="btn" onClick={session.retryDraftPersistence}>
              重试本地草稿存储
            </button>
            {state.draftReadError && (
              <button className="btn btn-danger" onClick={discard}>
                丢弃不可读草稿，保留磁盘版本…
              </button>
            )}
          </div>
        </section>
      )}
      {!state.saved && !state.recovery && (
        <p className="document-draft-status" role="status">
          {state.persistenceError
            ? '修改仅在当前窗口中'
            : '修改已保留为本地草稿，尚未保存到磁盘原稿'}
        </p>
      )}
      {state.filePath && (
        <p className="document-file-path" title={state.filePath}>
          文件：{state.filePath}
        </p>
      )}
    </div>
  )
}
