// ============================================================
// Skill Loader — 加载和解析 FEICAI Skill 文件
// ============================================================

import { readFile, readdir, stat } from 'fs/promises'
import { join, basename, resolve, relative, isAbsolute } from 'path'
import { parse as parseYaml } from 'yaml'
import type { Skill } from '@shared/types'

function parseSkillDocument(raw: string): {
  data: Record<string, unknown>
  content: string
} {
  const normalized = raw.replace(/^\uFEFF/, '')
  if (!/^---\s*\r?\n/.test(normalized)) return { data: {}, content: normalized }
  const match = normalized.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  if (!match) throw new Error('Skill YAML 前置元数据缺少结束标记')
  const data: unknown = parseYaml(match[1])
  if (data !== null && (typeof data !== 'object' || Array.isArray(data))) {
    throw new Error('Skill YAML 前置元数据必须是对象')
  }
  return {
    data: (data ?? {}) as Record<string, unknown>,
    content: normalized.slice(match[0].length)
  }
}

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
    const { data: frontmatter, content: body } = parseSkillDocument(raw)

    // 加载子目录和附加文件
    const templates = await this.loadSubDir(join(skillDir, 'templates'))
    const examples = await this.loadSubDir(join(skillDir, 'examples'))

    // 加载根目录下的可选方法论和指南文件。旧版 webtoon-skill
    // 使用 adapt-method.md / output-style.md，这里保持通用加载。
    const rootSupportingFiles = await this.loadRootSupportingFiles(skillDir)

    // 扫描所有文件
    const fileManifest = await this.listAllFiles(skillDir)
    const dependencies = frontmatter.dependencies ?? []
    if (
      !Array.isArray(dependencies) ||
      dependencies.some(
        (file) => typeof file !== 'string' || !file.endsWith('.md')
      )
    ) {
      throw new Error(
        `Skill ${skillName} 的 dependencies 必须是 Markdown 路径数组`
      )
    }
    const dependencyParts: string[] = []
    for (const dependency of dependencies as string[]) {
      const dependencyPath = resolve(skillDir, dependency)
      const fromRoot = relative(resolve(this.skillsDir), dependencyPath)
      if (
        fromRoot === '..' ||
        fromRoot.startsWith('../') ||
        isAbsolute(fromRoot)
      ) {
        throw new Error(`Skill ${skillName} 引用了技能目录之外的依赖`)
      }
      // 显式依赖缺失或不可读是配置错误，不能静默省略审核依据。
      dependencyParts.push(
        `# 依赖依据：${dependency}\n\n${await readFile(dependencyPath, 'utf8')}`
      )
      fileManifest.push(`dependency:${dependency}`)
    }

    const skill: Skill = {
      name: (frontmatter.name as string) || skillName,
      description: (frontmatter.description as string) || '',
      systemPrompt: body.trim(),
      methodology:
        [rootSupportingFiles.methodology, ...dependencyParts]
          .filter(Boolean)
          .join('\n\n---\n\n') || undefined,
      templates,
      examples,
      guides:
        Object.keys(rootSupportingFiles.guides).length > 0
          ? rootSupportingFiles.guides
          : undefined,
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

  private async loadRootSupportingFiles(dirPath: string): Promise<{
    methodology: string
    guides: Record<string, string>
  }> {
    const methodologyParts: string[] = []
    const guides: Record<string, string> = {}
    const preferredOrder = [
      'adapt-method.md',
      'output-style.md',
      'seedance-prompt-methodology.md'
    ]

    try {
      const files = (await readdir(dirPath))
        .filter((file) => file.endsWith('.md') && file !== 'SKILL.md')
        .sort((a, b) => {
          const aIndex = preferredOrder.indexOf(a)
          const bIndex = preferredOrder.indexOf(b)
          if (aIndex >= 0 || bIndex >= 0) {
            return (
              (aIndex >= 0 ? aIndex : preferredOrder.length) -
              (bIndex >= 0 ? bIndex : preferredOrder.length)
            )
          }
          return a.localeCompare(b)
        })

      for (const file of files) {
        const content = await readFile(join(dirPath, file), 'utf-8')
        const key = basename(file, '.md')
        if (/guide/i.test(file)) {
          guides[key] = content
          continue
        }
        methodologyParts.push(`# ${key}\n\n${content}`)
      }
    } catch {
      // 根目录不存在或不可读，返回空资源。
    }

    return {
      methodology: methodologyParts.join('\n\n---\n\n'),
      guides
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
          const subFiles = await this.listAllFiles(
            join(dir, entry.name),
            relativePath
          )
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
          const { data } = parseSkillDocument(raw)
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
