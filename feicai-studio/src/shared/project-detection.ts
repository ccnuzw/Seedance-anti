import type { ProjectConfig } from './types'

export type ProjectIntegrityStatus = 'pass' | 'warn' | 'fail'
export type ProjectIntegrityGroup =
  | 'config'
  | 'directories'
  | 'content'
  | 'legacy'
export type ProjectRepairActionId =
  | 'apply_suggested_config'
  | 'create_missing_directories'
  | 'create_missing_templates'
  | 'migrate_legacy_novel'

export const PROJECT_INTEGRITY_GROUP_LABELS: Record<
  ProjectIntegrityGroup,
  string
> = {
  config: '配置',
  directories: '目录',
  content: '内容',
  legacy: '旧版兼容'
}

export interface ProjectRepairAction {
  id: ProjectRepairActionId
  label: string
  description?: string
}

export interface ProjectReadyItem {
  label: string
  path: string
  exists: boolean
}

export interface ProjectIntegrityCheck {
  id: string
  group: ProjectIntegrityGroup
  label: string
  status: ProjectIntegrityStatus
  detail: string
  path?: string | null
  repairActions?: ProjectRepairAction[]
}

export interface ProjectIntegrityReport {
  status: ProjectIntegrityStatus
  summary: string
  detectedEpisodes: number
  expectedEpisodes: number | null
  checks: ProjectIntegrityCheck[]
  recommendedActions?: ProjectRepairAction[]
}

export interface DetectedProjectInfo {
  resolvedPath: string
  configPath: string | null
  scriptDir: string | null
  outputsDir: string | null
  nestedProjectDirName?: string
  integrity?: ProjectIntegrityReport
  suggestedConfig?: Partial<ProjectConfig>
}

export interface LegacyNovelMigrationResult {
  success: boolean
  migrated: boolean
  sourcePath: string
  legacyDirPath: string | null
  migratedFiles: number
  message: string
}

export interface ProjectRepairIssueParams {
  projectPath: string
  actionIds: ProjectRepairActionId[]
  trustMode: 'selected' | 'registered'
  dryRun?: boolean
}
