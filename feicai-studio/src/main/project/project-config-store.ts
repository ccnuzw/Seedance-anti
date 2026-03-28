import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import {
  PROJECT_CONFIG_VERSION,
  ensureProjectDataFile,
  ensureProjectDataFileSync,
  getProjectDataFilePath,
  mergeProjectConfigContent,
  normalizeProjectConfigContent,
  type PersistedProjectConfig
} from './project-data-compat'

export { PROJECT_CONFIG_VERSION }
export type { PersistedProjectConfig }

export function getProjectConfigPath(projectPath: string): string {
  return getProjectDataFilePath(projectPath, 'projectConfig')
}

export function normalizeProjectConfig(input: unknown): PersistedProjectConfig {
  return normalizeProjectConfigContent(input)
}

export function mergeProjectConfig(base: unknown, patch: unknown): PersistedProjectConfig {
  return mergeProjectConfigContent(base, patch)
}

export function readProjectConfigSync(projectPath: string): PersistedProjectConfig | null {
  const configPath = getProjectConfigPath(projectPath)
  if (!existsSync(configPath)) return null

  const result = ensureProjectDataFileSync<PersistedProjectConfig>(projectPath, 'projectConfig')
  return result.data
}

export async function readProjectConfig(projectPath: string): Promise<PersistedProjectConfig | null> {
  const configPath = getProjectConfigPath(projectPath)
  if (!existsSync(configPath)) return null

  const result = await ensureProjectDataFile<PersistedProjectConfig>(projectPath, 'projectConfig')
  return result.data
}

export function saveProjectConfigSync(projectPath: string, config: unknown): PersistedProjectConfig {
  const configPath = getProjectConfigPath(projectPath)
  const current = readProjectConfigSync(projectPath)
  const next = mergeProjectConfig(current || {}, config)

  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf-8')

  return next
}

export async function saveProjectConfig(projectPath: string, config: unknown): Promise<PersistedProjectConfig> {
  const configPath = getProjectConfigPath(projectPath)
  let current: PersistedProjectConfig | null = null

  if (existsSync(configPath)) {
    const result = await ensureProjectDataFile<PersistedProjectConfig>(projectPath, 'projectConfig')
    current = result.data
  } else {
    try {
      const raw = await readFile(configPath, 'utf-8')
      current = normalizeProjectConfig(JSON.parse(raw))
    } catch {
      current = null
    }
  }

  const next = mergeProjectConfig(current || {}, config)
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify(next, null, 2), 'utf-8')

  return next
}
