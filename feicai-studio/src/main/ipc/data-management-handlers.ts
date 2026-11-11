import { app, dialog } from 'electron'
import { dirname } from 'node:path'
import { DATA_IPC, type DataManagementResult } from '@shared/data-management'
import { registerSafeIpcHandler } from '../security/safe-ipc'
import {
  assertPathWithinProject,
  refreshRegisteredProjectRoots,
  resetAccessControl
} from '../security/access-control'
import {
  createProject,
  getRegisteredProject,
  listRegisteredProjects,
  syncProjectEpisodes
} from '../services/project-service'
import { withRuntimeLease } from '../services/pipeline-runtime-service'
import {
  backupProjectFiles,
  restoreProjectFiles
} from '../services/project-backup'
import {
  backupDatabaseFile,
  restoreDatabaseFile
} from '../services/database-backup'
import { clearStoredLLMCredentials } from '../db/llm-config-repository'
import { getDatabase } from '../db/database'
import { invalidateProjectScanCache } from '../db/episode-sync-worker'
import { invalidateSourceChapterCache } from '../project/novel-importer'
import { atomicWriteFile } from '../io/atomic-file'

const canceled = (): DataManagementResult => ({
  canceled: true,
  message: '已取消，未更改数据'
})

async function chooseDirectory(title: string): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title,
    properties: ['openDirectory', 'createDirectory']
  })
  return result.canceled ? null : result.filePaths[0] || null
}

function requireProject(id: unknown) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('请选择已注册项目')
  const project = getRegisteredProject(id)
  if (!project) throw new Error('项目不存在')
  return project
}

function refreshTrust(): void {
  resetAccessControl()
  refreshRegisteredProjectRoots(
    listRegisteredProjects().map((project) => project.projectPath)
  )
}

export function registerDataManagementHandlers(): void {
  registerSafeIpcHandler(
    DATA_IPC.BACKUP_PROJECT,
    (_event, projectId: unknown) =>
      withRuntimeLease('data:backup-project', async () => {
        const project = requireProject(projectId)
        const directory = await chooseDirectory(
          '选择项目备份位置（备份包含原稿与所有产物，不含应用模型凭据）'
        )
        if (!directory) return canceled()
        const path = await backupProjectFiles(project, directory)
        return { path, message: '项目备份完成，文件完整性校验清单已写入' }
      })
  )

  registerSafeIpcHandler(DATA_IPC.RESTORE_PROJECT, () =>
    withRuntimeLease('data:restore-project', async () => {
      const source = await chooseDirectory(
        '选择含 feicai-backup.json 的项目备份目录'
      )
      if (!source) return canceled()
      const target = await chooseDirectory(
        '选择恢复位置（创建新目录，不覆盖原项目）'
      )
      if (!target) return canceled()
      const restored = await restoreProjectFiles(source, target)
      const project = await createProject({
        ...restored.project,
        projectPath: restored.path
      })
      refreshTrust()
      return {
        path: restored.path,
        projectId: project.id,
        message: '完整性校验通过，项目已恢复到新目录并注册'
      }
    })
  )

  registerSafeIpcHandler(DATA_IPC.BACKUP_DATABASE, () =>
    withRuntimeLease('data:backup-database', async () => {
      const result = await dialog.showSaveDialog({
        title: '备份应用数据库（包含本机加密凭据，请妥善保管）',
        defaultPath: 'feicai-database.sqlite',
        filters: [{ name: 'SQLite', extensions: ['sqlite'] }]
      })
      if (result.canceled || !result.filePath) return canceled()
      await backupDatabaseFile(result.filePath)
      return {
        path: result.filePath,
        message: '数据库备份完成；项目正文文件需另用“备份项目”保存'
      }
    })
  )

  registerSafeIpcHandler(DATA_IPC.RESTORE_DATABASE, () =>
    withRuntimeLease('data:restore-database', async () => {
      const result = await dialog.showOpenDialog({
        title: '选择同版本应用数据库备份',
        properties: ['openFile'],
        filters: [{ name: 'SQLite', extensions: ['sqlite', 'db'] }]
      })
      if (result.canceled || !result.filePaths[0]) return canceled()
      const confirmation = await dialog.showMessageBox({
        type: 'warning',
        title: '恢复应用数据库',
        message: '替换项目索引、历史记录与模型配置？',
        detail:
          '不会修改项目正文文件。恢复前自动保留当前数据库副本。加密凭据仅能在原系统账户解密，跨机器后须重新填写。',
        buttons: ['取消', '恢复数据库'],
        defaultId: 0,
        cancelId: 0
      })
      if (confirmation.response !== 1) return canceled()
      await invalidateProjectScanCache()
      invalidateSourceChapterCache()
      const count = await restoreDatabaseFile(result.filePaths[0])
      refreshTrust()
      return {
        count,
        message: `数据库已恢复，${count} 个项目索引已加载；页面将重新载入`
      }
    })
  )

  registerSafeIpcHandler(DATA_IPC.REBUILD_INDEX, (_event, projectId: unknown) =>
    withRuntimeLease('data:rebuild-index', async () => {
      const project = requireProject(projectId)
      await invalidateProjectScanCache(project.projectPath)
      invalidateSourceChapterCache(project.projectPath)
      const episodes = await syncProjectEpisodes(
        project.id,
        project.projectPath
      )
      return {
        count: episodes.length,
        message: `索引已重建，保留 ${episodes.length} 集及其历史记录`
      }
    })
  )

  registerSafeIpcHandler(DATA_IPC.EXPORT_LOGS, () =>
    withRuntimeLease('data:export-logs', async () => {
      const result = await dialog.showSaveDialog({
        title: '导出诊断信息（不包含提示词正文或 API Key）',
        defaultPath: 'feicai-diagnostics.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return canceled()
      const database = getDatabase()
      // Only fixed structural columns: provider errors and free-form messages can contain secrets.
      const events = database
        .prepare(
          'SELECT stage, event_type AS eventType, created_at AS createdAt FROM execution_logs ORDER BY created_at DESC LIMIT 2000'
        )
        .all()
      const counts = database
        .prepare(
          'SELECT (SELECT COUNT(*) FROM projects) AS projects, (SELECT COUNT(*) FROM episodes) AS episodes, (SELECT COUNT(*) FROM reviews) AS reviews'
        )
        .get()
      const path = assertPathWithinProject(
        dirname(result.filePath),
        result.filePath
      )
      await atomicWriteFile(
        path,
        JSON.stringify(
          {
            version: app.getVersion(),
            platform: process.platform,
            architecture: process.arch,
            exportedAt: new Date().toISOString(),
            counts,
            events
          },
          null,
          2
        )
      )
      return {
        path,
        count: events.length,
        message: '已导出最近 2000 条以内的事件元数据；不含日志正文、路径或凭据'
      }
    })
  )

  registerSafeIpcHandler(DATA_IPC.CLEAR_CREDENTIALS, () =>
    withRuntimeLease('data:clear-credentials', async () => {
      const confirmation = await dialog.showMessageBox({
        type: 'warning',
        title: '清理模型凭据',
        message: '清除所有已保存 API Key？',
        detail:
          '保留模型配置，但取消默认模型；下次生成前必须重新输入 Key。现有数据库备份可能仍包含加密凭据，本操作不会修改备份。',
        buttons: ['取消', '清除凭据'],
        defaultId: 0,
        cancelId: 0
      })
      if (confirmation.response !== 1) return canceled()
      const count = clearStoredLLMCredentials()
      return { count, message: `已清理 ${count} 条凭据，保留模型配置` }
    })
  )
}
