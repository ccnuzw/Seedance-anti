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
  PROJECT_UPDATE_PHASE: 'project:updatePhase',

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
  ASSET_UPDATE_PROMPT: 'asset:update-prompt',

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
  FILE_READDIR: 'file:readdir',
  FILE_SELECT_DIR: 'file:selectDir',
  FILE_SELECT_FILE: 'file:selectFile',

  // 导出
  EXPORT_PROMPTS: 'export:prompts',
  EXPORT_ALL: 'export:all',

  // 持久化状态
  PROJECT_GET_PIPELINE_STATE: 'project:getPipelineState',

  // 应用
  APP_GET_VERSION: 'app:getVersion',

  // 编剧管线（网文改编 · xiaoshuo-jqjb）
  ADAPT_START: 'adapt:start',
  ADAPT_BREAKDOWN: 'adapt:breakdown',
  ADAPT_SCRIPT: 'adapt:script',
  ADAPT_AUTO: 'adapt:auto',
  ADAPT_PAUSE: 'adapt:pause',
  ADAPT_ABORT: 'adapt:abort',
  ADAPT_GET_STATE: 'adapt:getState',
  ADAPT_GET_STATUS: 'adapt:getStatus',
  ADAPT_SCAN_NOVEL: 'adapt:scanNovel',
  ADAPT_INIT_PROJECT: 'adapt:initProject',
  ADAPT_RE_SCRIPT: 'adapt:reScript',
  ADAPT_FIX: 'adapt:fix',
  ADAPT_CHECK_BREAKDOWN: 'adapt:checkBreakdown',
  ADAPT_SMART_NEXT: 'adapt:smartNext',
  ADAPT_REVISE: 'adapt:revise',
  ADAPT_BREAKDOWN_AUTO: 'adapt:breakdownAuto',
  ADAPT_SCRIPT_AUTO: 'adapt:scriptAuto',
  ADAPT_ENSURE_PLAN: 'adapt:ensurePlan',
  ADAPT_SAVE_PLAN: 'adapt:savePlan',
  ADAPT_LOAD_PLAN: 'adapt:loadPlan',
  ADAPT_GENERATE_PLAN: 'adapt:generatePlan',

  // 编剧管线事件 (main → renderer 推送)
  ADAPT_STATE_CHANGED: 'adapt:stateChanged',
  ADAPT_LOG: 'adapt:log',
  ADAPT_STREAM: 'adapt:stream',
  ADAPT_STAGE_COMPLETE: 'adapt:stageComplete',
  ADAPT_REVIEW_RESULT: 'adapt:reviewResult',
  ADAPT_ERROR: 'adapt:error',

  // 小说管理
  NOVEL_IMPORT: 'novel:import',
  NOVEL_SCAN: 'novel:scan',
  NOVEL_READ_CHAPTERS: 'novel:readChapters',
  NOVEL_GET_INFO: 'novel:getInfo',

  // 剧情拆解
  PLOT_GET_BREAKDOWN: 'plot:getBreakdown',
  PLOT_GET_WATER_LEVEL: 'plot:getWaterLevel',
} as const

export type IPCChannel = (typeof IPC)[keyof typeof IPC]
