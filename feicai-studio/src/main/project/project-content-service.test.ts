import { writeFile } from 'fs/promises'
import { mkdtempSync } from 'fs'
import { mkdir, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { NovelManager } from '../engine/novel-manager'
import {
  generateEpisodeScript,
  listEpisodeOutlines,
  readNovelContent,
  saveEpisodeOutline,
  saveNovelContent
} from './project-content-service'

const tempDirs: string[] = []

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'feicai-project-content-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('project-content-service', () => {
  it('stores novel content and seeds project config metadata for later loading', async () => {
    const projectPath = makeProjectDir()

    await saveNovelContent({
      projectPath,
      content: '# 夜雨来信\n\n第一章内容。',
      title: '夜雨来信',
      genre: '悬疑',
      sourcePath: '/tmp/night-rain.txt'
    })

    const novel = await readNovelContent(projectPath)

    expect(novel).toMatchObject({
      title: '夜雨来信',
      genre: '悬疑',
      sourcePath: '/tmp/night-rain.txt'
    })
    expect(novel?.content).toContain('第一章内容')
  })

  it('persists episode outlines and generates ep001 script from the outline', async () => {
    const projectPath = makeProjectDir()

    await saveNovelContent({
      projectPath,
      content: '第一章：少女收到来信，决定回到故乡调查。',
      title: '夜雨来信',
      genre: '悬疑'
    })

    await saveEpisodeOutline({
      projectPath,
      episodeNumber: 1,
      outline: {
        title: '归乡',
        summary: '少女收到匿名来信后回到故乡，发现旧案线索再次浮现。',
        logline: '一封旧信逼迫女主回到噩梦开始的地方。',
        sourceChapters: [1, 2],
        scenes: [
          {
            title: '雨夜来信',
            summary: '女主在出租屋收到一封匿名来信。',
            beats: ['拆开信封', '看到熟悉署名'],
            sourceChapters: [1]
          },
          {
            title: '重返故乡',
            summary: '她在暴雨中回到阔别多年的小镇。',
            beats: ['站台下车', '看见旧警戒线'],
            sourceChapters: [2]
          }
        ]
      }
    })

    const outlines = await listEpisodeOutlines(projectPath)
    const generated = await generateEpisodeScript({
      projectPath,
      episodeNumber: 1
    })
    const savedScript = await readFile(generated.filePath, 'utf-8')

    expect(outlines).toHaveLength(1)
    expect(outlines[0]).toMatchObject({
      episodeNumber: 1,
      title: '归乡'
    })
    expect(generated.filePath).toBe(join(projectPath, 'script', 'ep001.md'))
    expect(savedScript).toContain('# 归乡 剧本')
    expect(savedScript).toContain('> 集数：EP01')
    expect(savedScript).toContain('> 原著章节：1, 2')
    expect(savedScript).toContain('## 场景 1：雨夜来信')
    expect(savedScript).toContain('## 场景 2：重返故乡')
  })
})

describe('NovelManager', () => {
  it('imports a loose txt file as the next numbered novel chapter', async () => {
    const projectPath = makeProjectDir()
    const sourceDir = makeProjectDir()
    const manager = new NovelManager()

    await mkdir(join(projectPath, 'novel'), { recursive: true })
    await mkdir(sourceDir, { recursive: true })
    await mkdir(projectPath, { recursive: true })

    await saveNovelContent({
      projectPath,
      content: '已有正文',
      title: '夜雨来信',
      genre: '悬疑'
    })
    await writeFile(
      join(projectPath, 'plot-breakdown.md'),
      '# 剧情拆解\n\n**小说名称**：《夜雨来信》\n**小说类型**：悬疑\n\n---\n',
      'utf-8'
    )

    const looseFile = join(sourceDir, 'chapter-extra.txt')
    await writeFile(looseFile, '新增章节内容', 'utf-8')

    const result = await manager.importNovel(looseFile, projectPath)
    const importedContent = await readFile(join(projectPath, 'novel', 'chapter-0001.txt'), 'utf-8')
    const info = await manager.getNovelInfo(projectPath)

    expect(result).toEqual({ imported: 1 })
    expect(importedContent).toBe('新增章节内容')
    expect(info).toMatchObject({
      title: '夜雨来信',
      genre: '悬疑',
      totalChapters: 1
    })
  })
})
