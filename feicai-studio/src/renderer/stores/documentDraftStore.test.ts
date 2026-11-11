import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter } from 'react-router-dom'
import {
  DocumentSession,
  TextDraftRepository,
  confirmDocumentLeave,
  guardDocumentUnload,
  hasUnsavedDocuments,
  registerDocumentSession
} from './documentDraftStore'

function deferred<T>() {
  return Promise.withResolvers<T>()
}

function fixture() {
  const records = new Map<string, string>()
  const storage = {
    getItem: vi.fn((key: string) => records.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      records.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      records.delete(key)
    })
  }
  const drafts = new TextDraftRepository(() => storage)
  const files = new Map<string, string>([
    ['/project-a/script/ep01.md', 'original']
  ])
  const read = vi.fn(async (path: string) => files.get(path) ?? null)
  const write = vi.fn(
    async (path: string, content: string, expected: string | null) => {
      if ((files.get(path) ?? null) !== expected)
        return { success: false, error: 'FILE_CONFLICT' }
      files.set(path, content)
      return { success: true }
    }
  )
  const session = new DocumentSession({ read, write }, drafts)
  return { records, storage, drafts, files, read, write, session }
}

const path = '/project-a/script/ep01.md'
const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
})

describe('recoverable real-file editing', () => {
  it('persists separate drafts by real path without writing disk, then offers explicit recovery', async () => {
    const { session, drafts, files, write, read } = fixture()
    await session.open(path)
    session.update('my episode one')
    const second = '/project-b/script/ep01.md'
    await session.open(second, 'template')
    session.update('another project')
    expect(drafts.read(path)?.content).toBe('my episode one')
    expect(drafts.read(second)?.content).toBe('another project')
    expect(write).not.toHaveBeenCalled()
    expect(files.get(path)).toBe('original')

    const reopened = new DocumentSession({ read, write }, drafts)
    await reopened.open(path)
    expect(reopened.getSnapshot().content).toBe('original')
    expect(reopened.getSnapshot().recovery?.content).toBe('my episode one')
    expect(await reopened.save()).toBe(false)
    reopened.restoreDraft()
    expect(reopened.getSnapshot().content).toBe('my episode one')
    expect(await reopened.save()).toBe(true)
    expect(files.get(path)).toBe('my episode one')
    expect(drafts.read(path)).toBeNull()
    expect(drafts.read(second)?.content).toBe('another project')
  })

  it('ignores late successful and failed reads after switching to another file', async () => {
    const { session, read } = fixture()
    const old = deferred<string | null>()
    read.mockImplementationOnce(() => old.promise)
    const pending = session.open(path)
    await session.open('/other/source/chapter.md', 'new template')
    old.resolve('wrong episode')
    expect(await pending).toBe('stale')
    expect(session.getSnapshot().content).toBe('new template')

    const failed = deferred<string | null>()
    read.mockImplementationOnce(() => failed.promise)
    const failing = session.open(path)
    await session.open('/other/source/chapter.md', 'new template')
    failed.reject(new Error('permission denied'))
    expect(await failing).toBe('stale')
    expect(session.getSnapshot().error).toBeNull()
  })

  it('invalidates a pending read when the editor is unmounted', async () => {
    const { session, read } = fixture()
    const pending = deferred<string | null>()
    read.mockImplementationOnce(() => pending.promise)
    const opening = session.open(path)
    session.cancelLoad()
    pending.resolve('late')
    expect(await opening).toBe('stale')
    expect(session.getSnapshot().content).not.toBe('late')
  })

  it('distinguishes read failures from missing files and does not substitute a template', async () => {
    const { session, read } = fixture()
    read.mockRejectedValueOnce(new Error('EACCES'))
    expect(await session.open(path, 'not an original')).toBe('error')
    expect(session.getSnapshot()).toMatchObject({
      loaded: false,
      loading: false
    })
    expect(session.getSnapshot().content).toBe('')
    expect(session.getSnapshot().error).toBeTruthy()
    expect(await session.save()).toBe(false)
    expect(await session.open('/missing', 'actual missing template')).toBe(
      'missing'
    )
    expect(session.getSnapshot().content).toBe('actual missing template')
  })

  it.each(['resolved failure', 'exception'])(
    'retains draft after a %s saving',
    async (failure) => {
      const { session, drafts, files, write } = fixture()
      await session.open(path)
      session.update('do not lose this')
      if (failure === 'exception')
        write.mockRejectedValueOnce(new Error('ENOSPC'))
      else write.mockResolvedValueOnce({ success: false, error: 'ENOSPC' })
      expect(await session.save()).toBe(false)
      expect(session.getSnapshot()).toMatchObject({
        content: 'do not lose this',
        saved: false,
        saving: false
      })
      expect(drafts.read(path)?.content).toBe('do not lose this')
      expect(files.get(path)).toBe('original')
    }
  )

  it('does not mark later typing as saved or permit dependent work after an older save', async () => {
    const { session, drafts, write, files } = fixture()
    await session.open(path)
    session.update('revision one')
    const commit = deferred<{ success: boolean }>()
    write.mockImplementationOnce(async (_path, content) => {
      await commit.promise
      files.set(path, content)
      return { success: true }
    })
    const saving = session.save()
    await Promise.resolve()
    expect(session.getSnapshot().saving).toBe(true)
    session.update('revision two')
    commit.resolve({ success: true })
    expect(await saving).toBe(false)
    expect(files.get(path)).toBe('revision one')
    expect(session.getSnapshot()).toMatchObject({
      content: 'revision two',
      saved: false,
      baseContent: 'revision one'
    })
    expect(drafts.read(path)).toMatchObject({
      content: 'revision two',
      baseContent: 'revision one'
    })
    expect(await session.save()).toBe(true)
    expect(files.get(path)).toBe('revision two')
  })

  it('never replaces dirty content on reload and requires an explicit conflict overwrite', async () => {
    const { session, files, write } = fixture()
    await session.open(path)
    session.update('local change')
    files.set(path, 'generated elsewhere')
    await session.open(path)
    expect(session.getSnapshot()).toMatchObject({
      content: 'local change',
      diskContent: 'generated elsewhere',
      conflict: true
    })
    expect(await session.save()).toBe(false)
    expect(write).not.toHaveBeenCalled()
    expect(files.get(path)).toBe('generated elsewhere')
    expect(await session.save(undefined, true)).toBe(true)
    expect(files.get(path)).toBe('local change')
  })

  it('handles a change between pre-save read and the atomic write without losing the draft', async () => {
    const { session, files, write, drafts } = fixture()
    await session.open(path)
    session.update('local change')
    write.mockImplementationOnce(async () => {
      files.set(path, 'changed during save')
      return { success: false, error: 'FILE_CONFLICT' }
    })
    expect(await session.save()).toBe(false)
    expect(session.getSnapshot()).toMatchObject({
      saved: false,
      conflict: true,
      diskContent: 'changed during save'
    })
    expect(drafts.read(path)?.content).toBe('local change')
    expect(files.get(path)).toBe('changed during save')
  })

  it('detects conflicts on recovery and can explicitly discard without any disk write', async () => {
    const { session, drafts, files, read, write } = fixture()
    await session.open(path)
    session.update('old draft')
    files.set(path, 'new original')
    const restored = new DocumentSession({ read, write }, drafts)
    await restored.open(path)
    expect(restored.getSnapshot()).toMatchObject({
      content: 'new original',
      conflict: true
    })
    restored.restoreDraft()
    expect(restored.getSnapshot().content).toBe('old draft')
    expect(await restored.save()).toBe(false)
    restored.discardDraft()
    expect(restored.getSnapshot()).toMatchObject({
      saved: true,
      content: 'new original',
      conflict: false,
      recovery: null
    })
    expect(drafts.read(path)).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it('surfaces quota failure instead of claiming durable recovery', async () => {
    const { session, storage } = fixture()
    await session.open(path)
    storage.setItem.mockImplementationOnce(() => {
      throw new Error('QuotaExceededError')
    })
    session.update('only in memory')
    expect(session.getSnapshot().persistenceError).toBeTruthy()
    expect(session.getSnapshot().content).toBe('only in memory')
    session.retryDraftPersistence()
    expect(session.getSnapshot().persistenceError).toBeNull()
  })

  it('preserves an unreadable recovery record across retries until explicitly discarded', async () => {
    const { session, records, storage, write } = fixture()
    const key = `feicai:text-draft:v1:${encodeURIComponent(path)}`
    records.set(key, '{damaged-but-not-discarded')
    await session.open(path)
    expect(session.getSnapshot().draftReadError).toBe(true)
    session.update('must not replace damaged recovery silently')
    session.retryDraftPersistence()
    expect(records.get(key)).toBe('{damaged-but-not-discarded')
    expect(storage.removeItem).not.toHaveBeenCalled()
    expect(await session.save()).toBe(false)
    expect(write).not.toHaveBeenCalled()
    session.discardDraft()
    expect(records.has(key)).toBe(false)
    expect(session.getSnapshot()).toMatchObject({
      draftReadError: false,
      content: 'original'
    })
  })
})

describe('navigation and window closing protection', () => {
  it('asks before leaving and blocks beforeunload until the draft is saved or explicitly discarded', async () => {
    const { session } = fixture()
    cleanups.push(registerDocumentSession(session))
    await session.open(path)
    const ask = vi.fn(() => false)
    expect(confirmDocumentLeave(ask)).toBe(true)
    expect(ask).not.toHaveBeenCalled()
    session.update('dirty')
    expect(confirmDocumentLeave(ask)).toBe(false)
    expect(ask).toHaveBeenCalledOnce()
    const preventDefault = vi.fn()
    const event = {
      preventDefault,
      returnValue: undefined
    } as unknown as BeforeUnloadEvent
    guardDocumentUnload(event)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(event.returnValue).toBe('')
    session.discardDraft()
    expect(hasUnsavedDocuments()).toBe(false)
    guardDocumentUnload(event)
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('protects page, episode and browser history transitions without changing the current file', async () => {
    const { session } = fixture()
    cleanups.push(registerDocumentSession(session))
    await session.open(path)
    const router = createMemoryRouter([{ path: '*', element: null }], {
      initialEntries: ['/project/a/source', '/project/a/script?ep=1'],
      initialIndex: 1
    })
    cleanups.push(() => router.dispose())
    session.update('unsaved')
    router.getBlocker('draft', () => hasUnsavedDocuments())
    await router.navigate('/project/a/script?ep=2')
    expect(router.state.location.search).toBe('?ep=1')
    router.state.blockers.get('draft')?.reset?.()
    await router.navigate('/project/b/source')
    expect(router.state.location.pathname).toBe('/project/a/script')
    router.state.blockers.get('draft')?.reset?.()
    await router.navigate(-1)
    // A POP notification is delivered in a microtask by memory history.
    await Promise.resolve()
    expect(router.state.location.pathname).toBe('/project/a/script')
    router.state.blockers.get('draft')?.proceed?.()
    await Promise.resolve()
    expect(router.state.location.pathname).toBe('/project/a/source')
    expect(session.getSnapshot().content).toBe('unsaved')
  })

  it('warns that memory-only edits can be lost if local persistence failed', async () => {
    const { session, storage } = fixture()
    cleanups.push(registerDocumentSession(session))
    await session.open(path)
    storage.setItem.mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    session.update('memory only')
    const ask = vi.fn((_message: string) => false)
    expect(confirmDocumentLeave(ask)).toBe(false)
    expect(ask.mock.calls[0][0]).toContain('可能丢失')
  })
})
