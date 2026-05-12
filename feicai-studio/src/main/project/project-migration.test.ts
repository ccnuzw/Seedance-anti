import { afterEach, describe, expect, it } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { migrateLegacyNovelDirectory } from './project-migration'

describe('project-migration', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('可以把旧版 novel 章节目录迁移为标准 source/novel.md', async () => {
    const root = mkdtempSync(join(tmpdir(), 'feicai-migration-'))
    tempDirs.push(root)

    mkdirSync(join(root, 'novel'), { recursive: true })
    writeFileSync(
      join(root, 'novel', 'chapter-0002.txt'),
      '第二章内容',
      'utf-8'
    )
    writeFileSync(
      join(root, 'novel', 'chapter-0001.txt'),
      '第一章内容',
      'utf-8'
    )

    const result = await migrateLegacyNovelDirectory(root, {
      projectName: '测试项目',
      totalEpisodes: 2
    })

    expect(result.success).toBe(true)
    expect(result.migrated).toBe(true)
    expect(result.migratedFiles).toBe(2)
    expect(result.sourcePath).toBe(join(root, 'source', 'novel.md'))
    expect(existsSync(result.sourcePath)).toBe(true)

    const content = readFileSync(result.sourcePath, 'utf-8')
    expect(content).toContain('> 项目：测试项目')
    expect(content.indexOf('## 第1章')).toBeLessThan(
      content.indexOf('## 第2章')
    )
  })
})
