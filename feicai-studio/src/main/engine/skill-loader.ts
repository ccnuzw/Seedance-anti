// ============================================================
// Skill Loader — 加载和解析 FEICAI Skill 文件
// ============================================================

import { readFile, readdir, stat } from 'fs/promises'
import { join, basename } from 'path'
import matter from 'gray-matter'
import type { Skill } from '@shared/types'

export class SkillLoader {
  private skillsDir: string
  private cache: Map<string, Skill> = new Map()

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir
  }

  /**
   * 加载一个 Skill（带缓存）
   */
  async load(skillName: string): Promise<Skill> {
    const cached = this.cache.get(skillName)
    if (cached) return cached

    const skillDir = join(this.skillsDir, skillName)
    const skillMdPath = join(skillDir, 'SKILL.md')

    // 读取并解析 SKILL.md
    const raw = await readFile(skillMdPath, 'utf-8')
    const { data: frontmatter, content: body } = matter(raw)

    // 加载子目录和附加文件
    const templates = await this.loadSubDir(join(skillDir, 'templates'))
    const examples = await this.loadSubDir(join(skillDir, 'examples'))

    // 加载可选的方法论和指南文件
    const methodology = await this.loadOptionalFile(skillDir, 'seedance-prompt-methodology.md')
    const guides: Record<string, string> = {}
    const guideContent = await this.loadOptionalFile(skillDir, 'gemini-image-prompt-guide.md')
    if (guideContent) {
      guides['gemini-image-prompt-guide'] = guideContent
    }

    // 加载编剧特有资源（webtoon-skill 专用）
    const adaptMethod = await this.loadOptionalFile(skillDir, 'adapt-method.md')
    const outputStyle = await this.loadOptionalFile(skillDir, 'output-style.md')
    if (outputStyle) {
      guides['output-style'] = outputStyle
    }

    // 扫描所有文件
    const fileManifest = await this.listAllFiles(skillDir)

    const skill: Skill = {
      name: (frontmatter.name as string) || skillName,
      description: (frontmatter.description as string) || '',
      systemPrompt: body.trim(),
      methodology: methodology || adaptMethod || undefined,
      templates,
      examples,
      guides: Object.keys(guides).length > 0 ? guides : undefined,
      skillPath: skillDir,
      fileManifest
    }

    this.cache.set(skillName, skill)
    return skill
  }

  /**
   * 加载目录下所有 .md 文件为 key-value 对
   */
  private async loadSubDir(dirPath: string): Promise<Record<string, string>> {
    const result: Record<string, string> = {}
    try {
      const dirStat = await stat(dirPath)
      if (!dirStat.isDirectory()) return result

      const files = await readdir(dirPath)
      for (const file of files) {
        if (file.endsWith('.md')) {
          const content = await readFile(join(dirPath, file), 'utf-8')
          const key = basename(file, '.md')
          result[key] = content
        }
      }
    } catch {
      // 目录不存在，返回空
    }
    return result
  }

  /**
   * 可选文件加载
   */
  private async loadOptionalFile(dir: string, filename: string): Promise<string | null> {
    try {
      return await readFile(join(dir, filename), 'utf-8')
    } catch {
      return null
    }
  }

  /**
   * 递归列出所有文件
   */
  private async listAllFiles(dir: string, prefix = ''): Promise<string[]> {
    const result: string[] = []
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          const subFiles = await this.listAllFiles(join(dir, entry.name), relativePath)
          result.push(...subFiles)
        } else {
          result.push(relativePath)
        }
      }
    } catch {
      // ignore
    }
    return result
  }

  /**
   * 列出所有可用的 Skill
   */
  async listAll(): Promise<Array<{ name: string; description: string }>> {
    const entries = await readdir(this.skillsDir, { withFileTypes: true })
    const skills: Array<{ name: string; description: string }> = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          const skillMdPath = join(this.skillsDir, entry.name, 'SKILL.md')
          const raw = await readFile(skillMdPath, 'utf-8')
          const { data } = matter(raw)
          skills.push({
            name: (data.name as string) || entry.name,
            description: (data.description as string) || ''
          })
        } catch {
          // 非 Skill 目录，跳过
        }
      }
    }

    return skills
  }

  /** 清理缓存 */
  clearCache(): void {
    this.cache.clear()
  }

  /** 强制重新加载 */
  async reload(skillName: string): Promise<Skill> {
    this.cache.delete(skillName)
    return this.load(skillName)
  }
}
