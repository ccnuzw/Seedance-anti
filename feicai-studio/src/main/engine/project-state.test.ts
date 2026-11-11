import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ProjectStatePersistence } from './project-state'
import { resolveProjectArtifactPath } from '@shared/path-resolver'
const roots: string[] = []
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'feicai-state-')))
  roots.push(root)
  return {
    root,
    state: new ProjectStatePersistence(root, 'current-id'),
    path: resolveProjectArtifactPath(root, 'pipelineState')
  }
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('project state atomic transactions', () => {
  it('serializes independent instances without losing stage snapshots', async () => {
    const { root, state, path } = fixture()
    const other = new ProjectStatePersistence(root, 'current-id')
    await Promise.all([
      state.markStageRunning(1, 'director'),
      other.markStageRunning(1, 'art')
    ])
    const saved = JSON.parse(readFileSync(path, 'utf8'))
    expect(saved.episodes['1'].stageStates.director.attempts).toBe(1)
    expect(saved.episodes['1'].stageStates.art.attempts).toBe(1)
    await state.markStageRunning(1, 'director')
    expect(
      JSON.parse(readFileSync(path, 'utf8')).episodes['1'].stageStates.director
        .attempts
    ).toBe(2)
  })
  it('recovers a damaged primary from the last valid backup and reports unrecoverable corruption', async () => {
    const { state, path } = fixture()
    await state.markStageRunning(1, 'director')
    await state.markStageRunning(1, 'art')
    writeFileSync(path, '{bad')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await state.load()).episodes[1]?.stageStates.director).toBeTruthy()
    expect(console.warn).toHaveBeenCalled()
    writeFileSync(path, '{bad')
    writeFileSync(`${path}.bak`, '{bad')
    await expect(state.load()).rejects.toThrow('损坏')
  })
  it('restores current project identity and removes pointers outside the new root without deleting history', async () => {
    const { state, path } = fixture()
    await state.markStageRunning(1, 'director', {
      outputPath: '/old-project/director.md'
    })
    const saved = JSON.parse(readFileSync(path, 'utf8'))
    saved.projectId = 'old-id'
    saved.episodes['1'].stageStates.director.reviewPath =
      '/old-project/review.md'
    writeFileSync(path, JSON.stringify(saved))
    const loaded = await state.load()
    expect(loaded.projectId).toBe('current-id')
    expect(loaded.episodes[1]?.stageStates.director?.outputPath).toBeUndefined()
    expect(loaded.episodes[1]?.stageStates.director?.reviewPath).toBeUndefined()
    expect(loaded.episodes[1]?.stageStates.director?.attempts).toBe(1)
  })
})
