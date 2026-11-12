// ============================================================
// Electron Preload — 安全桥接 IPC
// ============================================================

import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { FeicaiAPI } from '@shared/ipc-contracts'
import { BATCH_IPC } from '@shared/batch'
import { DATA_IPC } from '@shared/data-management'

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

function subscribe<T>(
  channel: string,
  callback: (payload: T) => void
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) =>
    callback(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

// 暴露安全的 API 给渲染进程
const api: FeicaiAPI = {
  listProjects: () => invoke(IPC.PROJECT_LIST),
  getProject: (id: string) => invoke(IPC.PROJECT_GET, id),
  detectProjectDirectory: (dirPath: string) =>
    invoke(IPC.PROJECT_DETECT_DIR, dirPath),
  inspectProjectDirectory: (projectPath: string) =>
    invoke(IPC.PROJECT_INSPECT, projectPath),
  createProject: (data) => invoke(IPC.PROJECT_CREATE, data),
  updateProject: (id: string, data) => invoke(IPC.PROJECT_UPDATE, id, data),
  deleteProject: (id: string) => invoke(IPC.PROJECT_DELETE, id),
  listProjectEpisodes: (projectId: string) =>
    invoke(IPC.PROJECT_GET_STATUS, projectId),
  syncProjectStatus: (projectId: string, projectPath: string) =>
    invoke(IPC.PROJECT_SYNC_STATUS, projectId, projectPath),
  syncSingleEpisodeStatus: (params) =>
    invoke(IPC.PROJECT_SYNC_EPISODE_STATUS, params),
  getProjectPipelineState: (projectPath: string) =>
    invoke(IPC.PROJECT_GET_PIPELINE_STATE, projectPath),
  migrateLegacyNovelDirectory: (projectPath: string) =>
    invoke(IPC.PROJECT_MIGRATE_LEGACY_NOVEL, projectPath),
  repairProjectIssues: (params) => invoke(IPC.PROJECT_REPAIR, params),
  listSourceChapters: (projectId: string) =>
    invoke(IPC.PROJECT_LIST_SOURCE_CHAPTERS, projectId),
  getPlotBreakdownSummary: (projectId: string) =>
    invoke(IPC.PROJECT_GET_PLOT_BREAKDOWN_SUMMARY, projectId),

  listLLMConfigs: () => invoke(IPC.LLM_LIST_CONFIGS),
  addLLMConfig: (data) => invoke(IPC.LLM_ADD_CONFIG, data),
  updateLLMConfig: (id: string, data) =>
    invoke(IPC.LLM_UPDATE_CONFIG, id, data),
  deleteLLMConfig: (id: string) => invoke(IPC.LLM_DELETE_CONFIG, id),
  setDefaultLLM: (id: string) => invoke(IPC.LLM_SET_DEFAULT, id),
  testLLMConnection: (config) => invoke(IPC.LLM_TEST_CONNECTION, config),
  listLLMModels: (payload) => invoke(IPC.LLM_LIST_MODELS, payload),

  readTextFile: (filePath: string) => invoke(IPC.FILE_READ, filePath),
  writeTextFile: (filePath, content, expectedContent) =>
    invoke(IPC.FILE_WRITE, filePath, content, expectedContent),
  selectDirectory: () => invoke(IPC.FILE_SELECT_DIR),
  selectFile: (filters) => invoke(IPC.FILE_SELECT_FILE, filters),

  getExecutionStatus: () => invoke(IPC.EXECUTION_GET_STATUS),
  startPipeline: (params) => invoke(IPC.PIPELINE_START, params),
  runPipelineAndWait: (params) => invoke(IPC.PIPELINE_RUN_AND_WAIT, params),
  pausePipeline: (target) =>
    target === undefined
      ? invoke(IPC.PIPELINE_PAUSE)
      : invoke(IPC.PIPELINE_PAUSE, target),
  abortPipeline: (target) =>
    target === undefined
      ? invoke(IPC.PIPELINE_ABORT)
      : invoke(IPC.PIPELINE_ABORT, target),
  resumePipeline: (target) =>
    target === undefined
      ? invoke(IPC.PIPELINE_RESUME)
      : invoke(IPC.PIPELINE_RESUME, target),
  retryPipeline: (input) => invoke(IPC.PIPELINE_RETRY, input),
  skipPipeline: (input) => invoke(IPC.PIPELINE_SKIP, input),
  getPipelineState: (target) =>
    target === undefined
      ? invoke(IPC.PIPELINE_GET_STATE)
      : invoke(IPC.PIPELINE_GET_STATE, target),
  listPipelineTasks: () => invoke(IPC.PIPELINE_LIST_TASKS),
  getPipelineTask: (taskId) => invoke(IPC.PIPELINE_GET_TASK, taskId),
  controlPipelineTask: (request) => invoke(IPC.PIPELINE_CONTROL_TASK, request),
  onPipelineTaskChanged: (callback) =>
    subscribe(IPC.PIPELINE_TASK_CHANGED, callback),

  runStoryGeneration: (params) =>
    invoke(IPC.WORKFLOW_RUN_STORY_GENERATION, params),
  runStoryReview: (params) => invoke(IPC.WORKFLOW_RUN_STORY_REVIEW, params),
  runScriptGeneration: (params) =>
    invoke(IPC.WORKFLOW_RUN_SCRIPT_GENERATION, params),
  runScriptReview: (params) => invoke(IPC.WORKFLOW_RUN_SCRIPT_REVIEW, params),
  runCharacterDesign: (params) =>
    invoke(IPC.WORKFLOW_RUN_CHARACTER_DESIGN, params),
  runStoryboardReview: (params) =>
    invoke(IPC.WORKFLOW_RUN_STORYBOARD_REVIEW, params),

  listCharacters: (projectPath: string) =>
    invoke(IPC.ASSET_LIST_CHARACTERS, projectPath),
  listScenes: (projectPath: string) =>
    invoke(IPC.ASSET_LIST_SCENES, projectPath),
  updateAssetPrompt: (params) => invoke(IPC.ASSET_UPDATE_PROMPT, params),

  exportPrompts: (params) => invoke(IPC.EXPORT_PROMPTS, params),
  exportAllArtifacts: (params) => invoke(IPC.EXPORT_ALL, params),

  backupProject: (projectId) => invoke(DATA_IPC.BACKUP_PROJECT, projectId),
  restoreProject: () => invoke(DATA_IPC.RESTORE_PROJECT),
  backupDatabase: () => invoke(DATA_IPC.BACKUP_DATABASE),
  restoreDatabase: () => invoke(DATA_IPC.RESTORE_DATABASE),
  rebuildProjectIndex: (projectId) => invoke(DATA_IPC.REBUILD_INDEX, projectId),
  exportDiagnosticLogs: () => invoke(DATA_IPC.EXPORT_LOGS),
  clearStoredCredentials: () => invoke(DATA_IPC.CLEAR_CREDENTIALS),
  startBatch: (params) => invoke(BATCH_IPC.START, params),
  getBatchState: () => invoke(BATCH_IPC.GET_STATE),
  pauseBatch: (queueId) =>
    queueId === undefined
      ? invoke(BATCH_IPC.PAUSE)
      : invoke(BATCH_IPC.PAUSE, queueId),
  resumeBatch: (queueId) =>
    queueId === undefined
      ? invoke(BATCH_IPC.RESUME)
      : invoke(BATCH_IPC.RESUME, queueId),
  stopBatch: (queueId) =>
    queueId === undefined
      ? invoke(BATCH_IPC.STOP)
      : invoke(BATCH_IPC.STOP, queueId),
  onBatchState: (callback) => subscribe(BATCH_IPC.STATE_CHANGED, callback),

  onPipelineStateChanged: (callback) =>
    subscribe(IPC.PIPELINE_STATE_CHANGED, callback),
  onPipelineLog: (callback) => subscribe(IPC.PIPELINE_LOG, callback),
  onPipelineStream: (callback) => subscribe(IPC.PIPELINE_STREAM, callback),
  onPipelineStageComplete: (callback) =>
    subscribe(IPC.PIPELINE_STAGE_COMPLETE, callback),
  onPipelineReviewResult: (callback) =>
    subscribe(IPC.PIPELINE_REVIEW_RESULT, callback),
  onPipelineError: (callback) => subscribe(IPC.PIPELINE_ERROR, callback)
}

contextBridge.exposeInMainWorld('feicaiAPI', api)

export type { FeicaiAPI }
