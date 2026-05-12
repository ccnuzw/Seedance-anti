import type { ProjectConfig } from './types'

function sanitizeProjectDirectory(
  input: string | undefined,
  fallback: string
): string {
  const trimmed = input?.trim().replace(/\\/g, '/') || ''
  if (!trimmed) return fallback
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('~') ||
    /^[a-zA-Z]:/.test(trimmed)
  )
    return fallback

  const segments = trimmed.split('/').filter(Boolean)
  if (segments.length === 0) return fallback
  if (segments.some((segment) => segment === '.' || segment === '..'))
    return fallback

  return segments.join('/')
}

export function normalizeProjectConfig(
  config?: Partial<ProjectConfig> | null
): ProjectConfig {
  const createdAt = config?.createdAt || new Date().toISOString()
  return {
    projectName: config?.projectName || '未命名项目',
    totalEpisodes: config?.totalEpisodes || 0,
    visualStyle: config?.visualStyle || '',
    targetMedium: config?.targetMedium || '',
    chaptersPerEpisode: Math.max(0, Number(config?.chaptersPerEpisode) || 0),
    createdAt,
    workflowVersion: config?.workflowVersion || 2,
    entryStage: config?.entryStage || 'novel',
    workflowMode: config?.workflowMode || 'novel_to_shortdrama',
    directories: {
      sourceDir: sanitizeProjectDirectory(
        config?.directories?.sourceDir,
        'source'
      ),
      storyDir: sanitizeProjectDirectory(
        config?.directories?.storyDir,
        'story'
      ),
      scriptDir: sanitizeProjectDirectory(
        config?.directories?.scriptDir,
        'script'
      ),
      assetsDir: sanitizeProjectDirectory(
        config?.directories?.assetsDir,
        'assets'
      ),
      outputsDir: sanitizeProjectDirectory(
        config?.directories?.outputsDir,
        'outputs'
      ),
      reviewsDir: sanitizeProjectDirectory(
        config?.directories?.reviewsDir,
        'reviews'
      )
    },
    pipelineSettings: config?.pipelineSettings
  }
}

export function mergeProjectConfig(
  baseConfig?: Partial<ProjectConfig> | null,
  overrideConfig?: Partial<ProjectConfig> | null
): ProjectConfig {
  return normalizeProjectConfig({
    ...(baseConfig || {}),
    ...(overrideConfig || {}),
    directories: {
      ...(baseConfig?.directories || {}),
      ...(overrideConfig?.directories || {})
    },
    pipelineSettings:
      overrideConfig?.pipelineSettings || baseConfig?.pipelineSettings
  })
}
