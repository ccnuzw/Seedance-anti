export interface ProductionCommitFile {
  path: string
  oldHash: string | null
  newHash: string
  /** Exact UTF-8 bytes retained inside the project before installation. */
  content: string
}

/** Independent of manifest, workflow and SQLite schema versions. */
export interface ProductionCommitRecord {
  schemaVersion: 1
  operationId: string
  key: string
  inputHash: string
  phase: 'intent' | 'prepared' | 'committed'
  kind?: 'production' | 'project-settings'
  files: ProductionCommitFile[]
  guards?: { path: string; hash: string | null }[]
  episodeNumbers: number[]
  result?: unknown
  projected: boolean
}
