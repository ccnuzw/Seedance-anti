import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { ArtifactQuery, ArtifactRollbackParams } from '@shared/types'
import { assertProjectPathAccess } from './path-access'
import { listArtifacts, rollbackArtifact } from '../project/artifact-service'

export function registerArtifactHandlers(): void {
  ipcMain.handle(IPC.ARTIFACT_LIST, async (_event, query: ArtifactQuery) => {
    const safeProjectPath = assertProjectPathAccess(query.projectPath)
    return listArtifacts({
      ...query,
      projectPath: safeProjectPath
    })
  })

  ipcMain.handle(IPC.ARTIFACT_ROLLBACK, async (_event, params: ArtifactRollbackParams) => {
    const safeProjectPath = assertProjectPathAccess(params.projectPath)
    return rollbackArtifact({
      ...params,
      projectPath: safeProjectPath
    })
  })
}
