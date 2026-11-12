export interface ProductionCommitFile {
  path: string
  oldHash: string | null
  newHash: string
  /** Exact UTF-8 bytes retained inside the project before installation. */
  content: string
}

/** Independent of manifest, workflow and SQLite schema versions. */
export type ProductionCommitKind = 'production' | 'project-settings'

export interface ProductionCommitRecord {
  schemaVersion: 1
  /** Missing on schema-1 journals created before typed recovery was added. */
  kind?: ProductionCommitKind
  operationId: string
  key: string
  inputHash: string
  phase: 'intent' | 'prepared' | 'committed'
  files: ProductionCommitFile[]
  guards?: { path: string; hash: string | null }[]
  episodeNumbers: number[]
  result?: unknown
  projected: boolean
}
