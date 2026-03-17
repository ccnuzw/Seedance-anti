// ============================================================
// IPC 频道名称 — 主进程与渲染进程通信协议
// ============================================================

export const IPC = {
  // 项目管理
  PROJECT_CREATE: 'project:create',
  PROJECT_OPEN: 'project:open',
  PROJECT_IMPORT: 'project:import',
  PROJECT_LIST: 'project:list',
  PROJECT_GET: 'project:get',
  PROJECT_DELETE: 'project:delete',
  PROJECT_GET_STATUS: 'project:getStatus',
  PROJECT_SYNC_STATUS: 'project:syncStatus',

  // 流水线控制
  PIPELINE_START: 'pipeline:start',
  PIPELINE_PAUSE: 'pipeline:pause',
  PIPELINE_RESUME: 'pipeline:resume',
  PIPELINE_RETRY: 'pipeline:retry',
  PIPELINE_SKIP: 'pipeline:skip',
  PIPELINE_RUN_AND_WAIT: 'pipeline:runAndWait',
  PIPELINE_GET_STATE: 'pipeline:getState',
  PIPELINE_ABORT: 'pipeline:abort',

  // 流水线事件 (main → renderer 推送)
  PIPELINE_STATE_CHANGED: 'pipeline:stateChanged',
  PIPELINE_LOG: 'pipeline:log',
  PIPELINE_STREAM: 'pipeline:stream',
  PIPELINE_STAGE_COMPLETE: 'pipeline:stageComplete',
  PIPELINE_REVIEW_RESULT: 'pipeline:reviewResult',
  PIPELINE_ERROR: 'pipeline:error',

  // 资产管理
  ASSET_LIST_CHARACTERS: 'asset:listCharacters',
  ASSET_LIST_SCENES: 'asset:listScenes',
  ASSET_GET_REFERENCES: 'asset:getReferences',
  ASSET_UPLOAD_IMAGE: 'asset:uploadImage',
  ASSET_SYNC: 'asset:sync',

  // LLM 配置
  LLM_LIST_CONFIGS: 'llm:listConfigs',
  LLM_ADD_CONFIG: 'llm:addConfig',
  LLM_UPDATE_CONFIG: 'llm:updateConfig',
  LLM_DELETE_CONFIG: 'llm:deleteConfig',
  LLM_TEST_CONNECTION: 'llm:testConnection',
  LLM_SET_DEFAULT: 'llm:setDefault',
  LLM_LIST_MODELS: 'llm:listModels',

  // 文件操作
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_SELECT_DIR: 'file:selectDir',
  FILE_SELECT_FILE: 'file:selectFile',

  // 导出
  EXPORT_PROMPTS: 'export:prompts',
  EXPORT_ALL: 'export:all',

  // 持久化状态
  PROJECT_GET_PIPELINE_STATE: 'project:getPipelineState',

  // 应用
  APP_GET_VERSION: 'app:getVersion',
} as const

export type IPCChannel = (typeof IPC)[keyof typeof IPC]
