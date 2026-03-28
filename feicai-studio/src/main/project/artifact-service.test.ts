import { mkdtempSync } from 'fs'
import { mkdir, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  exportArtifactsBundle,
  listArtifacts,
  rollbackArtifact,
  writeArtifactText
} from './artifact-service'

const tempDirs: string[] = []

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'feicai-artifacts-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('artifact-service', () => {
  it('tracks versions for the same canonical artifact', async () => {
    const projectPath = makeProjectDir()
    const scriptPath = join(projectPath, 'script', 'ep001.md')

    const first = await writeArtifactText({
      projectPath,
      kind: 'script_episode',
      filePath: scriptPath,
      content: '# 第1集：初稿',
      contentType: 'text/markdown',
      episodeNum: 1,
      createdBy: 'user'
    })

    const second = await writeArtifactText({
      projectPath,
      kind: 'script_episode',
      filePath: scriptPath,
      content: '# 第1集：定稿',
      contentType: 'text/markdown',
      episodeNum: 1,
      createdBy: 'user'
    })

    const artifacts = await listArtifacts({ projectPath, episodeNum: 1 })
    expect(first.version).toBe(1)
    expect(second.version).toBe(2)
    expect(artifacts.filter((artifact) => artifact.scopeKey === second.scopeKey)).toHaveLength(2)
    expect(artifacts.find((artifact) => artifact.isCurrent)?.version).toBe(2)
  })

  it('restores a previous version by creating a new current version', async () => {
    const projectPath = makeProjectDir()
    const scriptPath = join(projectPath, 'script', 'ep001.md')

    const first = await writeArtifactText({
      projectPath,
      kind: 'script_episode',
      filePath: scriptPath,
      content: '# 第1集：初稿',
      contentType: 'text/markdown',
      episodeNum: 1
    })

    const second = await writeArtifactText({
      projectPath,
      kind: 'script_episode',
      filePath: scriptPath,
      content: '# 第1集：定稿',
      contentType: 'text/markdown',
      episodeNum: 1
    })

    const restored = await rollbackArtifact({
      projectPath,
      artifactId: first.id
    })

    const currentContent = await readFile(scriptPath, 'utf-8')
    expect(restored.version).toBe(3)
    expect(restored.createdBy).toBe('rollback')
    expect(currentContent).toContain('初稿')
  })

  it('exports current artifacts and manifest into a delivery directory', async () => {
    const projectPath = makeProjectDir()
    const exportDir = join(projectPath, 'delivery')
    const scriptPath = join(projectPath, 'script', 'ep001.md')

    await writeArtifactText({
      projectPath,
      kind: 'script_episode',
      filePath: scriptPath,
      content: '# 第1集：交付稿',
      contentType: 'text/markdown',
      episodeNum: 1
    })

    await mkdir(join(projectPath, 'outputs'), { recursive: true })
    const bundle = await exportArtifactsBundle(projectPath, exportDir)
    const exportedScript = await readFile(join(exportDir, 'script', 'ep001.md'), 'utf-8')
    const exportedManifest = await readFile(bundle.manifestPath, 'utf-8')

    expect(exportedScript).toContain('交付稿')
    expect(exportedManifest).toContain('script_episode')
  })
})
