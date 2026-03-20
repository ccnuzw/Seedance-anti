// ============================================================
// Novel Manager — 小说文件管理器
// ============================================================

import { readFile, readdir, stat, mkdir, copyFile } from 'fs/promises'
import { join, basename } from 'path'
import type { NovelInfo } from '@shared/types'

/** 章节文件匹配正则：chapter-0001.txt */
const CHAPTER_PATTERN = /^chapter-(\d{4})\.txt$/

export class NovelManager {
  /**
   * 扫描 novel/ 目录，统计章节信息
   */
  async scanNovelDir(novelDir: string): Promise<{
    totalChapters: number
    chapterRange: [number, number]
    chapterFiles: string[]
  }> {
    // 确保目录存在，不存在则自动创建
    await mkdir(novelDir, { recursive: true })
    const files = await readdir(novelDir)
    const chapterFiles = files
      .filter(f => CHAPTER_PATTERN.test(f))
      .sort()

    if (chapterFiles.length === 0) {
      return { totalChapters: 0, chapterRange: [0, 0], chapterFiles: [] }
    }

    const firstMatch = chapterFiles[0].match(CHAPTER_PATTERN)!
    const lastMatch = chapterFiles[chapterFiles.length - 1].match(CHAPTER_PATTERN)!

    return {
      totalChapters: chapterFiles.length,
      chapterRange: [parseInt(firstMatch[1]), parseInt(lastMatch[1])],
      chapterFiles
    }
  }

  /**
   * 按需读取指定范围的章节（从 startChapter 开始，读取 count 章）
   */
  async readChapters(
    novelDir: string,
    startChapter: number,
    count: number
  ): Promise<Array<{ chapter: number; filename: string; content: string }>> {
    const results: Array<{ chapter: number; filename: string; content: string }> = []

    for (let i = 0; i < count; i++) {
      const chapterNum = startChapter + i
      const filename = `chapter-${String(chapterNum).padStart(4, '0')}.txt`
      const filepath = join(novelDir, filename)

      try {
        const content = await readFile(filepath, 'utf-8')
        results.push({ chapter: chapterNum, filename, content })
      } catch {
        // 文件不存在，跳过
        break
      }
    }

    return results
  }

  /**
   * 获取小说元信息（从 plot-breakdown.md 头部解析）
   */
  async getNovelInfo(projectPath: string): Promise<NovelInfo | null> {
    const novelDir = join(projectPath, 'novel')
    const breakdownPath = join(projectPath, 'plot-breakdown.md')

    try {
      const scan = await this.scanNovelDir(novelDir)
      let title = ''
      let genre = ''

      try {
        const breakdown = await readFile(breakdownPath, 'utf-8')
        // 解析 plot-breakdown.md 头部
        const titleMatch = breakdown.match(/\*\*小说名称\*\*[：:]\s*《(.+?)》/)
        const genreMatch = breakdown.match(/\*\*小说类型\*\*[：:]\s*(.+)/)
        if (titleMatch) title = titleMatch[1]
        if (genreMatch) genre = genreMatch[1].trim()
      } catch {
        // plot-breakdown.md 不存在
      }

      return {
        title,
        genre,
        totalChapters: scan.totalChapters,
        chaptersDir: novelDir
      }
    } catch {
      return null
    }
  }

  /**
   * 导入小说文件到项目目录
   */
  async importNovel(
    sourcePath: string,
    projectPath: string
  ): Promise<{ imported: number }> {
    const novelDir = join(projectPath, 'novel')
    await mkdir(novelDir, { recursive: true })

    // 检查源路径是文件夹还是文件
    const srcStat = await stat(sourcePath)
    let imported = 0

    if (srcStat.isDirectory()) {
      // 源是目录，复制所有 chapter-*.txt 文件
      const files = await readdir(sourcePath)
      const chapterFiles = files.filter(f => CHAPTER_PATTERN.test(f))

      for (const file of chapterFiles) {
        await copyFile(join(sourcePath, file), join(novelDir, file))
        imported++
      }
    } else if (srcStat.isFile()) {
      // [R3-6] 源是单个文件，直接复制
      const fileName = basename(sourcePath)
      if (CHAPTER_PATTERN.test(fileName)) {
        await copyFile(sourcePath, join(novelDir, fileName))
        imported = 1
      } else if (fileName.endsWith('.txt')) {
        // 非标准命名的 .txt 文件，尝试作为下一个编号
        const existingScan = await this.scanNovelDir(novelDir).catch(() => ({ totalChapters: 0 }))
        const nextNum = existingScan.totalChapters + 1
        const newName = `chapter-${String(nextNum).padStart(4, '0')}.txt`
        await copyFile(sourcePath, join(novelDir, newName))
        imported = 1
      }
    }

    return { imported }
  }

  /**
   * 获取已拆解到第几章（从 plot-breakdown.md 解析最后一个批次的章节范围）
   */
  async getProcessedChapterCount(projectPath: string): Promise<number> {
    const breakdownPath = join(projectPath, 'plot-breakdown.md')

    try {
      const content = await readFile(breakdownPath, 'utf-8')
      // 匹配 "### 第X批（第X-X章）"
      const batchPattern = /### 第\d+批（第\d+-(\d+)章）/g
      let lastEnd = 0
      let match: RegExpExecArray | null

      while ((match = batchPattern.exec(content)) !== null) {
        const end = parseInt(match[1])
        if (end > lastEnd) lastEnd = end
      }

      return lastEnd
    } catch {
      return 0
    }
  }
}
