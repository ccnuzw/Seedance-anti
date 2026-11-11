import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project } from '@shared/types'
import { normalizeProjectConfig } from '@shared/project-config'
import { backupProjectFiles, restoreProjectFiles } from './project-backup'

let root: string
let project: Project
let backups: string
let restores: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'feicai-backup-test-'))
  const projectPath = join(root, 'project')
  backups = join(root, 'backups')
  restores = join(root, 'restores')
  await Promise.all([
    mkdir(join(projectPath, 'custom', 'scripts'), { recursive: true }),
    mkdir(backups),
    mkdir(restores)
  ])
  project = {
    id: 'project',
    name: '恢复项目',
    projectPath,
    visualStyle: '写实',
    targetMedium: '短剧',
    totalEpisodes: 30,
    config: normalizeProjectConfig({
      projectName: '恢复项目',
      totalEpisodes: 30,
      directories: { scriptDir: 'custom/scripts' }
    }),
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01'
  }
  await writeFile(
    join(projectPath, 'custom', 'scripts', 'ep01.md'),
    '# 第一集\n真实正文'
  )
  await mkdir(join(projectPath, 'empty'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('project backups', () => {
  it('restores bytes, empty directories, custom layout and planned count without touching the source', async () => {
    const backup = await backupProjectFiles(project, backups)
    await writeFile(
      join(project.projectPath, 'custom', 'scripts', 'ep01.md'),
      '备份后的新正文'
    )
    const restored = await restoreProjectFiles(backup, restores)
    expect(
      await readFile(
        join(restored.path, 'custom', 'scripts', 'ep01.md'),
        'utf8'
      )
    ).toBe('# 第一集\n真实正文')
    expect(await readdir(join(restored.path, 'empty'))).toEqual([])
    expect(restored.project.totalEpisodes).toBe(30)
    expect(restored.project.config.directories?.scriptDir).toBe(
      'custom/scripts'
    )
    expect(
      await readFile(
        join(project.projectPath, 'custom', 'scripts', 'ep01.md'),
        'utf8'
      )
    ).toBe('备份后的新正文')
  })

  it('rejects tampered content and removes only its incomplete restore directory', async () => {
    const backup = await backupProjectFiles(project, backups)
    await writeFile(
      join(backup, 'files', 'custom', 'scripts', 'ep01.md'),
      'tampered'
    )
    await writeFile(join(restores, 'keep.txt'), 'unrelated')
    await expect(restoreProjectFiles(backup, restores)).rejects.toThrow(
      '完整性'
    )
    expect(await readdir(restores)).toEqual(['keep.txt'])
  })

  it('rejects manifest traversal before creating an outside file', async () => {
    const backup = await backupProjectFiles(project, backups)
    const manifestPath = join(backup, 'feicai-backup.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.files[0].path = '../escape.md'
    await writeFile(manifestPath, JSON.stringify(manifest))
    await expect(restoreProjectFiles(backup, restores)).rejects.toThrow(
      '相对路径'
    )
    expect(await readdir(restores)).toEqual([])
  })

  it('rejects dangling links and backup destinations inside the project', async () => {
    await symlink(join(root, 'missing'), join(project.projectPath, 'linked'))
    await expect(backupProjectFiles(project, backups)).rejects.toThrow()
    expect(await readdir(backups)).toEqual([])
    await expect(
      backupProjectFiles(project, project.projectPath)
    ).rejects.toThrow('源项目内部')
  })
})
