import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'fs'
import type * as FileSystem from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { normalizeProjectConfig } from '@shared/project-config'
import {
  importWholeNovelFile,
  invalidateSourceChapterCache,
  listSourceChapters
} from './novel-importer'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystem>()
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    readSync: vi.fn(actual.readSync)
  }
})

const config = normalizeProjectConfig({
  projectName: '章节索引',
  totalEpisodes: 30
})
const directories: string[] = []
beforeEach(() => {
  vi.clearAllMocks()
  invalidateSourceChapterCache()
})
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'feicai-chapter-metadata-'))
  directories.push(root)
  mkdirSync(join(root, 'source', 'chapters'), { recursive: true })
  return root
}

describe('chapter metadata index', () => {
  it('首扫只读取有限标题字节，后续及重载索引都不读取章节正文', () => {
    const root = createProject()
    const path = join(root, 'source', 'chapters', 'chapter-001.md')
    writeFileSync(path, `# 第一章\n\n${'正文'.repeat(1_000_000)}`)
    expect(listSourceChapters({ projectPath: root, config })[0].title).toBe(
      '第一章'
    )
    expect(readSync).toHaveBeenCalledTimes(1)
    expect(readSync).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Buffer),
      0,
      4096,
      0
    )
    expect(
      vi.mocked(readFileSync).mock.calls.some(([file]) => String(file) === path)
    ).toBe(false)
    vi.clearAllMocks()
    listSourceChapters({ projectPath: root, config })
    expect(readSync).not.toHaveBeenCalled()
    invalidateSourceChapterCache(root)
    expect(listSourceChapters({ projectPath: root, config })[0].title).toBe(
      '第一章'
    )
    expect(readSync).not.toHaveBeenCalled()
  })

  it('外部修改mtime使标题失效，新增和删除章节也会更新索引', () => {
    const root = createProject()
    const path = join(root, 'source', 'chapters', 'chapter-001.md')
    writeFileSync(path, '# 旧标题\n正文')
    listSourceChapters({ projectPath: root, config })
    writeFileSync(path, '# 新标题\n正文')
    const nextTime = new Date(Date.now() + 10_000)
    utimesSync(path, nextTime, nextTime)
    expect(listSourceChapters({ projectPath: root, config })[0].title).toBe(
      '新标题'
    )
    writeFileSync(
      join(root, 'source', 'chapters', 'chapter-002.md'),
      '# 第二章\n正文'
    )
    expect(
      listSourceChapters({ projectPath: root, config }).map(
        (chapter) => chapter.index
      )
    ).toEqual([1, 2])
    rmSync(path)
    expect(
      listSourceChapters({ projectPath: root, config }).map(
        (chapter) => chapter.index
      )
    ).toEqual([2])
  })

  it('无换行的大章节依然只读取固定大小前缀', () => {
    const root = createProject()
    writeFileSync(
      join(root, 'source', 'chapters', 'chapter-001.md'),
      'x'.repeat(2_000_000)
    )
    const [chapter] = listSourceChapters({ projectPath: root, config })
    expect(chapter.title.length).toBe(4096)
    expect(readSync).toHaveBeenCalledTimes(1)
    expect(readSync).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Buffer),
      0,
      4096,
      0
    )
  })

  it('重复导入及标题变化复用相同章节文件，并保留有效备份', async () => {
    const root = createProject()
    const source = join(root, 'book.txt')
    // Body prose must not itself be a valid stand-alone chapter heading.
    writeFileSync(
      source,
      '第1章 原标题\n这是第一章的正文。\n第2章 第二章\n这是第二章的正文。'
    )
    await importWholeNovelFile({
      projectPath: root,
      config,
      sourceFilePath: source
    })
    const originalNames = listSourceChapters({ projectPath: root, config }).map(
      (chapter) => chapter.fileName
    )
    expect(originalNames).toHaveLength(2)
    writeFileSync(
      source,
      '第1章 新标题\n更新内容\n第2章 第二章\n这是第二章的正文。'
    )
    await Promise.all([
      importWholeNovelFile({
        projectPath: root,
        config,
        sourceFilePath: source
      }),
      importWholeNovelFile({
        projectPath: root,
        config,
        sourceFilePath: source
      })
    ])
    const chapters = listSourceChapters({ projectPath: root, config })
    expect(chapters.map((chapter) => chapter.fileName)).toEqual(originalNames)
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      '第1章 新标题',
      '第2章 第二章'
    ])
    expect(readFileSync(chapters[0].filePath, 'utf-8')).toContain('更新内容')
    expect(readFileSync(chapters[1].filePath, 'utf-8')).toContain(
      '这是第二章的正文。'
    )
    expect(
      readdirSync(join(root, 'source', 'chapters')).filter((file) =>
        file.endsWith('.md')
      )
    ).toHaveLength(2)
    expect(readFileSync(`${chapters[0].filePath}.bak`, 'utf-8')).toContain(
      '更新内容'
    )
    expect(readFileSync(join(root, 'source', 'novel.md'), 'utf-8')).toContain(
      '## 第1章 新标题'
    )
    expect(
      readdirSync(join(root, 'source', 'chapters')).some((file) =>
        file.endsWith('.tmp')
      )
    ).toBe(false)
  })

  it('拒绝章节目录里的外链文件', () => {
    const root = createProject()
    const outside = mkdtempSync(join(tmpdir(), 'feicai-outside-chapter-'))
    directories.push(outside)
    writeFileSync(join(outside, 'chapter.md'), '# 外部标题')
    symlinkSync(
      join(outside, 'chapter.md'),
      join(root, 'source', 'chapters', 'chapter-001.md')
    )
    expect(() => listSourceChapters({ projectPath: root, config })).toThrow()
  })
})
