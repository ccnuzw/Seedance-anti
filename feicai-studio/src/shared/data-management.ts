export const DATA_IPC = {
  BACKUP_PROJECT: 'data:backupProject',
  RESTORE_PROJECT: 'data:restoreProject',
  BACKUP_DATABASE: 'data:backupDatabase',
  RESTORE_DATABASE: 'data:restoreDatabase',
  REBUILD_INDEX: 'data:rebuildIndex',
  EXPORT_LOGS: 'data:exportLogs',
  CLEAR_CREDENTIALS: 'data:clearCredentials'
} as const

export interface DataManagementResult {
  canceled?: boolean
  path?: string
  projectId?: string
  count?: number
  message: string
}

export interface DataManagementAPI {
  backupProject(projectId: string): Promise<DataManagementResult>
  restoreProject(): Promise<DataManagementResult>
  backupDatabase(): Promise<DataManagementResult>
  restoreDatabase(): Promise<DataManagementResult>
  rebuildProjectIndex(projectId: string): Promise<DataManagementResult>
  exportDiagnosticLogs(): Promise<DataManagementResult>
  clearStoredCredentials(): Promise<DataManagementResult>
}
