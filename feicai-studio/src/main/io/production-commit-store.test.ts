import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type { ProjectConfig } from '@shared/types'
import { getProductionPaths } from '@shared/production-contracts'
import { productionFixture } from '@shared/production-contracts/fixtures'
import { resolveProjectLayout } from '@shared/path-resolver'
import {
  ProductionCommitStore,
  commitHash,
  hasUncommittedProductionWrites
} from './production-commit-store'

let root: string
const config: Partial<ProjectConfig> = {
  directories: { outputsDir: 'custom-output' }
}
function put(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'production-commit-')))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

async function prepare(store: ProductionCommitStore) {
  const intent = await store.intent(
    'operation',
    'review:script:1',
    commitHash('input'),
    [1]
  )
  return store.prepare(
    intent,
    [
      {
        path: join(root, 'inventory.md'),
        expected: null,
        content: 'consumed exactly once'
      },
      { path: join(root, 'review.md'), expected: null, content: 'PASS' },
      {
        path: join(root, 'state.json'),
        expected: null,
        content: '{"status":"passed"}'
      }
    ],
    { passed: true }
  )
}

describe('recoverable production file installation', () => {
  it.each([
    'intent',
    'prepared',
    'installed:0',
    'installed:1',
    'installed:2',
    'committed',
    'projection',
    'receipt'
  ])(
    'recovers a fresh instance twice after %s without repeating publication',
    async (boundary) => {
      const project = vi.fn().mockResolvedValue(undefined)
      const store = new ProductionCommitStore(root, config, (point) => {
        if (point === boundary) throw new Error('crash')
      })
      await expect(
        (async () => {
          const record = await prepare(store)
          await store.install(record)
          await store.recover(project)
        })()
      ).rejects.toThrow('crash')
      const fresh = new ProductionCommitStore(root, config)
      if (boundary === 'intent') {
        await fresh.recover(project)
        expect(existsSync(join(root, 'inventory.md'))).toBe(false)
        await fresh.install(await prepare(fresh))
      }
      await fresh.recover(project)
      const before = fresh.list()
      await new ProductionCommitStore(root, config).recover(project)
      expect(fresh.list()).toEqual(before)
      expect(readFileSync(join(root, 'inventory.md'), 'utf8')).toBe(
        'consumed exactly once'
      )
      expect(readFileSync(join(root, 'review.md'), 'utf8')).toBe('PASS')
      expect(fresh.list()[0]).toMatchObject({
        phase: 'committed',
        projected: true,
        result: { passed: true }
      })
      expect(project).toHaveBeenCalledTimes(boundary === 'projection' ? 2 : 1)
      expect(fresh.directory).toContain('custom-output')
    }
  )

  it.each([0, 1, 2])(
    'rejects an unknown hash in any member (%i), including already installed members, before further writes',
    async (index) => {
      const store = new ProductionCommitStore(root, config, (point) => {
        if (point === 'installed:0') throw new Error('crash')
      })
      const record = await prepare(store)
      await expect(store.install(record)).rejects.toThrow('crash')
      const changed = join(root, record.files[index].path)
      put(changed, 'manual edit')
      const snapshot = record.files.map((file) =>
        existsSync(join(root, file.path))
          ? readFileSync(join(root, file.path), 'utf8')
          : null
      )
      const project = vi.fn()
      await expect(
        new ProductionCommitStore(root, config).recover(project)
      ).rejects.toThrow('FILE_CONFLICT')
      expect(
        record.files.map((file) =>
          existsSync(join(root, file.path))
            ? readFileSync(join(root, file.path), 'utf8')
            : null
        )
      ).toEqual(snapshot)
      expect(project).not.toHaveBeenCalled()
      expect(hasUncommittedProductionWrites(root, config)).toBe(true)
    }
  )

  it.each(['before-install', 'installed:0', 'installed:1'])(
    'stops before the next artifact when the prepared journal changes at %s',
    async (boundary) => {
      const changeJournal = (store: ProductionCommitStore) => {
        const path = join(
          store.directory,
          readdirSync(store.directory).find((name) => name.endsWith('.json'))!
        )
        // Still valid JSON and schema: a different prepared record is not ours.
        const changed = JSON.parse(readFileSync(path, 'utf8'))
        changed.result = { external: true }
        put(path, JSON.stringify(changed, null, 2))
        return path
      }
      const store = new ProductionCommitStore(root, config, (point) => {
        if (point === boundary) changeJournal(store)
      })
      const record = await prepare(store)
      if (boundary === 'before-install') changeJournal(store)
      await expect(store.install(record)).rejects.toThrow('FILE_CONFLICT')
      const installed =
        boundary === 'before-install' ? 0 : Number(boundary.slice(-1)) + 1
      for (const [index, file] of record.files.entries()) {
        expect(existsSync(join(root, file.path))).toBe(index < installed)
      }
      expect(store.list()[0]).toMatchObject({
        phase: 'prepared',
        result: { external: true }
      })
    }
  )

  it('fences operation subkeys and input reuse, and guards intent inputs against external edits', async () => {
    const store = new ProductionCommitStore(root, config)
    const record = await prepare(store)
    await store.install(record)
    expect(
      await store.intent(
        'operation',
        'review:script:1',
        commitHash('input'),
        [1]
      )
    ).toMatchObject({ phase: 'committed' })
    await expect(
      store.intent('operation', 'review:script:1', commitHash('new input'), [1])
    ).rejects.toThrow('禁止复用')
    const input = join(root, 'input.md')
    put(input, 'original')
    const next = await store.intent(
      'operation',
      'review:art:1',
      commitHash('art'),
      [1],
      [input]
    )
    put(input, 'external')
    await expect(store.prepare(next, [])).rejects.toThrow('FILE_CONFLICT')
    expect(store.list()).toHaveLength(2)
  })

  it.each(['{"schemaVersion":99}', '{broken'])(
    'fails closed for unknown/corrupt journals without falling back to a stale backup (%s)',
    async (text) => {
      const store = new ProductionCommitStore(root, config)
      await prepare(store)
      const journal = join(
        store.directory,
        readdirSync(store.directory).find((name) => name.endsWith('.json'))!
      )
      put(`${journal}.bak`, readFileSync(journal, 'utf8'))
      put(journal, text)
      const before = readFileSync(journal, 'utf8')
      expect(hasUncommittedProductionWrites(root, config)).toBe(true)
      await expect(
        new ProductionCommitStore(root, config).recover()
      ).rejects.toThrow()
      expect(readFileSync(journal, 'utf8')).toBe(before)
      expect(existsSync(join(root, 'inventory.md'))).toBe(false)
    }
  )

  it('does not grant a prepared review after its source was edited during interruption', async () => {
    const input = join(root, 'script.md')
    put(input, 'reviewed script')
    const store = new ProductionCommitStore(root, config, (point) => {
      if (point === 'installed:0') throw new Error('crash')
    })
    const intent = await store.intent(
      'operation',
      'guarded-review',
      commitHash('reviewed script'),
      [1],
      [input]
    )
    const record = await store.prepare(intent, [
      { path: join(root, 'inventory.md'), expected: null, content: 'consumed' },
      { path: join(root, 'review.md'), expected: null, content: 'PASS' }
    ])
    await expect(store.install(record)).rejects.toThrow('crash')
    put(input, 'external edit')
    await expect(
      new ProductionCommitStore(root, config).recover()
    ).rejects.toThrow('FILE_CONFLICT')
    expect(existsSync(join(root, 'review.md'))).toBe(false)
    expect(readFileSync(input, 'utf8')).toBe('external edit')
  })

  it('does not overwrite an externally changed journal while advancing its phase', async () => {
    const store = new ProductionCommitStore(root, config)
    const intent = await store.intent(
      'operation',
      'journal-guard',
      commitHash('input'),
      [1]
    )
    const journal = join(
      store.directory,
      readdirSync(store.directory).find((name) => name.endsWith('.json'))!
    )
    const external = readFileSync(journal, 'utf8') + '\n'
    put(journal, external)
    await expect(
      store.prepare(intent, [
        {
          path: join(root, 'output.md'),
          expected: null,
          content: 'publication'
        }
      ])
    ).rejects.toThrow('FILE_CONFLICT')
    expect(readFileSync(journal, 'utf8')).toBe(external)
    expect(existsSync(join(root, 'output.md'))).toBe(false)
  })

  it('does not create files during queries on legacy projects or prepared journals', async () => {
    const store = new ProductionCommitStore(root, config)
    expect(store.list()).toEqual([])
    expect(hasUncommittedProductionWrites(root, config)).toBe(false)
    expect(readdirSync(root)).toEqual([])
    await prepare(store)
    const before = readdirSync(store.directory)
    expect(hasUncommittedProductionWrites(root, config)).toBe(true)
    expect(readdirSync(store.directory)).toEqual(before)
    expect(existsSync(join(root, 'inventory.md'))).toBe(false)
  })

  it('rejects linked targets, escaped writes and journals that attempt to overwrite their own logs', async () => {
    const outside = realpathSync(
      mkdtempSync(join(tmpdir(), 'production-outside-'))
    )
    try {
      const store = new ProductionCommitStore(root, config)
      const intent = await store.intent(
        'operation',
        'unsafe',
        commitHash('input'),
        [1]
      )
      symlinkSync(outside, join(root, 'linked'))
      await expect(
        store.prepare(intent, [
          {
            path: join(root, 'linked', 'file'),
            content: 'unsafe',
            expected: null
          }
        ])
      ).rejects.toThrow()
      await expect(
        store.prepare(intent, [
          { path: join(outside, 'file'), content: 'unsafe', expected: null }
        ])
      ).rejects.toThrow()
      await expect(
        store.prepare(intent, [
          {
            path: join(store.directory, 'overwrite.json'),
            content: 'unsafe',
            expected: null
          }
        ])
      ).rejects.toThrow()
      expect(readdirSync(outside)).toEqual([])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('installs a valid manifest and refuses replacement of immutable version history', async () => {
    const store = new ProductionCommitStore(root)
    const path = join(root, getProductionPaths(resolveProjectLayout()).manifest)
    const fixture = productionFixture()
    const content = JSON.stringify(fixture)
    const intent = await store.intent(
      'manifest-create',
      'manifest',
      commitHash(content),
      [1]
    )
    await store.install(
      await store.prepare(intent, [{ path, expected: null, content }])
    )
    expect(readFileSync(path, 'utf8')).toBe(content)
    fixture.scriptRevisions[0].markdown = '# External replacement of history'
    const update = JSON.stringify(fixture)
    const next = await store.intent(
      'manifest-update',
      'manifest',
      commitHash(update),
      [1]
    )
    await expect(
      store.prepare(next, [{ path, expected: content, content: update }])
    ).rejects.toThrow('manifest拒写')
    expect(readFileSync(path, 'utf8')).toBe(content)
  })

  it('validates every manifest update and refuses unknown schema before preparing or writing it', async () => {
    const store = new ProductionCommitStore(root, config)
    const intent = await store.intent(
      'operation',
      'manifest',
      commitHash('unknown manifest'),
      []
    )
    const manifest = join(
      root,
      getProductionPaths(resolveProjectLayout(config)).manifest
    )
    await expect(
      store.prepare(intent, [
        { path: manifest, expected: null, content: '{"schemaVersion":99}' }
      ])
    ).rejects.toThrow('manifest拒写')
    expect(store.get('operation', 'manifest')?.phase).toBe('intent')
    expect(existsSync(manifest)).toBe(false)
  })
})
