import { basename, join, sep } from 'path'
import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  statSync
} from 'fs'
import type { ProjectConfig } from '@shared/types'
import {
  resolveProjectArtifactPath,
  resolveProjectLayout
} from '@shared/path-resolver'
import type { SourceChapterItem } from '@shared/ipc-contracts'
import { assertPathWithinProject } from '../security/access-control'
import {
  atomicWriteFile,
  atomicWriteFileSync,
  readRegularFile
} from '../io/atomic-file'

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
  return (
    trimmed.length > currentTitle.length && trimmed.startsWith(currentTitle)
  )
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

interface ChapterMetadata extends SourceChapterItem {
  mtimeMs: number
  ctimeMs: number
  size: number
}
interface ChapterIndex {
  version: 1
  chapters: ChapterMetadata[]
}
const CHAPTER_HEADER_BYTES = 4096
const MAX_CHAPTER_INDEXES = 32
const chapterIndexes = new Map<string, ChapterIndex>()
const imports = new Map<
  string,
  Promise<{ chapterCount: number; sourcePath: string; chaptersDir: string }>
>()

export function invalidateSourceChapterCache(projectPath?: string): void {
  if (projectPath)
    projectPath = assertPathWithinProject(projectPath, projectPath)
  for (const directory of chapterIndexes.keys()) {
    if (
      !projectPath ||
      directory === projectPath ||
      directory.startsWith(`${projectPath}${sep}`)
    ) {
      chapterIndexes.delete(directory)
    }
  }
}

export function importWholeNovelFile(
  params: ImportWholeNovelFileParams
): Promise<{ chapterCount: number; sourcePath: string; chaptersDir: string }> {
  const root = assertPathWithinProject(params.projectPath, params.projectPath)
  // Serialize whole imports as well as individual writes: two imports must not
  // publish a source document from one book with chapters from another.
  const previous = imports.get(root) || Promise.resolve()
  const operation = previous
    .catch(() => {})
    .then(async () => {
      const rawText = (await readRegularFile(params.sourceFilePath)).toString(
        'utf-8'
      )
      const chapters = splitNovelIntoChapters(rawText)
      const layout = resolveProjectLayout(params.config)
      const sourcePath = assertPathWithinProject(
        root,
        resolveProjectArtifactPath(root, 'sourceNovel', params.config)
      )
      const chaptersDir = assertPathWithinProject(
        root,
        join(root, layout.sourceDir, 'chapters')
      )
      const existing = listSourceChapters({
        projectPath: root,
        config: params.config
      })
      const fileByIndex = new Map(
        existing.map((chapter) => [chapter.index, chapter.fileName])
      )
      mkdirSync(chaptersDir, { recursive: true })
      for (const chapter of chapters) {
        // Keep the same indexed filename even when an imported title changes.
        const fileName =
          fileByIndex.get(chapter.index) ||
          sanitizeChapterFilename(chapter.title, chapter.index)
        const chapterPath = assertPathWithinProject(
          root,
          join(chaptersDir, fileName)
        )
        await atomicWriteFile(
          chapterPath,
          `# ${chapter.title}\n\n${chapter.content.trim()}\n`
        )
      }
      await atomicWriteFile(
        sourcePath,
        buildNormalizedNovelMarkdown({
          projectName: params.config.projectName,
          sourceFileName: basename(params.sourceFilePath),
          chapters
        })
      )
      invalidateSourceChapterCache(root)
      listSourceChapters({ projectPath: root, config: params.config })
      return { chapterCount: chapters.length, sourcePath, chaptersDir }
    })
  imports.set(root, operation)
  void operation
    .finally(() => {
      if (imports.get(root) === operation) imports.delete(root)
    })
    .catch(() => {})
  return operation
}

function getChapterTitleFromFile(filePath: string, fileName: string): string {
  // Bound I/O even if a malformed chapter has no newline before its body.
  const fd = openSync(
    filePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0)
  )
  let firstLine: string
  try {
    const buffer = Buffer.allocUnsafe(CHAPTER_HEADER_BYTES)
    const length = readSync(fd, buffer, 0, buffer.length, 0)
    firstLine = buffer.toString('utf-8', 0, length).split(/\r?\n/, 1)[0] || ''
  } finally {
    closeSync(fd)
  }
  return (
    firstLine
      .replace(/^\uFEFF/, '')
      .replace(/^#\s*/, '')
      .trim() ||
    fileName
      .replace(/^chapter-\d+-?/i, '')
      .replace(/\.md$/i, '')
      .replace(/-/g, ' ')
      .trim()
  )
}

export function listSourceChapters(params: {
  projectPath: string
  config: ProjectConfig
  readOnly?: boolean
}): SourceChapterItem[] {
  const layout = resolveProjectLayout(params.config)
  const chaptersDir = assertPathWithinProject(
    params.projectPath,
    join(params.projectPath, layout.sourceDir, 'chapters')
  )
  if (!existsSync(chaptersDir)) {
    chapterIndexes.delete(chaptersDir)
    return []
  }
  const indexPath = assertPathWithinProject(
    params.projectPath,
    join(chaptersDir, '.chapter-index.json')
  )
  let index = chapterIndexes.get(chaptersDir)
  if (!index && existsSync(indexPath)) {
    try {
      const parsed = JSON.parse(
        readFileSync(indexPath, 'utf-8')
      ) as ChapterIndex
      if (
        parsed?.version === 1 &&
        Array.isArray(parsed.chapters) &&
        parsed.chapters.every(
          (chapter) =>
            chapter &&
            typeof chapter.fileName === 'string' &&
            typeof chapter.title === 'string' &&
            Number.isFinite(chapter.mtimeMs) &&
            Number.isFinite(chapter.ctimeMs) &&
            Number.isFinite(chapter.size)
        )
      )
        index = parsed
    } catch {
      // Derived metadata can be rebuilt without discarding source content.
      console.warn('章节索引损坏，将从有限标题元数据重建')
    }
  }
  const previous = new Map(
    (index?.chapters || []).map((chapter) => [chapter.fileName, chapter])
  )
  const chapters: ChapterMetadata[] = []
  let changed = !index
  for (const fileName of readdirSync(chaptersDir)) {
    const match = fileName.match(/^chapter-(\d+).*\.md$/i)
    if (!match) continue
    const filePath = assertPathWithinProject(
      params.projectPath,
      join(chaptersDir, fileName)
    )
    const stat = statSync(filePath)
    if (!stat.isFile()) continue
    const cached = previous.get(fileName)
    if (
      cached &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.ctimeMs === stat.ctimeMs &&
      cached.size === stat.size &&
      typeof cached.title === 'string'
    ) {
      chapters.push({ ...cached, index: Number(match[1]), fileName, filePath })
    } else {
      changed = true
      chapters.push({
        index: Number(match[1]),
        title: getChapterTitleFromFile(filePath, fileName),
        fileName,
        filePath,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
        size: stat.size
      })
    }
  }
  chapters.sort(
    (a, b) => a.index - b.index || a.fileName.localeCompare(b.fileName)
  )
  if (previous.size !== chapters.length) changed = true
  index = { version: 1, chapters }
  // Queries must not rewrite the index during execution/backup. Do not publish
  // their refreshed cache either: the next owned scan still needs to persist it.
  if (!params.readOnly) {
    if (changed) atomicWriteFileSync(indexPath, JSON.stringify(index))
    chapterIndexes.delete(chaptersDir)
    chapterIndexes.set(chaptersDir, index)
    if (chapterIndexes.size > MAX_CHAPTER_INDEXES)
      chapterIndexes.delete(chapterIndexes.keys().next().value!)
  }
  return chapters.map(({ index, title, fileName, filePath }) => ({
    index,
    title,
    fileName,
    filePath
  }))
}
