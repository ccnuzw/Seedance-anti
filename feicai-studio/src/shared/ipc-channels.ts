// ============================================================
// IPC 频道名称 — 主进程与渲染进程通信协议
// ============================================================

export const IPC = {
  // 项目管理
  PROJECT_CREATE: 'project:create',
  PROJECT_OPEN: 'project:open',
  PROJECT_LIST: 'project:list',
  PROJECT_GET: 'project:get',
  PROJECT_DELETE: 'project:delete',
  PROJECT_GET_STATUS: 'project:getStatus',
  PROJECT_SYNC_STATUS: 'project:syncStatus',
  PROJECT_GET_PROGRESS: 'project:getProgress',
  PROJECT_RUN_COMMAND: 'project:runCommand',
  PROJECT_UPDATE_PHASE: 'project:updatePhase',
  PROJECT_READ_CONFIG: 'project:readConfig',
  PROJECT_SAVE_CONFIG: 'project:saveConfig',
  PROJECT_IMPORT_BUNDLE: 'project:importBundle',

  // 导演阶段
  DIRECTOR_START: 'director:start',
  DIRECTOR_RUN_AND_WAIT: 'director:runAndWait',

  // 服化道阶段
  ART_START: 'art:start',
  ART_RUN_AND_WAIT: 'art:runAndWait',

  // 分镜 / Seedance 提示词阶段
  STORYBOARD_START: 'storyboard:start',
  STORYBOARD_RUN_AND_WAIT: 'storyboard:runAndWait',

  // 流水线控制
  PIPELINE_START: 'pipeline:start',
  PIPELINE_PAUSE: 'pipeline:pause',
  PIPELINE_RESUME: 'pipeline:resume',
  PIPELINE_RETRY: 'pipeline:retry',
  PIPELINE_SKIP: 'pipeline:skip',
  PIPELINE_RUN_AND_WAIT: 'pipeline:runAndWait',
  PIPELINE_GET_STATE: 'pipeline:getState',
  PIPELINE_ABORT: 'pipeline:abort',
  PIPELINE_LIST_RUNS: 'pipeline:listRuns',
  PIPELINE_ENQUEUE: 'pipeline:enqueue',
  PIPELINE_CANCEL_RUN: 'pipeline:cancelRun',
  PIPELINE_GET_RUN_DETAIL: 'pipeline:getRunDetail',
  PIPELINE_LIST_ALL_RUNS: 'pipeline:listAllRuns',
  PIPELINE_RETRY_RUN: 'pipeline:retryRun',
  PIPELINE_ARCHIVE_RUNS: 'pipeline:archiveRuns',
  PIPELINE_GET_DIAGNOSTICS: 'pipeline:getDiagnostics',
  PIPELINE_TRIGGER_AUTOMATION_SCAN: 'pipeline:triggerAutomationScan',
  PIPELINE_TRIGGER_RECOVERY_SWEEP: 'pipeline:triggerRecoverySweep',
  PIPELINE_TRIGGER_SCHEDULE: 'pipeline:triggerSchedule',

  // 流水线事件 (main → renderer 推送)
  PIPELINE_STATE_CHANGED: 'pipeline:stateChanged',
  PIPELINE_LOG: 'pipeline:log',
  PIPELINE_STREAM: 'pipeline:stream',
  PIPELINE_STAGE_COMPLETE: 'pipeline:stageComplete',
  PIPELINE_REVIEW_RESULT: 'pipeline:reviewResult',
  PIPELINE_ERROR: 'pipeline:error',
  PIPELINE_ALERT: 'pipeline:alert',

  // 资产管理
  ASSET_LIST_CHARACTERS: 'asset:listCharacters',
  ASSET_LIST_SCENES: 'asset:listScenes',
  ASSET_LOAD_PROMPTS: 'asset:loadPrompts',
  ASSET_PROMPT_STATS: 'asset:promptStats',
  ASSET_LIST_IMAGES: 'asset:listImages',
  ASSET_UPLOAD_IMAGE: 'asset:uploadImage',
  ASSET_UPDATE_PROMPT: 'asset:update-prompt',

  // 产物治理
  ARTIFACT_LIST: 'artifact:list',
  ARTIFACT_ROLLBACK: 'artifact:rollback',

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
  EXPORT_SCRIPTS: 'export:scripts',

  // 持久化状态
  PROJECT_GET_PIPELINE_STATE: 'project:getPipelineState',

  // 应用
  APP_GET_VERSION: 'app:getVersion',
  APP_GET_DELIVERY_STATUS: 'app:getDeliveryStatus',
  APP_EXPORT_DELIVERY_REPORT: 'app:exportDeliveryReport',

  // 项目内容访问
  SCRIPT_READ_EPISODE: 'script:readEpisode',
  SCRIPT_SAVE_EPISODE: 'script:saveEpisode',
  SCRIPT_LIST_EPISODES: 'script:listEpisodes',
  SCRIPT_GENERATE_EPISODE: 'script:generateEpisode',
  SCRIPT_LIST_VERSIONS: 'script:listVersions',
  PROMPT_READ_EPISODE_FILE: 'prompt:readEpisodeFile',
  PROMPT_SAVE_EPISODE_FILE: 'prompt:saveEpisodeFile',
  NOVEL_READ_CHAPTER: 'novel:readChapter',
  NOVEL_READ_CONTENT: 'novel:readContent',
  NOVEL_SAVE_CONTENT: 'novel:saveContent',
  PLOT_READ_RAW: 'plot:readRaw',
  PLOT_LIST_EPISODE_OUTLINES: 'plot:listEpisodeOutlines',
  PLOT_GET_EPISODE_OUTLINE: 'plot:getEpisodeOutline',
  PLOT_SAVE_EPISODE_OUTLINE: 'plot:saveEpisodeOutline',
  PLOT_DELETE_EPISODE_OUTLINE: 'plot:deleteEpisodeOutline',
  PLOT_GENERATE_EPISODE_OUTLINE: 'plot:generateEpisodeOutline',

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
  ADAPT_GENERATE_EPISODE: 'adapt:generateEpisode',
  ADAPT_REBUILD_BREAKDOWN: 'adapt:rebuildBreakdown',
  ADAPT_FIX: 'adapt:fix',
  ADAPT_CHECK_BREAKDOWN: 'adapt:checkBreakdown',
  ADAPT_CHECK_SCRIPT: 'adapt:checkScript',
  ADAPT_SMART_NEXT: 'adapt:smartNext',
  ADAPT_REVISE: 'adapt:revise',
  ADAPT_BREAKDOWN_AUTO: 'adapt:breakdownAuto',
  ADAPT_SCRIPT_AUTO: 'adapt:scriptAuto',
  ADAPT_ENSURE_PLAN: 'adapt:ensurePlan',
  ADAPT_SAVE_PLAN: 'adapt:savePlan',
  ADAPT_LOAD_PLAN: 'adapt:loadPlan',
  ADAPT_GENERATE_PLAN: 'adapt:generatePlan',
  ADAPT_SAVE_NOTES: 'adapt:saveNotes',
  ADAPT_LOAD_NOTES: 'adapt:loadNotes',
  ADAPT_SUBMIT_GUIDANCE: 'adapt:submitGuidance',

  // 编剧管线事件 (main → renderer 推送)
  ADAPT_STATE_CHANGED: 'adapt:stateChanged',
  ADAPT_LOG: 'adapt:log',
  ADAPT_STREAM: 'adapt:stream',
  ADAPT_STAGE_COMPLETE: 'adapt:stageComplete',
  ADAPT_REVIEW_RESULT: 'adapt:reviewResult',
  ADAPT_REVIEW_FAILED: 'adapt:reviewFailed',
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
