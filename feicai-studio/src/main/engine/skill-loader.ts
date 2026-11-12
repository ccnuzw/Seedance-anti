// Legacy builtin adapter. Versioned consumers use SkillPackageLoader; old callers
// retain their cache and Skill shape without changing prompt assembly.
import { readdir } from 'fs/promises'
import { join, basename, dirname, relative, resolve, isAbsolute } from 'path'
import { parse as parseYaml } from 'yaml'
import type { Skill } from '@shared/types'
import {
  listSkillFiles,
  readSkillText,
  resolveSkillPath
} from './skill-package-files'

function parseSkillDocument(raw: string): {
  data: Record<string, unknown>
  content: string
} {
  const normalized = raw.replace(/^\uFEFF/, '')
  if (!/^---\s*\r?\n/.test(normalized)) return { data: {}, content: normalized }
  const match = normalized.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  if (!match) throw new Error('Skill YAML 前置元数据缺少结束标记')
  const data: unknown = parseYaml(match[1])
  if (data !== null && (typeof data !== 'object' || Array.isArray(data)))
    throw new Error('Skill YAML 前置元数据必须是对象')
  return {
    data: (data ?? {}) as Record<string, unknown>,
    content: normalized.slice(match[0].length)
  }
}

export interface LegacySkillCapture {
  skill: Skill
  /** Root-relative paths, including actual cross-package dependency contents. */
  resources: Array<{ path: string; content: string }>
}

export class SkillLoader {
  private cache = new Map<string, Skill>()
  constructor(private skillsDir: string) {}

  async load(skillName: string): Promise<Skill> {
    const cached = this.cache.get(skillName)
    if (cached) return cached
    const { skill } = await this.capture(skillName)
    this.cache.set(skillName, skill)
    return skill
  }

  /** Always read fresh. Capture and legacy prompt are constructed from the same
   * in-memory bytes; callers never re-read mutable resources to build a snapshot. */
  async capture(skillName: string): Promise<LegacySkillCapture> {
    if (
      !skillName ||
      skillName === '.' ||
      skillName === '..' ||
      /[\\/:\0]/.test(skillName)
    )
      throw new Error(`Invalid Skill name: ${skillName}`)
    const skillDir = resolve(this.skillsDir, skillName)
    await resolveSkillPath(this.skillsDir, skillDir)
    const captured = new Map<string, string>()
    const read = async (path: string): Promise<string> => {
      const key = relative(resolve(this.skillsDir), path).split('\\').join('/')
      const existing = captured.get(key)
      if (existing !== undefined) return existing
      const content = await readSkillText(this.skillsDir, path)
      captured.set(key, content)
      return content
    }
    const raw = await read(join(skillDir, 'SKILL.md'))
    const { data: frontmatter, content: body } = parseSkillDocument(raw)
    const files = await listSkillFiles(this.skillsDir, skillDir)
    // Preserve all actual files for provenance, not only those rendered in prompts.
    for (const file of files) await read(file)
    const templates: Record<string, string> = {}
    const examples: Record<string, string> = {}
    const guides: Record<string, string> = {}
    const methodology: string[] = []
    const preferredOrder = [
      'adapt-method.md',
      'output-style.md',
      'seedance-prompt-methodology.md'
    ]
    const rootFiles = files.filter(
      (path) =>
        dirname(path) === skillDir &&
        path.endsWith('.md') &&
        basename(path) !== 'SKILL.md'
    )
    rootFiles.sort((a, b) => {
      const rank = (path: string): number => {
        const index = preferredOrder.indexOf(basename(path))
        return index < 0 ? preferredOrder.length : index
      }
      return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0)
    })
    for (const file of rootFiles) {
      const key = basename(file, '.md')
      const content = await read(file)
      if (/guide/i.test(basename(file))) guides[key] = content
      else methodology.push(`# ${key}\n\n${content}`)
    }
    for (const file of files) {
      const rel = relative(skillDir, file).split('\\').join('/')
      const match = rel.match(/^(templates|examples)\/([^/]+)\.md$/)
      if (match)
        (match[1] === 'templates' ? templates : examples)[match[2]] =
          await read(file)
    }
    const fileManifest = files.map((path) =>
      relative(skillDir, path).split('\\').join('/')
    )
    const dependencies = frontmatter.dependencies ?? []
    if (
      !Array.isArray(dependencies) ||
      dependencies.some(
        (file) =>
          typeof file !== 'string' ||
          !file.endsWith('.md') ||
          isAbsolute(file) ||
          file.includes('\\') ||
          file.includes('\0') ||
          file.includes(':')
      )
    )
      throw new Error(
        `Skill ${skillName} 的 dependencies 必须是 Markdown 路径数组`
      )
    const dependencyParts: string[] = []
    for (const dependency of dependencies as string[]) {
      const content = await read(resolve(skillDir, dependency))
      dependencyParts.push(`# 依赖依据：${dependency}\n\n${content}`)
      fileManifest.push(`dependency:${dependency}`)
    }
    return {
      skill: {
        name:
          (typeof frontmatter.name === 'string' && frontmatter.name) ||
          skillName,
        description:
          (typeof frontmatter.description === 'string' &&
            frontmatter.description) ||
          '',
        systemPrompt: body.trim(),
        methodology:
          [methodology.join('\n\n---\n\n'), ...dependencyParts]
            .filter(Boolean)
            .join('\n\n---\n\n') || undefined,
        templates,
        examples,
        guides: Object.keys(guides).length ? guides : undefined,
        skillPath: skillDir,
        fileManifest
      },
      resources: [...captured]
        .map(([path, content]) => ({ path, content }))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    }
  }

  async listAll(): Promise<Array<{ name: string; description: string }>> {
    const entries = await readdir(this.skillsDir, { withFileTypes: true })
    const skills: Array<{ name: string; description: string }> = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        await resolveSkillPath(this.skillsDir, join(this.skillsDir, entry.name))
        const { data } = parseSkillDocument(
          await readSkillText(
            this.skillsDir,
            join(this.skillsDir, entry.name, 'SKILL.md')
          )
        )
        skills.push({
          name: (typeof data.name === 'string' && data.name) || entry.name,
          description:
            (typeof data.description === 'string' && data.description) || ''
        })
      } catch {
        // Discovery skips non-Skill directories; explicit loading reports errors.
      }
    }
    return skills
  }

  clearCache(): void {
    this.cache.clear()
  }
  async reload(skillName: string): Promise<Skill> {
    this.cache.delete(skillName)
    return this.load(skillName)
  }
}
