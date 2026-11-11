export interface TextDraft {
  version: 1
  filePath: string
  content: string
  baseContent: string | null
  updatedAt: number
}

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

// Each real file has its own record: changing an episode or project cannot replace another draft.
export class TextDraftRepository {
  constructor(
    private readonly storage: () => DraftStorage = () => window.localStorage
  ) {}

  private key(filePath: string) {
    return `feicai:text-draft:v1:${encodeURIComponent(filePath)}`
  }

  read(filePath: string): TextDraft | null {
    const raw = this.storage().getItem(this.key(filePath))
    if (raw === null) return null
    const draft: unknown = JSON.parse(raw)
    if (!draft || typeof draft !== 'object')
      throw new Error('本地草稿格式损坏，请勿关闭编辑器')
    const value = draft as Partial<TextDraft>
    if (
      value.version !== 1 ||
      value.filePath !== filePath ||
      typeof value.content !== 'string' ||
      !(value.baseContent === null || typeof value.baseContent === 'string') ||
      typeof value.updatedAt !== 'number'
    ) {
      throw new Error('本地草稿格式损坏，请勿关闭编辑器')
    }
    return value as TextDraft
  }

  write(draft: TextDraft): void {
    this.storage().setItem(this.key(draft.filePath), JSON.stringify(draft))
  }

  remove(filePath: string): void {
    this.storage().removeItem(this.key(filePath))
  }
}

export interface DocumentState {
  filePath: string
  content: string
  diskContent: string | null
  baseContent: string | null
  saved: boolean
  loading: boolean
  saving: boolean
  error: string | null
  persistenceError: string | null
  draftReadError: boolean
  recovery: TextDraft | null
  conflict: boolean
  loaded: boolean
}

interface DocumentIO {
  read(filePath: string): Promise<string | null>
  write(
    filePath: string,
    content: string,
    expectedContent: string | null
  ): Promise<{ success: boolean; error?: string } | void>
}

const initialState = (): DocumentState => ({
  filePath: '',
  content: '',
  diskContent: null,
  baseContent: null,
  saved: true,
  loading: false,
  saving: false,
  error: null,
  persistenceError: null,
  draftReadError: false,
  recovery: null,
  conflict: false,
  loaded: false
})

export class DocumentSession {
  private state = initialState()
  private listeners = new Set<() => void>()
  private request = 0
  private cleanContent = ''
  private savePromise: Promise<boolean> | null = null

  constructor(
    private readonly io: DocumentIO,
    private readonly drafts: TextDraftRepository
  ) {}

  getSnapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private patch(value: Partial<DocumentState>) {
    this.state = { ...this.state, ...value }
    this.listeners.forEach((listener) => listener())
  }

  hasPendingChanges = () =>
    !this.state.saved ||
    !!this.state.recovery ||
    this.state.saving ||
    !!this.state.persistenceError

  private persist() {
    if (this.state.draftReadError || !this.state.filePath) return
    try {
      if (this.state.saved && !this.state.recovery) {
        this.drafts.remove(this.state.filePath)
      } else if (!this.state.recovery) {
        this.drafts.write({
          version: 1,
          filePath: this.state.filePath,
          content: this.state.content,
          baseContent: this.state.baseContent,
          updatedAt: Date.now()
        })
      }
      this.patch({ persistenceError: null })
    } catch {
      this.patch({
        persistenceError:
          '本地草稿未能持久化（存储不可用或已满）。请保存到磁盘，关闭后可能丢失修改。'
      })
    }
  }

  retryDraftPersistence = () => {
    if (!this.state.draftReadError) {
      this.persist()
      return
    }
    try {
      const draft = this.drafts.read(this.state.filePath)
      this.patch({
        draftReadError: false,
        persistenceError: null,
        recovery: draft,
        conflict: !!draft && draft.baseContent !== this.state.diskContent
      })
    } catch {
      /* Preserve the unreadable record until the user explicitly discards it. */
    }
  }

  async open(
    filePath: string,
    emptyContent = ''
  ): Promise<'missing' | 'loaded' | 'error' | 'stale'> {
    const token = ++this.request
    const sameFile = filePath === this.state.filePath
    this.patch(
      sameFile
        ? { loading: true, error: null }
        : {
            ...initialState(),
            filePath,
            content: '',
            loading: !!filePath
          }
    )
    if (!filePath) return 'loaded'
    try {
      const disk = await this.io.read(filePath)
      if (token !== this.request) return 'stale'
      // Reload/focus never silently replaces live changes, even if the disk was changed by generation.
      if (
        sameFile &&
        this.state.loaded &&
        (!this.state.saved || this.state.recovery)
      ) {
        this.patch({
          loading: false,
          diskContent: disk,
          conflict: this.state.baseContent !== disk,
          error: null
        })
        return disk === null ? 'missing' : 'loaded'
      }
      let draft: TextDraft | null = null
      let persistenceError: string | null = null
      try {
        draft = this.drafts.read(filePath)
      } catch {
        persistenceError =
          '无法读取本地草稿；磁盘原稿未被修改。请保留当前窗口并检查本地存储。'
      }
      this.cleanContent = disk ?? emptyContent
      this.patch({
        content: this.cleanContent,
        baseContent: disk,
        diskContent: disk,
        saved: true,
        loading: false,
        loaded: true,
        error: null,
        persistenceError,
        draftReadError: !!persistenceError,
        recovery: draft,
        conflict: !!draft && draft.baseContent !== disk
      })
      return disk === null ? 'missing' : 'loaded'
    } catch {
      if (token !== this.request) return 'stale'
      this.patch({
        loading: false,
        error:
          '读取文件失败，不能确认文件是否存在。请检查权限或磁盘后重试；不会载入模板覆盖原稿。'
      })
      return 'error'
    }
  }

  // Invalidating a request also protects React unmounts and rapid file switches.
  cancelLoad = () => {
    this.request++
  }

  update = (content: string) => {
    if (
      !this.state.loaded ||
      this.state.loading ||
      this.state.recovery ||
      this.state.draftReadError
    )
      return
    this.patch({ content, saved: content === this.cleanContent, error: null })
    this.persist()
  }

  restoreDraft = () => {
    const draft = this.state.recovery
    if (!draft) return
    this.patch({
      content: draft.content,
      baseContent: draft.baseContent,
      saved: false,
      recovery: null,
      conflict: draft.baseContent !== this.state.diskContent
    })
    this.persist()
  }

  discardDraft = () => {
    if (!this.state.loaded || this.state.saving) return
    try {
      this.drafts.remove(this.state.filePath)
      this.cleanContent = this.state.diskContent ?? ''
      this.patch({
        content: this.cleanContent,
        baseContent: this.state.diskContent,
        saved: true,
        recovery: null,
        conflict: false,
        error: null,
        persistenceError: null,
        draftReadError: false
      })
    } catch {
      this.patch({
        persistenceError: '未能丢弃本地草稿，请检查本地存储后重试。'
      })
    }
  }

  save = (
    nextContent?: string,
    overwriteConflict = false
  ): Promise<boolean> => {
    if (this.savePromise) return Promise.resolve(false)
    if (nextContent !== undefined) this.update(nextContent)
    if (
      !this.state.filePath ||
      !this.state.loaded ||
      this.state.loading ||
      this.state.recovery ||
      this.state.draftReadError
    )
      return Promise.resolve(false)
    const filePath = this.state.filePath
    const content = this.state.content
    const expected = overwriteConflict
      ? this.state.diskContent
      : this.state.baseContent
    this.patch({ saving: true, error: null })
    this.savePromise = (async () => {
      try {
        const disk = await this.io.read(filePath)
        if (disk !== expected) {
          if (this.state.filePath === filePath)
            this.patch({
              diskContent: disk,
              conflict: true,
              error:
                '磁盘原稿已更新，未覆盖。请比较版本后选择保留磁盘或明确用草稿覆盖。'
            })
          return false
        }
        const result = await this.io.write(filePath, content, expected)
        if (!result || result.success !== true) {
          if (
            result?.error === 'FILE_CONFLICT' &&
            this.state.filePath === filePath
          ) {
            const latest = await this.io.read(filePath)
            this.patch({ diskContent: latest, conflict: true })
          }
          throw new Error('write failed')
        }
        if (this.state.filePath === filePath) {
          this.cleanContent = content
          this.patch({
            baseContent: content,
            diskContent: content,
            conflict: false,
            saved: this.state.content === content
          })
          this.persist()
          // False also prevents dependent generation from consuming a stale saved revision.
          return this.state.saved
        }
        // A confirmed navigation may finish the old save after another file has opened.
        const draft = this.drafts.read(filePath)
        if (draft?.content === content) this.drafts.remove(filePath)
        return true
      } catch {
        if (this.state.filePath === filePath)
          this.patch({
            error: this.state.conflict
              ? '磁盘原稿已更新，未覆盖。请比较版本并处理冲突。'
              : '保存失败，修改仍保留在编辑器及可用的本地草稿中。请重试。'
          })
        return false
      } finally {
        this.savePromise = null
        if (this.state.filePath === filePath) this.patch({ saving: false })
      }
    })()
    return this.savePromise
  }
}

const activeSessions = new Set<DocumentSession>()
export function registerDocumentSession(session: DocumentSession): () => void {
  activeSessions.add(session)
  return () => {
    activeSessions.delete(session)
  }
}
export function hasUnsavedDocuments(): boolean {
  return [...activeSessions].some((session) => session.hasPendingChanges())
}
export function confirmDocumentLeave(
  confirm: (message: string) => boolean = window.confirm
): boolean {
  if (!hasUnsavedDocuments()) return true
  const unsafe = [...activeSessions].some(
    (session) => !!session.getSnapshot().persistenceError
  )
  return confirm(
    unsafe
      ? '本地草稿未能持久化，离开可能丢失修改。仍要离开吗？'
      : '有未保存到磁盘的修改或待恢复草稿。离开将保留本地草稿，不会自动覆盖磁盘原稿。确定离开吗？'
  )
}

export function guardDocumentUnload(event: BeforeUnloadEvent): void {
  if (!hasUnsavedDocuments()) return
  event.preventDefault()
  event.returnValue = ''
}
