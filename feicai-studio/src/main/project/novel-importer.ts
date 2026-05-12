import { basename, join } from 'path'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import type { ProjectConfig } from '@shared/types'
import { resolveProjectArtifactPath, resolveProjectLayout } from '@shared/path-resolver'
import type { SourceChapterItem } from '@shared/ipc-contracts'

interface NovelChapter {
  index: number
  title: string
  content: string
}

interface ImportWholeNovelFileParams {
  sourceFilePath: string
  projectPath: string
  config: ProjectConfig
}

const CHAPTER_TITLE_PATTERNS: RegExp[] = [
  /^第\s*[0-9０-９一二三四五六七八九十百千万零〇两]+\s*[章节卷回部集]\s*[\s:：、.-]*(.*)$/u,
  /^(?:chapter|chap\.?)\s*\d+\s*[\s:：、.-]*(.*)$/iu,
  /^(?:正文|序章|楔子|引子|尾声|番外)(?:\s*[\s:：、.-].*)?$/u,
  /^[=-]{3,}\s*[^=-]{0,40}\s*[=-]{3,}$/u
]

function normalizeNovelText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

function isChapterTitle(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length > 80) return false
  return CHAPTER_TITLE_PATTERNS.some((pattern) => pattern.test(trimmed))
}

function startsWithRepeatedTitle(line: string, currentTitle: string): boolean {
  const trimmed = line.trim()
  return trimmed.length > currentTitle.length && trimmed.startsWith(currentTitle)
}

function sanitizeChapterFilename(title: string, index: number): string {
  const safeTitle = title
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 32)
  const prefix = `chapter-${String(index).padStart(3, '0')}`
  return safeTitle ? `${prefix}-${safeTitle}.md` : `${prefix}.md`
}

export function splitNovelIntoChapters(rawText: string): NovelChapter[] {
  const text = normalizeNovelText(rawText)
  if (!text) return []

  const lines = text.split('\n')
  const chapters: NovelChapter[] = []
  let currentTitle = '全文'
  let currentLines: string[] = []
  let hasSeenChapter = false

  const flush = () => {
    const content = currentLines.join('\n').trim()
    if (!content && chapters.length > 0) return
    chapters.push({
      index: chapters.length + 1,
      title: currentTitle,
      content
    })
  }

  for (const line of lines) {
    if (isChapterTitle(line) && !startsWithRepeatedTitle(line, currentTitle)) {
      if (hasSeenChapter || currentLines.some((item) => item.trim())) {
        flush()
      }
      currentTitle = line.trim()
      currentLines = []
      hasSeenChapter = true
      continue
    }
    currentLines.push(line)
  }

  flush()
  return chapters
}

export function buildNormalizedNovelMarkdown(params: {
  projectName: string
  sourceFileName: string
  chapters: NovelChapter[]
}): string {
  const chapterCount = params.chapters.length
  const parts = [
    '# 小说原文',
    '',
    `> 项目：${params.projectName}`,
    `> 来源文件：${params.sourceFileName}`,
    `> 识别章节数：${chapterCount}`,
    '',
    '---',
    ''
  ]

  for (const chapter of params.chapters) {
    parts.push(`## ${chapter.title}`)
    parts.push('')
    parts.push(chapter.content)
    parts.push('')
  }

  return `${parts.join('\n').trim()}\n`
}

export function importWholeNovelFile(
  params: ImportWholeNovelFileParams
): { chapterCount: number; sourcePath: string; chaptersDir: string } {
  const rawText = readFileSync(params.sourceFilePath, 'utf-8')
  const chapters = splitNovelIntoChapters(rawText)
  const layout = resolveProjectLayout(params.config)
  const sourcePath = resolveProjectArtifactPath(
    params.projectPath,
    'sourceNovel',
    params.config
  )
  const chaptersDir = join(params.projectPath, layout.sourceDir, 'chapters')

  mkdirSync(chaptersDir, { recursive: true })
  writeFileSync(
    sourcePath,
    buildNormalizedNovelMarkdown({
      projectName: params.config.projectName,
      sourceFileName: basename(params.sourceFilePath),
      chapters
    }),
    'utf-8'
  )

  for (const chapter of chapters) {
    const chapterPath = join(
      chaptersDir,
      sanitizeChapterFilename(chapter.title, chapter.index)
    )
    writeFileSync(
      chapterPath,
      `# ${chapter.title}\n\n${chapter.content.trim()}\n`,
      'utf-8'
    )
  }

  return {
    chapterCount: chapters.length,
    sourcePath,
    chaptersDir
  }
}

function getChapterIndexFromFileName(fileName: string): number {
  const match = fileName.match(/^chapter-(\d+)/i)
  return match ? Number(match[1]) : 0
}

function getChapterTitleFromFile(filePath: string, fileName: string): string {
  try {
    const firstLine = readFileSync(filePath, 'utf-8').split(/\r?\n/, 1)[0] || ''
    const title = firstLine.replace(/^#\s*/, '').trim()
    if (title) return title
  } catch {
    // 回退到文件名解析。
  }
  return fileName
    .replace(/^chapter-\d+-?/i, '')
    .replace(/\.md$/i, '')
    .replace(/-/g, ' ')
    .trim()
}

export function listSourceChapters(params: {
  projectPath: string
  config: ProjectConfig
}): SourceChapterItem[] {
  const layout = resolveProjectLayout(params.config)
  const chaptersDir = join(params.projectPath, layout.sourceDir, 'chapters')
  if (!existsSync(chaptersDir)) return []

  return readdirSync(chaptersDir)
    .filter((fileName) => /^chapter-\d+.*\.md$/i.test(fileName))
    .map((fileName) => {
      const filePath = join(chaptersDir, fileName)
      return {
        index: getChapterIndexFromFileName(fileName),
        title: getChapterTitleFromFile(filePath, fileName),
        fileName,
        filePath
      }
    })
    .sort((a, b) => a.index - b.index || a.fileName.localeCompare(b.fileName))
}
