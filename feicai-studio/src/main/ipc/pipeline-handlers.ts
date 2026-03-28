// ============================================================
// Pipeline IPC Handlers — 流水线控制的 IPC 处理器
// ============================================================

import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { PipelineStage, PipelineTaskOrchestration, PipelineTaskStrategy } from '@shared/types'
import { assertProjectPathAccess } from './path-access'
import { PipelineRuntimeManager } from '../engine/pipeline-runtime-manager'

let pipelineManager: PipelineRuntimeManager | null = null

export function getPipelineManager(): PipelineRuntimeManager {
  if (!pipelineManager) {
    pipelineManager = new PipelineRuntimeManager()
  }
  return pipelineManager
}

export function registerPipelineHandlers(): void {
  ipcMain.handle(IPC.PIPELINE_START, async (_event, params: {
    projectId: string
    projectPath: string
    episodeNum: number
    projectName: string
    visualStyle: string
    targetMedium: string
    startStage?: PipelineStage
    singleStage?: boolean
    strategy?: Partial<PipelineTaskStrategy>
    orchestration?: Partial<PipelineTaskOrchestration>
    }) => {
    try {
      const manager = getPipelineManager()
      const safeProjectPath = assertProjectPathAccess(params.projectPath)

      // 启动流水线（异步执行，不等待完成）
      await manager.start({
        projectId: params.projectId,
        projectPath: safeProjectPath,
        episodeNum: params.episodeNum,
        projectContext: {
          projectName: params.projectName,
          visualStyle: params.visualStyle,
          targetMedium: params.targetMedium,
          episodeNumber: params.episodeNum,
          durationMin: 90,
          durationMax: 120,
          singlePromptMax: 10
        },
        startStage: params.startStage,
        singleStage: params.singleStage,
        strategy: params.strategy,
        orchestration: params.orchestration
      })

      return { success: true, message: '流水线已启动', activeRun: manager.getActiveRun() }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  // 批量模式：启动并等待完成
  ipcMain.handle(IPC.PIPELINE_RUN_AND_WAIT, async (_event, params: {
    projectId: string
    projectPath: string
    episodeNum: number
    projectName: string
    visualStyle: string
    targetMedium: string
    startStage?: PipelineStage
    singleStage?: boolean
    strategy?: Partial<PipelineTaskStrategy>
    orchestration?: Partial<PipelineTaskOrchestration>
    }) => {
    try {
      const manager = getPipelineManager()
      const safeProjectPath = assertProjectPathAccess(params.projectPath)

      // 启动并等待完成（start() 本身会执行到终止状态）
      await manager.runAndWait({
        projectId: params.projectId,
        projectPath: safeProjectPath,
        episodeNum: params.episodeNum,
        projectContext: {
          projectName: params.projectName,
          visualStyle: params.visualStyle,
          targetMedium: params.targetMedium,
          episodeNumber: params.episodeNum,
          durationMin: 90,
          durationMax: 120,
          singlePromptMax: 10
        },
        startStage: params.startStage,
        singleStage: params.singleStage,
        strategy: params.strategy,
        orchestration: params.orchestration
      })

      const ctx = manager.getContext()
      return { success: true, state: ctx.state, stage: ctx.currentStage }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  ipcMain.handle(IPC.PIPELINE_ENQUEUE, async (_event, params: {
    projectId: string
    projectPath: string
    episodeNum: number
    projectName: string
    visualStyle: string
    targetMedium: string
    startStage?: PipelineStage
    singleStage?: boolean
    strategy?: Partial<PipelineTaskStrategy>
    orchestration?: Partial<PipelineTaskOrchestration>
    }) => {
    try {
      const manager = getPipelineManager()
      const safeProjectPath = assertProjectPathAccess(params.projectPath)
      const record = await manager.enqueue({
        projectId: params.projectId,
        projectPath: safeProjectPath,
        episodeNum: params.episodeNum,
        projectContext: {
          projectName: params.projectName,
          visualStyle: params.visualStyle,
          targetMedium: params.targetMedium,
          episodeNumber: params.episodeNum,
          durationMin: 90,
          durationMax: 120,
          singlePromptMax: 10
        },
        startStage: params.startStage,
        singleStage: params.singleStage,
        strategy: params.strategy,
        orchestration: params.orchestration
      })

      return { success: true, run: record }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  ipcMain.handle(IPC.PIPELINE_PAUSE, async () => {
    const manager = getPipelineManager()
    manager.pause()
    return { success: true, activeRun: manager.getActiveRun() }
  })

  ipcMain.handle(IPC.PIPELINE_ABORT, async (_event, scope?: { runId?: string; batchId?: string; reason?: string }) => {
    const manager = getPipelineManager()
    const result = await manager.abort(scope)
    return { success: true, ...result }
  })

  ipcMain.handle(IPC.PIPELINE_RESUME, async () => {
    const manager = getPipelineManager()
    manager.resume()
    return { success: true, activeRun: manager.getActiveRun() }
  })

  ipcMain.handle(IPC.PIPELINE_RETRY, async (_event, stage?: PipelineStage) => {
    const manager = getPipelineManager()
    manager.retry(stage).catch(console.error)
    return { success: true, activeRun: manager.getActiveRun() }
  })

  ipcMain.handle(IPC.PIPELINE_SKIP, async (_event, stage?: PipelineStage) => {
    const manager = getPipelineManager()
    const ctx = manager.getContext()
    manager.skipReview(stage || ctx.currentStage)
    return { success: true, activeRun: manager.getActiveRun() }
  })

  ipcMain.handle(IPC.PIPELINE_GET_STATE, async (_event, projectPath?: string) => {
    const manager = getPipelineManager()
    const safeProjectPath = projectPath ? assertProjectPathAccess(projectPath) : undefined
    return manager.getContextForProject(safeProjectPath)
  })

  ipcMain.handle(IPC.PIPELINE_LIST_RUNS, async (_event, projectId: string, limit?: number, includeArchived?: boolean) => {
    const manager = getPipelineManager()
    return manager.listRuns(projectId, limit || 20, !!includeArchived)
  })

  ipcMain.handle(IPC.PIPELINE_LIST_ALL_RUNS, async (_event, limit?: number, includeArchived?: boolean) => {
    const manager = getPipelineManager()
    return manager.listAllRuns(limit || 100, !!includeArchived)
  })

  ipcMain.handle(IPC.PIPELINE_CANCEL_RUN, async (_event, runId: string) => {
    const manager = getPipelineManager()
    const success = await manager.cancelRun(runId)
    return { success }
  })

  ipcMain.handle(IPC.PIPELINE_GET_RUN_DETAIL, async (_event, runId: string) => {
    const manager = getPipelineManager()
    return manager.getRunDetail(runId)
  })

  ipcMain.handle(IPC.PIPELINE_RETRY_RUN, async (_event, runId: string) => {
    try {
      const manager = getPipelineManager()
      const run = await manager.retryRun(runId)
      return { success: true, run }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  ipcMain.handle(IPC.PIPELINE_ARCHIVE_RUNS, async (_event, olderThanDays?: number, projectId?: string) => {
    const manager = getPipelineManager()
    const count = manager.archiveFinishedRuns(Math.max(0, olderThanDays || 0), projectId)
    return { success: true, count }
  })

  ipcMain.handle(IPC.PIPELINE_GET_DIAGNOSTICS, async () => {
    const manager = getPipelineManager()
    return manager.getDiagnostics()
  })

  ipcMain.handle(IPC.PIPELINE_TRIGGER_AUTOMATION_SCAN, async () => {
    const manager = getPipelineManager()
    return manager.triggerAutomationScan()
  })

  ipcMain.handle(IPC.PIPELINE_TRIGGER_RECOVERY_SWEEP, async () => {
    const manager = getPipelineManager()
    return manager.triggerRecoverySweep()
  })

  ipcMain.handle(IPC.PIPELINE_TRIGGER_SCHEDULE, async (_event, projectId: string, scheduleId: string) => {
    try {
      const manager = getPipelineManager()
      const runs = await manager.triggerProjectSchedule(projectId, scheduleId)
      return { success: true, runs }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })
}
