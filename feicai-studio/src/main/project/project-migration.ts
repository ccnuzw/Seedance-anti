import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { buildDefaultSourceTemplate } from '@shared/project-bootstrap'
import { normalizeProjectConfig } from '@shared/project-config'
import type { LegacyNovelMigrationResult } from '@shared/project-detection'
import type { ProjectConfig } from '@shared/types'
import { resolveProjectArtifactPath } from '@shared/path-resolver'

function listLegacyNovelFilesSync(legacyDirPath: string): string[] {
  try {
    return readdirSync(legacyDirPath)
      .filter((name: string) => /^chapter-\d+\.(txt|md)$/i.test(name))
      .sort((a: string, b: string) => {
        const aNum = Number((a.match(/chapter-(\d+)/i) || [])[1] || 0)
        const bNum = Number((b.match(/chapter-(\d+)/i) || [])[1] || 0)
        return aNum - bNum || a.localeCompare(b)
      })
  } catch {
    return []
  }
}

function formatChapterTitle(fileName: string, index: number): string {
  const match = fileName.match(/chapter-(\d+)/i)
  const chapterNum = match ? Number(match[1]) : index
  return `第${chapterNum}章`
}

export async function migrateLegacyNovelDirectory(
  projectPath: string,
  config?: Partial<ProjectConfig> | null
): Promise<LegacyNovelMigrationResult> {
  const normalizedConfig = normalizeProjectConfig(config)
  const sourcePath = resolveProjectArtifactPath(
    projectPath,
    'sourceNovel',
    normalizedConfig
  )
  const legacyDirPath = join(projectPath, 'novel')

  if (existsSync(sourcePath)) {
    return {
      success: true,
      migrated: false,
      sourcePath,
      legacyDirPath: existsSync(legacyDirPath) ? legacyDirPath : null,
      migratedFiles: 0,
      message: '标准小说原文已存在，无需迁移'
    }
  }

  if (!existsSync(legacyDirPath)) {
    return {
      success: false,
      migrated: false,
      sourcePath,
      legacyDirPath: null,
      migratedFiles: 0,
      message: '未找到旧版小说目录'
    }
  }

  const legacyFiles = listLegacyNovelFilesSync(legacyDirPath)
  if (legacyFiles.length === 0) {
    return {
      success: false,
      migrated: false,
      sourcePath,
      legacyDirPath,
      migratedFiles: 0,
      message: '旧版小说目录中没有可迁移的章节文件'
    }
  }

  await mkdir(dirname(sourcePath), { recursive: true })
  await writeFile(
    sourcePath,
    buildDefaultSourceTemplate(normalizedConfig.projectName),
    'utf-8'
  )

  let migratedFiles = 0
  for (const [index, fileName] of legacyFiles.entries()) {
    const filePath = join(legacyDirPath, fileName)
    const raw = await readFile(filePath, 'utf-8')
    const content = raw.trim()
    const title = formatChapterTitle(fileName, index + 1)
    await appendFile(
      sourcePath,
      `\n\n## ${title}\n\n${content || '（空章节）'}\n`,
      'utf-8'
    )
    migratedFiles += 1
  }

  return {
    success: true,
    migrated: true,
    sourcePath,
    legacyDirPath,
    migratedFiles,
    message: `已迁移 ${migratedFiles} 个章节到标准小说原文`
  }
}
