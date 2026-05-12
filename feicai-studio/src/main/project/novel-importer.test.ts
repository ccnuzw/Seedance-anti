import { describe, expect, it } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  buildNormalizedNovelMarkdown,
  listSourceChapters,
  splitNovelIntoChapters
} from './novel-importer'
import { normalizeProjectConfig } from '@shared/project-config'

describe('novel-importer', () => {
  it('可以按中文章标题拆分整本小说', () => {
    const chapters = splitNovelIntoChapters(`
第1章 穿成恶女
第1章 穿成恶女陆青青连做三台重大手术。
她穿到了大乾国。

第2章 救人
第2章 救人为母则刚。
孩子活下来了。
`)

    expect(chapters).toHaveLength(2)
    expect(chapters[0]).toMatchObject({
      index: 1,
      title: '第1章 穿成恶女'
    })
    expect(chapters[0].content).toContain('陆青青连做三台重大手术')
    expect(chapters[1].title).toBe('第2章 救人')
  })

  it('可以识别不同章节分隔符并生成标准 markdown', () => {
    const chapters = splitNovelIntoChapters(`
楔子
故事开始。

Chapter 1: Arrival
英文章节内容。

第003回 风起
中文回目内容。
`)

    expect(chapters.map((chapter) => chapter.title)).toEqual([
      '楔子',
      'Chapter 1: Arrival',
      '第003回 风起'
    ])

    const markdown = buildNormalizedNovelMarkdown({
      projectName: '测试项目',
      sourceFileName: 'novel.txt',
      chapters
    })

    expect(markdown).toContain('> 项目：测试项目')
    expect(markdown).toContain('> 识别章节数：3')
    expect(markdown).toContain('## 第003回 风起')
  })

  it('可以从章节目录读取并按文件序号排序', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'feicai-chapters-'))
    try {
      const chaptersDir = join(projectPath, 'source', 'chapters')
      mkdirSync(chaptersDir, { recursive: true })
      writeFileSync(
        join(chaptersDir, 'chapter-010-尾声.md'),
        '# 尾声\n\n内容',
        'utf-8'
      )
      writeFileSync(
        join(chaptersDir, 'chapter-002-救人.md'),
        '# 第2章 救人\n\n内容',
        'utf-8'
      )
      writeFileSync(
        join(chaptersDir, 'notes.md'),
        '# 忽略文件\n',
        'utf-8'
      )

      const chapters = listSourceChapters({
        projectPath,
        config: normalizeProjectConfig({
          projectName: '测试项目',
          totalEpisodes: 12,
          visualStyle: '写实',
          targetMedium: '短剧'
        })
      })

      expect(chapters.map((chapter) => chapter.index)).toEqual([2, 10])
      expect(chapters.map((chapter) => chapter.title)).toEqual([
        '第2章 救人',
        '尾声'
      ])
      expect(chapters[0].filePath).toContain('chapter-002-救人.md')
    } finally {
      rmSync(projectPath, { recursive: true, force: true })
    }
  })
})
