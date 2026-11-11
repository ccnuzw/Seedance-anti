import { readFile } from 'fs/promises'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { buildDefaultSourceTemplate } from '@shared/project-bootstrap'
import { normalizeProjectConfig } from '@shared/project-config'
import type { LegacyNovelMigrationResult } from '@shared/project-detection'
import type { ProjectConfig } from '@shared/types'
import { resolveProjectArtifactPath } from '@shared/path-resolver'
import { assertPathWithinProject } from '../security/access-control'
import { atomicWriteFile } from '../io/atomic-file'

export async function migrateLegacyNovelDirectory(
  projectPath: string,
  config?: Partial<ProjectConfig> | null
): Promise<LegacyNovelMigrationResult> {
  const normalizedConfig = normalizeProjectConfig(config)
  const sourcePath = assertPathWithinProject(
    projectPath,
    resolveProjectArtifactPath(projectPath, 'sourceNovel', normalizedConfig)
  )
  const legacyDirPath = assertPathWithinProject(
    projectPath,
    join(projectPath, 'novel')
  )
  const result = {
    sourcePath,
    legacyDirPath: existsSync(legacyDirPath) ? legacyDirPath : null,
    migratedFiles: 0,
    migrated: false
  }
  if (existsSync(sourcePath))
    return { ...result, success: true, message: '标准小说原文已存在，无需迁移' }
  if (!existsSync(legacyDirPath))
    return { ...result, success: false, message: '未找到旧版小说目录' }
  const files = readdirSync(legacyDirPath)
    .filter((name) => /^chapter-\d+\.(txt|md)$/i.test(name))
    .sort(
      (a, b) =>
        Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]) ||
        a.localeCompare(b)
    )
  if (!files.length)
    return {
      ...result,
      success: false,
      message: '旧版小说目录中没有可迁移的章节文件'
    }
  const chapters = [buildDefaultSourceTemplate(normalizedConfig.projectName)]
  for (const file of files) {
    const content = (
      await readFile(
        assertPathWithinProject(projectPath, join(legacyDirPath, file)),
        'utf8'
      )
    ).trim()
    const number = Number(file.match(/\d+/)?.[0])
    chapters.push(`\n\n## 第${number}章\n\n${content || '（空章节）'}\n`)
  }
  await atomicWriteFile(sourcePath, chapters.join(''))
  return {
    ...result,
    success: true,
    migrated: true,
    migratedFiles: files.length,
    message: `已迁移 ${files.length} 个章节到标准小说原文`
  }
}
