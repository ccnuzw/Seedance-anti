import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'))

const PORT = Number.parseInt(process.env.FEICAI_WEB_PLATFORM_PORT || '8787', 10)
const HOST = process.env.FEICAI_WEB_PLATFORM_HOST || '127.0.0.1'
const DATA_DIR = path.resolve(rootDir, process.env.FEICAI_WEB_DATA_DIR || '.web-platform-data')
const STATE_FILE = path.join(DATA_DIR, 'state.json')
const EXPORT_DIR = path.join(DATA_DIR, 'exports')
const adaptRuntimeByProjectPath = new Map()
const pipelineRuntimeByProjectPath = new Map()

const PIPELINE_STAGE_FLOW = [
  {
    stage: 'director',
    executing: 'director_analyzing',
    reviewing: 'director_reviewing',
    done: 'director_done',
    output: 'director-analysis',
    title: '导演分析',
    logLabel: '分镜导演分析'
  },
  {
    stage: 'art',
    executing: 'art_designing',
    reviewing: 'art_reviewing',
    done: 'art_done',
    output: 'art-prompts',
    title: '美术提示词',
    logLabel: '视觉设定与美术提示词'
  },
  {
    stage: 'storyboard',
    executing: 'storyboard_writing',
    reviewing: 'storyboard_reviewing',
    done: 'episode_complete',
    output: 'storyboard-prompts',
    title: '镜头脚本',
    logLabel: '分镜脚本与镜头提示词'
  }
]

function nowIso() {
  return new Date().toISOString()
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeProjectPath(projectPath) {
  return projectPath.replace(/\/+$/, '')
}

function buildProjectPath(projectId) {
  return `remote://project/${projectId}`
}

function buildScriptPath(projectPath, episodeNum) {
  return `${normalizeProjectPath(projectPath)}/script/EP${String(episodeNum).padStart(3, '0')}.md`
}

function buildPromptPath(projectPath, episodeNum, kind) {
  return `${normalizeProjectPath(projectPath)}/prompts/EP${String(episodeNum).padStart(3, '0')}.${kind}.md`
}

function buildDirectorAnalysisPath(projectPath, episodeNum) {
  return `${normalizeProjectPath(projectPath)}/analysis/EP${String(episodeNum).padStart(3, '0')}.director.md`
}

function buildAssetPromptPath(projectPath, assetType) {
  return `${normalizeProjectPath(projectPath)}/assets/${assetType}-prompts.json`
}

function buildNovelChapterPath(projectPath, chapterNum) {
  return `${normalizeProjectPath(projectPath)}/novel/chapter-${String(chapterNum).padStart(4, '0')}.txt`
}

function buildPlanPath(projectPath) {
  return `${normalizeProjectPath(projectPath)}/adapt/plan.json`
}

function buildNotesPath(projectPath) {
  return `${normalizeProjectPath(projectPath)}/adapt/notes.txt`
}

function buildPlotBreakdownPath(projectPath) {
  return `${normalizeProjectPath(projectPath)}/plot/plot-breakdown.md`
}

async function ensureDataLayout() {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.mkdir(EXPORT_DIR, { recursive: true })
  try {
    await fs.access(STATE_FILE)
  } catch {
    await fs.writeFile(STATE_FILE, JSON.stringify({
      llmConfigs: [],
      projects: [],
      files: {},
      pipelineRuns: [],
      artifacts: [],
      artifactContents: {}
    }, null, 2), 'utf8')
  }
}

async function readState() {
  await ensureDataLayout()
  const raw = await fs.readFile(STATE_FILE, 'utf8')
  const parsed = JSON.parse(raw)
  return {
    llmConfigs: Array.isArray(parsed.llmConfigs) ? parsed.llmConfigs : [],
    projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    files: parsed.files && typeof parsed.files === 'object' ? parsed.files : {},
    pipelineRuns: Array.isArray(parsed.pipelineRuns) ? parsed.pipelineRuns : [],
    artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
    artifactContents: parsed.artifactContents && typeof parsed.artifactContents === 'object' ? parsed.artifactContents : {}
  }
}

async function writeState(state) {
  await ensureDataLayout()
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}

async function writeExportFile(filename, content) {
  await ensureDataLayout()
  const filePath = path.join(EXPORT_DIR, filename)
  await fs.writeFile(filePath, content, 'utf8')
  return filePath
}

function createEpisode(project, episodeNumber, files) {
  const scriptPath = buildScriptPath(project.projectPath, episodeNumber)
  const promptsPath = buildPromptPath(project.projectPath, episodeNumber, 'prompts')
  const hasScript = typeof files[scriptPath] === 'string' && files[scriptPath].trim().length > 0
  const hasSeedancePrompts = typeof files[promptsPath] === 'string' && files[promptsPath].trim().length > 0
  return {
    id: `${project.id}:ep:${episodeNumber}`,
    projectId: project.id,
    episodeNumber,
    title: `第 ${episodeNumber} 集`,
    status: hasSeedancePrompts ? 'complete' : 'idle',
    scriptPath: hasScript ? scriptPath : undefined,
    seedancePromptsPath: hasSeedancePrompts ? promptsPath : undefined,
    hasScript,
    hasDirectorAnalysis: false,
    hasArtDesign: false,
    hasSeedancePrompts,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  }
}

function listEpisodes(project, files) {
  const totalEpisodes = Math.max(project.totalEpisodes || 0, 1)
  return Array.from({ length: totalEpisodes }, (_, index) => createEpisode(project, index + 1, files))
}

function listScriptDocs(projectPath, files) {
  const base = `${normalizeProjectPath(projectPath)}/script/`
  return Object.entries(files)
    .filter(([filePath, content]) => filePath.startsWith(base) && typeof content === 'string')
    .map(([filePath, content]) => {
      const match = filePath.match(/EP(\d+)\.md$/i)
      const episode = match ? Number.parseInt(match[1], 10) : 0
      return {
        episode,
        filename: path.basename(filePath),
        content
      }
    })
    .filter((item) => item.episode > 0)
    .sort((a, b) => a.episode - b.episode)
}

function listPromptDocs(projectPath, files, episodeRange = null, kind = 'prompts') {
  const base = `${normalizeProjectPath(projectPath)}/prompts/`
  const allowed = episodeRange ? new Set(episodeRange) : null
  return Object.entries(files)
    .filter(([filePath, content]) => filePath.startsWith(base) && filePath.endsWith(`.${kind}.md`) && typeof content === 'string')
    .map(([filePath, content]) => {
      const match = filePath.match(/EP(\d+)\./i)
      const episode = match ? Number.parseInt(match[1], 10) : 0
      return {
        episode,
        filename: path.basename(filePath),
        content
      }
    })
    .filter((item) => item.episode > 0 && (!allowed || allowed.has(item.episode)))
    .sort((a, b) => a.episode - b.episode)
}

function resolvePromptArtifactPath(projectPath, episodeNum, kind) {
  if (kind === 'director') return buildDirectorAnalysisPath(projectPath, episodeNum)
  return buildPromptPath(projectPath, episodeNum, kind)
}

function readPromptArtifact(files, projectPath, episodeNum, kind) {
  const primary = resolvePromptArtifactPath(projectPath, episodeNum, kind)
  if (typeof files[primary] === 'string') return files[primary]
  if (kind === 'art') {
    return files[buildPromptPath(projectPath, episodeNum, 'prompts')] || null
  }
  return null
}

function listNovelDocs(projectPath, files) {
  const base = `${normalizeProjectPath(projectPath)}/novel/`
  return Object.entries(files)
    .filter(([filePath, content]) => filePath.startsWith(base) && filePath.endsWith('.txt') && typeof content === 'string')
    .map(([filePath, content]) => {
      const match = filePath.match(/chapter-(\d+)\.txt$/i)
      const chapterNum = match ? Number.parseInt(match[1], 10) : 0
      return {
        chapterNum,
        filename: path.basename(filePath),
        content
      }
    })
    .filter((item) => item.chapterNum > 0)
    .sort((a, b) => a.chapterNum - b.chapterNum)
}

function buildDerivedBreakdown(project, files) {
  const chapters = listNovelDocs(project.projectPath, files)
  const allPlots = chapters.map((chapter, index) => ({
    id: index + 1,
    scene: `第${chapter.chapterNum}章`,
    description: chapter.content.trim().slice(0, 80) || chapter.filename,
    hookType: 'chapter',
    episode: Math.max(1, Math.ceil((index + 1) / 3)),
    status: 'unused',
    batch: Math.max(1, Math.ceil((index + 1) / 6))
  }))
  const batches = Array.from(new Set(allPlots.map((plot) => plot.batch))).map((batchNumber) => {
    const plots = allPlots.filter((plot) => plot.batch === batchNumber)
    return {
      batchNumber,
      chapterStart: plots[0]?.id || 0,
      chapterEnd: plots[plots.length - 1]?.id || 0,
      plots
    }
  })
  const data = {
    title: project.novelTitle || project.name,
    genre: project.novelGenre || '未分类',
    batches,
    allPlots
  }
  const raw = [
    `# ${data.title} Plot Breakdown`,
    '',
    '## 改编规划',
    '',
    chapters.length > 0 ? `共 ${chapters.length} 章，当前按每 3 章约映射 1 集、每 6 章分为 1 个批次。` : '暂无章节。',
    '',
    '## 剧情点清单',
    '',
    ...allPlots.map((plot) => `- 第${plot.id}章 -> EP${String(plot.episode).padStart(3, '0')}：${plot.description}`)
  ].join('\n')
  return { data, raw }
}

function buildWaterLevel(project, files) {
  const chapters = listNovelDocs(project.projectPath, files)
  const scripts = listScriptDocs(project.projectPath, files)
  const totalChapters = chapters.length
  return {
    unusedPlots: totalChapters,
    unprocessedChapters: 0,
    completedEpisodes: 0,
    totalPlots: totalChapters,
    totalChapters,
    processedChapters: totalChapters,
    assignedEpisodes: Math.ceil(totalChapters / 3),
    scriptEpisodes: scripts.length,
    pendingScriptEpisodes: Math.max(Math.ceil(totalChapters / 3) - scripts.length, 0),
    fullyUsedEpisodes: scripts.length,
    partialUsedEpisodes: 0
  }
}

function parsePromptMarkdown(raw) {
  if (!raw || typeof raw !== 'string') return []
  const sections = raw.split(/^## /m).slice(1)
  return sections.map((section, index) => {
    const lines = section.trim().split('\n')
    const title = lines[0]?.trim() || `提示词 ${index + 1}`
    const durationMatch = section.match(/时长[：:]\s*(\d+)\s*[秒s]/i) || section.match(/(\d+)\s*[秒s]/i)
    const duration = durationMatch ? Number.parseInt(durationMatch[1], 10) : 5
    const content = lines
      .slice(1)
      .filter((line) => !line.startsWith('**') && line.trim().length > 0)
      .join('\n')
      .trim()
    const references = []
    const refMatches = section.matchAll(/@(图片\d+|场景图\d+)/g)
    for (const match of refMatches) {
      references.push({
        referenceTag: match[0],
        assetType: match[1].startsWith('场景') ? 'scene' : 'character'
      })
    }
    return {
      index,
      title,
      content,
      duration,
      references
    }
  }).filter((item) => item.content.length > 0)
}

function readAssetPromptOverrides(projectPath, state, assetType) {
  const raw = state.files[buildAssetPromptPath(projectPath, assetType)]
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAssetPromptOverrides(state, projectPath, assetType, overrides) {
  return {
    ...state,
    files: {
      ...state.files,
      [buildAssetPromptPath(projectPath, assetType)]: JSON.stringify(overrides, null, 2)
    }
  }
}

function buildDerivedAssets(project, state) {
  const projectId = project.id
  const promptDocs = listPromptDocs(project.projectPath, state.files)
  const parsedPrompts = promptDocs.flatMap((doc) => parsePromptMarkdown(doc.content))
  const characterOverrides = readAssetPromptOverrides(project.projectPath, state, 'character')
  const sceneOverrides = readAssetPromptOverrides(project.projectPath, state, 'scene')
  const characterMap = new Map()
  const sceneMap = new Map()

  for (const prompt of parsedPrompts) {
    const characterRefs = prompt.references.filter((ref) => ref.assetType === 'character')
    const sceneRefs = prompt.references.filter((ref) => ref.assetType === 'scene')

    if (characterRefs.length === 0 && prompt.title.includes('人物')) {
      characterRefs.push({ referenceTag: '@图片1', assetType: 'character' })
    }
    if (sceneRefs.length === 0 && (prompt.title.includes('场景') || prompt.title.includes('镜头'))) {
      sceneRefs.push({ referenceTag: '@场景图1', assetType: 'scene' })
    }

    for (const ref of characterRefs) {
      const key = ref.referenceTag
      if (characterMap.has(key)) continue
      const overrideText = characterOverrides[key]
      characterMap.set(key, {
        id: `${projectId}-character-${key.replace(/[^a-zA-Z0-9]+/g, '-')}`,
        projectId,
        name: key.replace('@', ''),
        alias: prompt.title,
        appearance: '来自当前提示词引用',
        promptText: typeof overrideText === 'string' && overrideText.trim()
          ? overrideText
          : `${prompt.title}\n\n${prompt.content}`.trim(),
        firstEpisode: promptDocs[0]?.episode || 1,
        isVariant: false,
        createdAt: project.createdAt
      })
    }

    for (const ref of sceneRefs) {
      const key = ref.referenceTag
      if (sceneMap.has(key)) continue
      const overrideText = sceneOverrides[key]
      sceneMap.set(key, {
        id: `${projectId}-scene-${key.replace(/[^a-zA-Z0-9]+/g, '-')}`,
        projectId,
        name: key.replace('@', ''),
        timeOfDay: '未标注',
        atmosphere: prompt.title,
        promptText: typeof overrideText === 'string' && overrideText.trim()
          ? overrideText
          : `${prompt.title}\n\n${prompt.content}`.trim(),
        createdAt: project.createdAt
      })
    }
  }

  return {
    characters: [...characterMap.values()],
    scenes: [...sceneMap.values()]
  }
}

function createLogEntry(projectPath, stage, message, level = 'info', eventType = 'status') {
  return {
    id: createId('log'),
    episodeId: projectPath,
    stage,
    level,
    eventType,
    message,
    timestamp: nowIso()
  }
}

function buildAdaptStatus(project, files) {
  const chapters = listNovelDocs(project.projectPath, files)
  return {
    novelInfo: chapters.length > 0 ? {
      title: project.novelTitle || project.name,
      genre: project.novelGenre || '未分类',
      totalChapters: chapters.length,
      chaptersDir: `${normalizeProjectPath(project.projectPath)}/novel`
    } : null,
    waterLevel: buildWaterLevel(project, files),
    state: chapters.length > 0 ? 'breakdown_done' : 'adapt_idle'
  }
}

function createAdaptContext(project, files, overrides = {}) {
  const status = buildAdaptStatus(project, files)
  return {
    projectId: project.id,
    projectPath: project.projectPath,
    currentStage: overrides.currentStage || 'breakdown',
    state: overrides.state || status.state,
    retryCount: 0,
    currentBatch: overrides.currentBatch || 0,
    chaptersPerBatch: 6,
    totalChapters: status.waterLevel.totalChapters,
    processedChapters: status.waterLevel.processedChapters,
    currentScriptBatch: overrides.currentScriptBatch || 0,
    waterLevel: status.waterLevel,
    reviews: [],
    logs: [],
    adaptPlan: overrides.adaptPlan,
    userNotes: overrides.userNotes,
    ...overrides
  }
}

function getAdaptRuntime(projectPath) {
  return adaptRuntimeByProjectPath.get(projectPath) || null
}

function setAdaptRuntime(projectPath, runtime) {
  adaptRuntimeByProjectPath.set(projectPath, runtime)
}

function clearAdaptRuntime(projectPath) {
  const runtime = adaptRuntimeByProjectPath.get(projectPath)
  if (runtime?.timeoutIds) {
    for (const timeoutId of runtime.timeoutIds) clearTimeout(timeoutId)
  }
  adaptRuntimeByProjectPath.delete(projectPath)
}

function getPipelineRuntime(projectPath) {
  return pipelineRuntimeByProjectPath.get(projectPath) || null
}

function setPipelineRuntime(projectPath, runtime) {
  pipelineRuntimeByProjectPath.set(projectPath, runtime)
}

function clearPipelineRuntime(projectPath) {
  const runtime = pipelineRuntimeByProjectPath.get(projectPath)
  if (runtime?.timerIds) {
    for (const timerId of runtime.timerIds) clearTimeout(timerId)
  }
  if (runtime?.resumeResolvers) {
    for (const resolver of runtime.resumeResolvers) resolver()
  }
  pipelineRuntimeByProjectPath.delete(projectPath)
}

function getPipelineStageConfig(stage) {
  return PIPELINE_STAGE_FLOW.find((item) => item.stage === stage) || PIPELINE_STAGE_FLOW[0]
}

function buildPipelineScript(project, episodeNum, state) {
  const existing = state.files[buildScriptPath(project.projectPath, episodeNum)]
  if (typeof existing === 'string' && existing.trim()) return existing
  return buildEpisodeScript(project, episodeNum, state)
}

function createPipelineRunRecord(project, params = {}) {
  const now = nowIso()
  const stage = params.startStage || 'director'
  const strategy = params.strategy || {}
  const orchestration = params.orchestration || {}
  const rootRunId = strategy.rootRunId || createId('pipeline-root')
  return {
    runId: createId('pipeline-run'),
    projectId: project.id,
    projectName: project.name,
    projectPath: project.projectPath,
    episodeNum: params.episodeNum,
    currentStage: stage,
    status: params.status || 'queued',
    state: params.state || 'idle',
    singleStage: !!params.singleStage,
    queuedAt: params.queuedAt || now,
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    lastUpdatedAt: now,
    queuePosition: params.queuePosition,
    errorMessage: params.errorMessage,
    batchId: strategy.batchId,
    batchLabel: strategy.batchLabel,
    priority: strategy.priority || 'normal',
    maxAutoRetries: Number.isFinite(strategy.maxAutoRetries) ? strategy.maxAutoRetries : 0,
    attempt: Number.isFinite(strategy.attempt) ? strategy.attempt : 1,
    rootRunId,
    workerSlot: params.workerSlot,
    archivedAt: params.archivedAt,
    deadLetteredAt: params.deadLetteredAt,
    recoveryNote: params.recoveryNote,
    dependsOnRootRunId: orchestration.dependsOnRootRunId,
    triggerCondition: orchestration.condition || 'always',
    scheduledAt: orchestration.scheduledAt,
    templateId: strategy.templateId,
    templateLabel: strategy.templateLabel,
    scheduleId: orchestration.scheduleId,
    scheduleLabel: orchestration.scheduleLabel,
    automationKey: orchestration.automationKey,
    telemetry: params.telemetry || {
      callCount: 0,
      successCount: 0,
      failureCount: 0,
      totalDurationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      lastCalledAt: undefined
    }
  }
}

function createPipelineContextFromRun(run, overrides = {}) {
  return {
    runId: run.runId,
    projectId: run.projectId,
    projectPath: run.projectPath,
    episodeNum: run.episodeNum,
    currentStage: overrides.currentStage || run.currentStage || 'director',
    state: overrides.state || run.state || 'idle',
    singleStage: overrides.singleStage ?? run.singleStage,
    retryCount: Math.max((run.attempt || 1) - 1, 0),
    runStartedAt: overrides.runStartedAt || run.startedAt,
    runEndedAt: overrides.runEndedAt || run.endedAt,
    lastUpdatedAt: overrides.lastUpdatedAt || run.lastUpdatedAt || nowIso(),
    scriptPath: overrides.scriptPath || buildScriptPath(run.projectPath, run.episodeNum),
    directorAnalysisPath: overrides.directorAnalysisPath || buildDirectorAnalysisPath(run.projectPath, run.episodeNum),
    seedancePromptsPath: overrides.seedancePromptsPath || buildPromptPath(run.projectPath, run.episodeNum, 'prompts'),
    reviews: overrides.reviews || [],
    logs: overrides.logs || [],
    lastReviewFeedback: overrides.lastReviewFeedback,
    error: overrides.error
  }
}

function createIdlePipelineContext(projectPath = '', projectId = '') {
  return {
    runId: '',
    projectId,
    projectPath,
    episodeNum: 1,
    currentStage: 'director',
    state: 'idle',
    singleStage: false,
    retryCount: 0,
    reviews: [],
    logs: [],
    lastUpdatedAt: nowIso()
  }
}

function listPipelineEntries(state, includeArchived = false) {
  const entries = Array.isArray(state.pipelineRuns) ? state.pipelineRuns : []
  return entries
    .filter((entry) => includeArchived || !entry?.run?.archivedAt)
    .sort((a, b) => new Date(b.run?.lastUpdatedAt || 0).getTime() - new Date(a.run?.lastUpdatedAt || 0).getTime())
}

function hashContent(content) {
  return createHash('sha1').update(content || '').digest('hex')
}

function inferArtifactKind(filePath) {
  if (filePath.includes('/script/')) return 'script_episode'
  if (filePath.includes('/analysis/')) return 'director_output'
  if (filePath.includes('/prompts/')) return 'seedance_prompts'
  if (filePath.endsWith('/plot/plot-breakdown.md')) return 'plot_breakdown'
  if (filePath.endsWith('/adapt/plan.json')) return 'adapt_plan'
  if (filePath.endsWith('/adapt/notes.txt')) return 'adapt_notes'
  return 'pipeline_state'
}

function inferArtifactStage(kind) {
  if (kind === 'director_output') return 'director'
  if (kind === 'seedance_prompts') return 'storyboard'
  if (kind === 'art_output') return 'art'
  return undefined
}

function inferArtifactLabel(kind, episodeNum) {
  if (kind === 'script_episode') return `EP${String(episodeNum || 0).padStart(3, '0')} 剧本`
  if (kind === 'director_output') return `EP${String(episodeNum || 0).padStart(3, '0')} 导演分析`
  if (kind === 'seedance_prompts') return `EP${String(episodeNum || 0).padStart(3, '0')} 分镜提示词`
  if (kind === 'plot_breakdown') return '剧情拆解'
  if (kind === 'adapt_plan') return '改编规划'
  if (kind === 'adapt_notes') return '用户笔记'
  return path.basename(kind)
}

function buildArtifactScopeKey(kind, episodeNum, stage, filePath) {
  if (episodeNum) return `${kind}:ep:${episodeNum}`
  if (stage) return `${kind}:stage:${stage}`
  return `${kind}:${filePath}`
}

function extractEpisodeNum(filePath) {
  const match = filePath.match(/EP(\d+)/i)
  return match ? Number.parseInt(match[1], 10) : undefined
}

function createArtifactSnapshot(state, params) {
  const kind = params.kind || inferArtifactKind(params.filePath)
  const episodeNum = params.episodeNum || extractEpisodeNum(params.filePath)
  const stage = params.stage || inferArtifactStage(kind)
  const scopeKey = buildArtifactScopeKey(kind, episodeNum, stage, params.filePath)
  const existing = (state.artifacts || []).filter((item) => item.scopeKey === scopeKey)
  const version = existing.length + 1
  const snapshotPath = `${params.filePath}#snapshot-v${version}`
  const content = params.content || ''
  const record = {
    id: createId('artifact'),
    projectPath: params.projectPath,
    kind,
    label: params.label || inferArtifactLabel(kind, episodeNum),
    scopeKey,
    filePath: params.filePath,
    snapshotPath,
    episodeNum,
    stage,
    sourceRunId: params.sourceRunId,
    createdBy: params.createdBy || 'system',
    version,
    contentType: params.contentType || 'text/markdown',
    sizeBytes: Buffer.byteLength(content, 'utf8'),
    hash: hashContent(content),
    isCurrent: true,
    createdAt: nowIso(),
    metadata: params.metadata || {}
  }
  const nextArtifacts = (state.artifacts || []).map((item) => (
    item.scopeKey === scopeKey ? { ...item, isCurrent: false } : item
  )).concat(record)
  const nextArtifactContents = {
    ...(state.artifactContents || {}),
    [snapshotPath]: content
  }
  return {
    ...state,
    artifacts: nextArtifacts,
    artifactContents: nextArtifactContents
  }
}

function buildProjectPipelineState(projectPath, state) {
  const related = listPipelineEntries(state, true).filter((entry) => entry.run.projectPath === projectPath)
  const episodes = {}
  for (const entry of related) {
    const episodeNum = entry.run.episodeNum
    const current = episodes[episodeNum] || {
      reviews: [],
      completedStages: [],
      status: 'idle',
      updatedAt: entry.run.lastUpdatedAt
    }
    const stageHistory = new Set(current.completedStages)
    for (const review of entry.context?.reviews || []) {
      current.reviews.push(review)
      if (review.passed) stageHistory.add(String(review.stage))
    }
    if (entry.run.state === 'director_done' || entry.run.state === 'art_done' || entry.run.state === 'episode_complete') {
      stageHistory.add(entry.run.currentStage)
    }
    current.completedStages = Array.from(stageHistory)
    current.updatedAt = current.updatedAt > entry.run.lastUpdatedAt ? current.updatedAt : entry.run.lastUpdatedAt
    if (entry.run.status === 'completed' || entry.run.state === 'episode_complete') current.status = 'complete'
    else if (entry.run.status === 'running' || entry.run.status === 'paused') current.status = entry.run.currentStage
    else if (entry.run.status === 'failed') current.status = 'error'
    episodes[episodeNum] = current
  }
  return { episodes }
}

function findPipelineEntry(state, runId) {
  return (state.pipelineRuns || []).find((entry) => entry.run?.runId === runId) || null
}

async function updatePipelineEntry(runId, updater) {
  const state = await readState()
  const nextRuns = (state.pipelineRuns || []).map((entry) => {
    if (entry.run?.runId !== runId) return entry
    return updater(entry)
  })
  const nextState = { ...state, pipelineRuns: nextRuns }
  await writeState(nextState)
  return findPipelineEntry(nextState, runId)
}

async function appendPipelineLog(runId, log) {
  return updatePipelineEntry(runId, (entry) => {
    const logs = [...(entry.logs || []), log].slice(-500)
    return {
      ...entry,
      logs,
      run: {
        ...entry.run,
        lastUpdatedAt: log.timestamp
      }
    }
  })
}

async function appendPipelineLLMCall(runId, llmCall) {
  return updatePipelineEntry(runId, (entry) => {
    const llmCalls = [...(entry.llmCalls || []), llmCall]
    const telemetry = {
      ...(entry.run.telemetry || {}),
      callCount: llmCalls.length,
      successCount: llmCalls.filter((item) => item.status === 'success').length,
      failureCount: llmCalls.filter((item) => item.status === 'failed').length,
      totalDurationMs: llmCalls.reduce((sum, item) => sum + (item.durationMs || 0), 0),
      inputTokens: llmCalls.reduce((sum, item) => sum + (item.usage?.inputTokens || 0), 0),
      outputTokens: llmCalls.reduce((sum, item) => sum + (item.usage?.outputTokens || 0), 0),
      totalTokens: llmCalls.reduce((sum, item) => sum + (item.usage?.totalTokens || 0), 0),
      estimatedCostUsd: Number(llmCalls.reduce((sum, item) => sum + (item.estimatedCostUsd || 0), 0).toFixed(4)),
      lastProvider: llmCalls[llmCalls.length - 1]?.provider,
      lastModel: llmCalls[llmCalls.length - 1]?.model,
      lastFailureClass: llmCalls.slice().reverse().find((item) => item.failureClass)?.failureClass,
      lastCalledAt: llmCalls[llmCalls.length - 1]?.endedAt || nowIso()
    }
    return {
      ...entry,
      llmCalls,
      run: {
        ...entry.run,
        telemetry,
        lastUpdatedAt: nowIso()
      }
    }
  })
}

function isRunTerminalStatus(status) {
  return ['completed', 'failed', 'aborted', 'dead_letter'].includes(status)
}

function isDependencySatisfied(state, run) {
  if (!run.dependsOnRootRunId) return true
  const dependencyRuns = (state.pipelineRuns || []).filter((entry) => entry.run?.rootRunId === run.dependsOnRootRunId)
  if (dependencyRuns.length === 0) return false
  const latest = dependencyRuns
    .map((entry) => entry.run)
    .sort((a, b) => new Date(b.lastUpdatedAt || 0).getTime() - new Date(a.lastUpdatedAt || 0).getTime())[0]
  if (!latest || !isRunTerminalStatus(latest.status)) return false
  if (run.triggerCondition === 'on_success') return latest.status === 'completed'
  if (run.triggerCondition === 'on_failure') return latest.status === 'failed' || latest.status === 'dead_letter'
  return true
}

function isScheduleSatisfied(run) {
  if (!run.scheduledAt) return true
  return new Date(run.scheduledAt).getTime() <= Date.now()
}

async function listRunnablePipelineEntries() {
  const state = await readState()
  return listPipelineEntries(state, true)
    .filter((entry) => entry.run?.status === 'queued')
    .filter((entry) => isScheduleSatisfied(entry.run) && isDependencySatisfied(state, entry.run))
    .sort((a, b) => {
      const priorityRank = { high: 0, normal: 1, low: 2 }
      const rankDiff = priorityRank[a.run.priority] - priorityRank[b.run.priority]
      if (rankDiff !== 0) return rankDiff
      return new Date(a.run.queuedAt).getTime() - new Date(b.run.queuedAt).getTime()
    })
}

function projectFiles(projectPath, files) {
  const prefix = `${normalizeProjectPath(projectPath)}/`
  return Object.fromEntries(Object.entries(files).filter(([filePath]) => filePath.startsWith(prefix)))
}

function createDeliveryStatus(state) {
  const llmConfigs = state.llmConfigs || []
  const projects = state.projects || []
  const diagnostics = buildPipelineDiagnostics(state)
  return {
    generatedAt: nowIso(),
    version: `${packageJson.version}-web-platform`,
    packaged: false,
    platform: 'web-server',
    arch: process.arch,
    paths: {
      userData: DATA_DIR,
      database: STATE_FILE,
      logsDir: DATA_DIR,
      runtimeLog: path.join(DATA_DIR, 'runtime.log'),
      reportsDir: EXPORT_DIR
    },
    readiness: {
      score: llmConfigs.length > 0 ? 72 : 48,
      issueCount: 0,
      warningCount: llmConfigs.length > 0 ? 0 : 1,
      llmConfigCount: llmConfigs.length,
      defaultLLMCount: llmConfigs.filter((item) => item.isDefault).length,
      projectCount: projects.length,
      readyForDelivery: false
    },
    runtime: {
      openWindowCount: 0,
      activeRunId: diagnostics.activeRun?.runId,
      queuedRunCount: diagnostics.queueSummary.total,
      deadLetterCount: diagnostics.queueSummary.deadLetter,
      automationEnabledCount: diagnostics.automation.enabledScheduleCount,
      telemetryCallCount: diagnostics.telemetry.callCount
    },
    recentErrors: [],
    issues: llmConfigs.length > 0
      ? []
      : [{ severity: 'warning', code: 'NO_LLM_CONFIG', message: '当前远程平台尚未配置模型。' }]
  }
}

async function exportBundle(state, params) {
  const project = state.projects.find((item) => item.projectPath === params.projectPath)
  const bundle = {
    version: 1,
    exportedAt: nowIso(),
    project,
    files: projectFiles(params.projectPath, state.files)
  }
  const filePath = await writeExportFile(`${params.projectName}-bundle.json`, JSON.stringify(bundle, null, 2))
  const prompts = listPromptDocs(params.projectPath, state.files)
  const scripts = listScriptDocs(params.projectPath, state.files)
  return { success: true, path: filePath, count: scripts.length + prompts.length }
}

async function exportScripts(state, params) {
  const allowed = new Set(params.episodeRange || [])
  const docs = listScriptDocs(params.projectPath, state.files).filter((doc) => allowed.has(doc.episode))
  const content = docs.length > 0
    ? docs.map((doc) => `# EP${String(doc.episode).padStart(3, '0')}\n\n${doc.content}`).join('\n\n---\n\n')
    : '# 暂无剧本文件\n'
  const filePath = await writeExportFile(`${params.projectName}-scripts.md`, content)
  return { success: true, path: filePath, count: docs.length }
}

async function exportPrompts(state, params) {
  const docs = listPromptDocs(params.projectPath, state.files, params.episodeRange || [])
  let content = ''
  let filename = `${params.projectName}-prompts.md`
  if (params.format === 'json') {
    content = JSON.stringify(docs, null, 2)
    filename = `${params.projectName}-prompts.json`
  } else if (params.format === 'csv') {
    content = ['episode,filename,content']
      .concat(docs.map((doc) => `${doc.episode},"${doc.filename.replace(/"/g, '""')}","${doc.content.replace(/"/g, '""').replace(/\n/g, '\\n')}"`))
      .join('\n')
    filename = `${params.projectName}-prompts.csv`
  } else {
    content = docs.length > 0
      ? docs.map((doc) => `# EP${String(doc.episode).padStart(3, '0')}\n\n${doc.content}`).join('\n\n---\n\n')
      : '# 暂无提示词文件\n'
  }
  const filePath = await writeExportFile(filename, content)
  return { success: true, path: filePath, count: docs.length }
}

async function importBundle(state, bundle) {
  if (!bundle || bundle.version !== 1 || !bundle.project || !bundle.files) {
    throw new Error('Invalid project bundle')
  }
  const sourceProject = bundle.project
  const projectId = createId('project')
  const projectPath = buildProjectPath(projectId)
  const importedProject = {
    ...sourceProject,
    id: projectId,
    name: `${sourceProject.name}（导入）`,
    projectPath,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    config: {
      ...sourceProject.config,
      projectName: `${sourceProject.name}（导入）`
    }
  }
  const nextFiles = { ...state.files }
  for (const [filePath, content] of Object.entries(bundle.files)) {
    const remapped = filePath.replace(normalizeProjectPath(sourceProject.projectPath), normalizeProjectPath(projectPath))
    nextFiles[remapped] = content
  }
  const nextState = {
    ...state,
    projects: [importedProject, ...state.projects],
    files: nextFiles
  }
  await writeState(nextState)
  return importedProject
}

async function invokeChannel(channel, args) {
  const state = await readState()
  switch (channel) {
    case 'app:getVersion':
      return `${packageJson.version}-web-platform`
    case 'app:getDeliveryStatus':
      return createDeliveryStatus(state)
    case 'app:exportDeliveryReport': {
      const status = createDeliveryStatus(state)
      const filePath = await writeExportFile(`feicai-delivery-report-${Date.now()}.json`, JSON.stringify(status, null, 2))
      return { filePath, status }
    }
    case 'llm:listConfigs':
      return state.llmConfigs
    case 'llm:addConfig': {
      const [data] = args
      const config = { ...data, id: createId('llm') }
      const nextConfigs = data.isDefault
        ? state.llmConfigs.map((item) => item.category === data.category ? { ...item, isDefault: false } : item).concat(config)
        : state.llmConfigs.concat(config)
      await writeState({ ...state, llmConfigs: nextConfigs })
      return config
    }
    case 'llm:updateConfig': {
      const [id, patch] = args
      const current = state.llmConfigs.find((item) => item.id === id)
      if (!current) throw new Error('配置不存在')
      const merged = { ...current, ...patch, id }
      const nextConfigs = state.llmConfigs.map((item) => {
        if (item.id === id) return merged
        if (merged.isDefault && item.category === merged.category) return { ...item, isDefault: false }
        return item
      })
      await writeState({ ...state, llmConfigs: nextConfigs })
      return { success: true }
    }
    case 'llm:deleteConfig': {
      const [id] = args
      await writeState({ ...state, llmConfigs: state.llmConfigs.filter((item) => item.id !== id) })
      return { success: true }
    }
    case 'llm:setDefault': {
      const [id] = args
      const target = state.llmConfigs.find((item) => item.id === id)
      if (!target) throw new Error('配置不存在')
      const nextConfigs = state.llmConfigs.map((item) => ({
        ...item,
        isDefault: item.id === id ? true : item.category === target.category ? false : item.isDefault
      }))
      await writeState({ ...state, llmConfigs: nextConfigs })
      return { success: true }
    }
    case 'llm:testConnection':
      return { success: false, message: '最小 web platform 暂未代理第三方模型测试，请在同源 API 网关中实现。' }
    case 'llm:listModels':
      return { success: false, models: [], message: '最小 web platform 暂未代理模型列表，请在同源 API 网关中实现。' }
    case 'project:list':
      return state.projects
    case 'project:get': {
      const [id] = args
      return state.projects.find((item) => item.id === id) || null
    }
    case 'project:create': {
      const [data] = args
      const now = nowIso()
      const projectId = createId('project')
      const project = {
        id: projectId,
        name: data.name,
        sourceType: data.sourceType || 'script',
        phase: data.phase || 'writing',
        visualStyle: data.visualStyle,
        targetMedium: data.targetMedium,
        projectPath: data.projectPath || buildProjectPath(projectId),
        totalEpisodes: data.totalEpisodes,
        novelTitle: data.novelTitle,
        novelGenre: data.novelGenre,
        config: {
          projectName: data.name,
          sourceType: data.sourceType || 'script',
          phase: data.phase || 'writing',
          totalEpisodes: data.totalEpisodes,
          visualStyle: data.visualStyle,
          targetMedium: data.targetMedium,
          novelTitle: data.novelTitle,
          novelGenre: data.novelGenre,
          createdAt: now,
          ...(data.config || {})
        },
        createdAt: now,
        updatedAt: now
      }
      await writeState({ ...state, projects: [project, ...state.projects] })
      return project
    }
    case 'project:delete': {
      const [id] = args
      const project = state.projects.find((item) => item.id === id)
      const nextProjects = state.projects.filter((item) => item.id !== id)
      const nextFiles = { ...state.files }
      if (project) {
        const prefix = `${normalizeProjectPath(project.projectPath)}/`
        for (const filePath of Object.keys(nextFiles)) {
          if (filePath.startsWith(prefix)) {
            delete nextFiles[filePath]
          }
        }
      }
      await writeState({ ...state, projects: nextProjects, files: nextFiles })
      return { success: true }
    }
    case 'project:updatePhase': {
      const [id, phase] = args
      let updated = null
      const nextProjects = state.projects.map((project) => {
        if (project.id !== id) return project
        updated = {
          ...project,
          phase,
          updatedAt: nowIso(),
          config: { ...project.config, phase }
        }
        return updated
      })
      await writeState({ ...state, projects: nextProjects })
      return updated
    }
    case 'project:saveConfig': {
      const [projectPath, config] = args
      let updated = null
      const nextProjects = state.projects.map((project) => {
        if (project.projectPath !== projectPath) return project
        const nextConfig = { ...project.config, ...config }
        updated = {
          ...project,
          name: nextConfig.projectName || project.name,
          sourceType: nextConfig.sourceType || project.sourceType,
          phase: nextConfig.phase || project.phase,
          visualStyle: nextConfig.visualStyle || project.visualStyle,
          targetMedium: nextConfig.targetMedium || project.targetMedium,
          totalEpisodes: typeof nextConfig.totalEpisodes === 'number' ? nextConfig.totalEpisodes : project.totalEpisodes,
          novelTitle: nextConfig.novelTitle || project.novelTitle,
          novelGenre: nextConfig.novelGenre || project.novelGenre,
          config: nextConfig,
          updatedAt: nowIso()
        }
        return updated
      })
      await writeState({ ...state, projects: nextProjects })
      return { success: true, project: updated }
    }
    case 'project:importBundle':
      return importBundle(state, args[0])
    case 'project:getStatus': {
      const [projectId] = args
      const project = state.projects.find((item) => item.id === projectId)
      return project ? listEpisodes(project, state.files) : []
    }
    case 'project:syncStatus': {
      const [projectId] = args
      const project = state.projects.find((item) => item.id === projectId)
      return project ? listEpisodes(project, state.files) : []
    }
    case 'project:getPipelineState': {
      const [projectPath] = args
      return buildProjectPipelineState(projectPath, state)
    }
    case 'script:listEpisodes':
      return listScriptDocs(args[0], state.files)
    case 'script:readEpisode':
      return state.files[buildScriptPath(args[0], args[1])] || null
    case 'script:saveEpisode': {
      const [projectPath, episodeNum, content] = args
      const nextFiles = { ...state.files, [buildScriptPath(projectPath, episodeNum)]: content }
      await writeState({ ...state, files: nextFiles })
      return { success: true }
    }
    case 'asset:listCharacters': {
      const [projectPath] = args
      const project = state.projects.find((item) => item.projectPath === projectPath)
      if (!project) return []
      return buildDerivedAssets(project, state).characters
    }
    case 'asset:listScenes': {
      const [projectPath] = args
      const project = state.projects.find((item) => item.projectPath === projectPath)
      if (!project) return []
      return buildDerivedAssets(project, state).scenes
    }
    case 'asset:loadPrompts': {
      const [projectPath, episodeNum] = args
      const raw = state.files[buildPromptPath(projectPath, episodeNum, 'prompts')] || ''
      return parsePromptMarkdown(raw).map((prompt) => ({
        index: prompt.index,
        title: prompt.title,
        duration: prompt.duration,
        references: prompt.references
      }))
    }
    case 'asset:promptStats': {
      const [projectPath, episodeNum] = args
      const prompts = parsePromptMarkdown(state.files[buildPromptPath(projectPath, episodeNum, 'prompts')] || '')
      const totalCount = prompts.length
      const totalDuration = prompts.reduce((sum, prompt) => sum + prompt.duration, 0)
      return {
        totalCount,
        totalDuration,
        avgDuration: totalCount > 0 ? Number((totalDuration / totalCount).toFixed(1)) : 0
      }
    }
    case 'asset:uploadImage':
      return { success: false, error: 'Web 平台暂不支持直接上传本地参考图，请改用远程素材库或桌面端。' }
    case 'asset:update-prompt': {
      const [payload] = args
      const project = state.projects.find((item) => item.projectPath === payload.projectPath)
      if (!project) return { success: false, error: '项目不存在' }
      const assetType = payload.assetType === 'scene' ? 'scene' : 'character'
      const overrides = readAssetPromptOverrides(payload.projectPath, state, assetType)
      overrides[payload.assetName.startsWith('@') ? payload.assetName : `@${payload.assetName}`] = payload.newPromptText
      const nextState = writeAssetPromptOverrides(state, payload.projectPath, assetType, overrides)
      await writeState(nextState)
      return { success: true }
    }
    case 'prompt:readEpisodeFile':
      return readPromptArtifact(state.files, args[0], args[1], args[2])
    case 'prompt:saveEpisodeFile': {
      const [projectPath, episodeNum, kind, content] = args
      const nextFiles = { ...state.files, [resolvePromptArtifactPath(projectPath, episodeNum, kind)]: content }
      await writeState({ ...state, files: nextFiles })
      return { success: true }
    }
    case 'novel:import': {
      const [payload] = args
      if (!payload?.projectPath || !Array.isArray(payload.chapters) || payload.chapters.length === 0) {
        throw new Error('Remote web platform requires chapters payload for novel import')
      }
      const nextFiles = { ...state.files }
      for (const chapter of payload.chapters) {
        nextFiles[buildNovelChapterPath(payload.projectPath, chapter.chapterNum)] = chapter.content
      }
      const project = state.projects.find((item) => item.projectPath === payload.projectPath)
      if (project) {
        const derived = buildDerivedBreakdown(project, nextFiles)
        nextFiles[buildPlotBreakdownPath(payload.projectPath)] = derived.raw
      }
      await writeState({ ...state, files: nextFiles })
      return { imported: payload.chapters.length }
    }
    case 'novel:scan': {
      const [novelDirPath] = args
      const projectPath = String(novelDirPath).replace(/\/novel$/, '')
      const chapters = listNovelDocs(projectPath, state.files)
      return {
        totalChapters: chapters.length,
        chapterRange: chapters.length > 0 ? [chapters[0].chapterNum, chapters[chapters.length - 1].chapterNum] : [0, 0],
        chapterFiles: chapters.map((chapter) => chapter.filename)
      }
    }
    case 'novel:readChapter': {
      const [projectPath, chapterNum] = args
      const content = state.files[buildNovelChapterPath(projectPath, chapterNum)] || ''
      return content ? { chapterNum, title: `第${chapterNum}章`, content } : null
    }
    case 'plot:getBreakdown': {
      const [projectPath] = args
      const project = state.projects.find((item) => item.projectPath === projectPath)
      return project ? buildDerivedBreakdown(project, state.files).data : null
    }
    case 'plot:readRaw': {
      const [projectPath] = args
      return state.files[buildPlotBreakdownPath(projectPath)] || null
    }
    case 'adapt:getStatus': {
      const [{ projectPath }] = args
      const project = state.projects.find((item) => item.projectPath === projectPath)
      if (!project) {
        return {
          novelInfo: null,
          waterLevel: buildWaterLevel({ projectPath, totalEpisodes: 0 }, state.files),
          state: 'adapt_idle'
        }
      }
      return buildAdaptStatus(project, state.files)
    }
    case 'adapt:initProject': {
      const [payload] = args
      let updated = null
      const nextProjects = state.projects.map((project) => {
        if (project.projectPath !== payload.projectPath) return project
        updated = {
          ...project,
          novelTitle: payload.novelTitle,
          novelGenre: payload.novelGenre,
          config: {
            ...project.config,
            novelTitle: payload.novelTitle,
            novelGenre: payload.novelGenre
          },
          updatedAt: nowIso()
        }
        return updated
      })
      await writeState({ ...state, projects: nextProjects })
      if (updated) {
        emitAdaptState(updated, state.files, {
          currentStage: 'breakdown',
          state: 'novel_loaded'
        })
      }
      return { success: true, project: updated }
    }
    case 'adapt:start': {
      const [payload] = args
      const project = state.projects.find((item) => item.id === payload.projectId || item.projectPath === payload.projectPath)
      if (!project) throw new Error('项目不存在')
      setAdaptRuntime(project.projectPath, { aborted: false, timeoutIds: [] })
      emitAdaptState(project, state.files, {
        currentStage: 'breakdown',
        state: 'novel_loaded'
      })
      return { success: true }
    }
    case 'adapt:breakdown': {
      const project = state.projects.find((item) => !!getAdaptRuntime(item.projectPath)) || state.projects[0]
      if (!project) throw new Error('项目不存在')
      scheduleTask(project.projectPath, async () => {
        await runBreakdownTask(project)
      })
      return { success: true }
    }
    case 'adapt:script': {
      const project = state.projects.find((item) => !!getAdaptRuntime(item.projectPath)) || state.projects[0]
      if (!project) throw new Error('项目不存在')
      scheduleTask(project.projectPath, async () => {
        await runScriptTask(project)
      })
      return { success: true }
    }
    case 'adapt:auto': {
      const project = state.projects.find((item) => !!getAdaptRuntime(item.projectPath)) || state.projects[0]
      if (!project) throw new Error('项目不存在')
      scheduleTask(project.projectPath, async () => {
        await runBreakdownTask(project)
        await wait(150)
        await runScriptTask(project)
      })
      return { success: true }
    }
    case 'adapt:pause': {
      const runtimeProject = state.projects.find((item) => getAdaptRuntime(item.projectPath))
      if (runtimeProject) {
        emitAdaptState(runtimeProject, state.files, {
          currentStage: 'breakdown',
          state: 'adapt_paused'
        })
      }
      return { success: true }
    }
    case 'adapt:abort': {
      const runtimeProject = state.projects.find((item) => getAdaptRuntime(item.projectPath))
      if (runtimeProject) {
        const runtime = getAdaptRuntime(runtimeProject.projectPath)
        if (runtime) runtime.aborted = true
        clearAdaptRuntime(runtimeProject.projectPath)
        emitAdaptState(runtimeProject, state.files, {
          currentStage: 'breakdown',
          state: 'adapt_idle'
        })
      }
      return { success: true }
    }
    case 'adapt:reScript':
    case 'adapt:generateEpisode': {
      const [payload] = args
      const project = state.projects.find((item) => !!getAdaptRuntime(item.projectPath)) || state.projects[0]
      if (!project) throw new Error('项目不存在')
      scheduleTask(project.projectPath, async () => {
        await runScriptTask(project, [payload.episodeNum])
      })
      return { success: true }
    }
    case 'adapt:fix':
    case 'adapt:checkBreakdown':
    case 'adapt:checkScript':
    case 'adapt:breakdownAuto':
    case 'adapt:scriptAuto':
    case 'adapt:ensurePlan':
    case 'adapt:rebuildBreakdown':
    case 'adapt:submitGuidance': {
      const project = state.projects[0]
      if (project) {
        emitAdaptLog(project.projectPath, 'breakdown', `执行 ${channel}`, 'info', 'manual_action')
      }
      return { success: true }
    }
    case 'adapt:smartNext': {
      const project = state.projects[0]
      const status = project ? buildAdaptStatus(project, state.files) : null
      return status?.novelInfo
        ? { action: 'script', description: '当前源稿已就绪，建议继续生成或修订剧本。' }
        : { action: 'novel', description: '当前还没有章节输入，建议先导入小说源稿。' }
    }
    case 'adapt:revise': {
      const [payload] = args
      const project = state.projects.find((item) => !!getAdaptRuntime(item.projectPath)) || state.projects[0]
      if (!project) throw new Error('项目不存在')
      scheduleTask(project.projectPath, async () => {
        let nextState = await readState()
        const existing = nextState.files[buildScriptPath(project.projectPath, payload.episodeNum)] || ''
        nextState.files[buildScriptPath(project.projectPath, payload.episodeNum)] = `${existing}\n\n## 修订说明\n\n${payload.revisionNotes}\n`
        await writeState(nextState)
        emitAdaptLog(project.projectPath, 'script', `已修订 EP${String(payload.episodeNum).padStart(3, '0')}`, 'info', 'revision')
        emitAdaptStageComplete({
          stage: 'revision',
          summary: '已将修订说明写入剧本',
          episodeRange: String(payload.episodeNum),
          episodeCount: 1,
          waterLevel: buildWaterLevel(project, nextState.files)
        })
        emitAdaptState(project, nextState.files, {
          currentStage: 'script',
          state: 'script_done',
          currentScriptBatch: 1
        })
      })
      return { success: true }
    }
    case 'adapt:loadPlan': {
      const [projectPath] = args
      const raw = state.files[buildPlanPath(projectPath)]
      return raw ? JSON.parse(raw) : null
    }
    case 'adapt:savePlan': {
      const [payload] = args
      const nextFiles = { ...state.files, [buildPlanPath(payload.projectPath)]: JSON.stringify(payload.plan) }
      await writeState({ ...state, files: nextFiles })
      return { success: true }
    }
    case 'adapt:loadNotes': {
      const [projectPath] = args
      return state.files[buildNotesPath(projectPath)] || ''
    }
    case 'adapt:saveNotes': {
      const [payload] = args
      const nextFiles = { ...state.files, [buildNotesPath(payload.projectPath)]: payload.notes }
      await writeState({ ...state, files: nextFiles })
      return { success: true }
    }
    case 'export:prompts':
      return exportPrompts(state, args[0])
    case 'export:scripts':
      return exportScripts(state, args[0])
    case 'export:all':
      return exportBundle(state, args[0])
    case 'file:write': {
      const [filePath, content] = args
      const filename = path.basename(filePath || `feicai-export-${Date.now()}.txt`)
      const savedPath = await writeExportFile(filename, content)
      return { success: true, path: savedPath }
    }
    case 'artifact:list': {
      const [query] = args
      const projectPath = query?.projectPath
      if (!projectPath) return []
      return (state.artifacts || [])
        .filter((item) => item.projectPath === projectPath)
        .filter((item) => !query?.episodeNum || item.episodeNum === query.episodeNum)
        .filter((item) => !query?.kind || item.kind === query.kind)
        .filter((item) => !query?.currentOnly || item.isCurrent)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    }
    case 'artifact:rollback': {
      const [payload] = args
      const artifact = (state.artifacts || []).find((item) => item.id === payload.artifactId && item.projectPath === payload.projectPath)
      if (!artifact) throw new Error('产物不存在')
      const content = state.artifactContents?.[artifact.snapshotPath]
      if (typeof content !== 'string') throw new Error('产物快照不存在')
      let nextState = {
        ...state,
        files: {
          ...state.files,
          [artifact.filePath]: content
        }
      }
      nextState = createArtifactSnapshot(nextState, {
        projectPath: artifact.projectPath,
        filePath: artifact.filePath,
        content,
        kind: artifact.kind,
        episodeNum: artifact.episodeNum,
        stage: artifact.stage,
        sourceRunId: artifact.sourceRunId,
        createdBy: 'rollback',
        contentType: artifact.contentType,
        label: artifact.label,
        metadata: {
          rollbackFromArtifactId: artifact.id,
          rollbackFromVersion: artifact.version
        }
      })
      await writeState(nextState)
      return { success: true }
    }
    case 'pipeline:runAndWait': {
      const [params] = args
      const result = await invokeChannel('pipeline:start', [params])
      if (!result?.success || !result?.run) return result
      const startedRunId = result.run.runId
      while (true) {
        const currentState = await readState()
        const currentEntry = findPipelineEntry(currentState, startedRunId)
        if (!currentEntry) return { error: '任务不存在' }
        if (isRunTerminalStatus(currentEntry.run.status)) {
          return {
            success: currentEntry.run.status === 'completed',
            state: currentEntry.run.state,
            stage: currentEntry.run.currentStage,
            run: currentEntry.run
          }
        }
        await wait(120)
      }
    }
    case 'pipeline:start': {
      const [params] = args
      const project = state.projects.find((item) => item.id === params.projectId || item.projectPath === params.projectPath)
      if (!project) return { error: '项目不存在' }
      const run = createPipelineRunRecord(project, {
        ...params,
        status: 'queued',
        state: 'idle',
        queuedAt: nowIso()
      })
      const context = createPipelineContextFromRun(run, {
        state: 'idle',
        currentStage: params.startStage || 'director'
      })
      const nextState = {
        ...state,
        pipelineRuns: [
          { run, context, logs: [], llmCalls: [] },
          ...(state.pipelineRuns || [])
        ]
      }
      await writeState(nextState)
      await maybeStartQueuedPipelineRuns()
      return { success: true, run }
    }
    case 'pipeline:enqueue': {
      const [params] = args
      const project = state.projects.find((item) => item.id === params.projectId || item.projectPath === params.projectPath)
      if (!project) return { error: '项目不存在' }
      const run = createPipelineRunRecord(project, {
        ...params,
        status: 'queued',
        state: 'idle',
        queuedAt: nowIso()
      })
      const context = createPipelineContextFromRun(run, {
        state: 'idle',
        currentStage: params.startStage || 'director'
      })
      const nextState = {
        ...state,
        pipelineRuns: [
          { run, context, logs: [], llmCalls: [] },
          ...(state.pipelineRuns || [])
        ]
      }
      await writeState(nextState)
      await maybeStartQueuedPipelineRuns()
      return { success: true, run }
    }
    case 'pipeline:pause': {
      const runtime = Array.from(pipelineRuntimeByProjectPath.values())[0] || null
      if (!runtime) return { success: false }
      runtime.paused = true
      const entry = await syncPipelineContext(runtime.runId, { state: 'paused' })
      if (entry) {
        await setPipelineRunStatus(runtime.runId, 'paused', { state: 'paused' })
      }
      return { success: true, activeRun: entry?.run || null }
    }
    case 'pipeline:resume': {
      const runtime = Array.from(pipelineRuntimeByProjectPath.values())[0] || null
      if (!runtime) return { success: false }
      runtime.paused = false
      const resolvers = [...runtime.resumeResolvers]
      runtime.resumeResolvers.length = 0
      for (const resolver of resolvers) resolver()
      const currentEntry = findPipelineEntry(await readState(), runtime.runId)
      const stateName = currentEntry?.run?.state === 'paused'
        ? getPipelineStageConfig(currentEntry.run.currentStage).executing
        : currentEntry?.run?.state
      const entry = await syncPipelineContext(runtime.runId, { state: stateName || 'script_loaded' })
      if (entry) {
        await setPipelineRunStatus(runtime.runId, 'running', { state: entry.context.state })
      }
      return { success: true, activeRun: entry?.run || null }
    }
    case 'pipeline:abort': {
      const [scope] = args
      const runId = scope?.runId
      const batchId = scope?.batchId
      let abortedCount = 0
      const targets = (state.pipelineRuns || []).filter((entry) => {
        if (runId) return entry.run.runId === runId
        if (batchId) return entry.run.batchId === batchId
        return entry.run.status === 'running' || entry.run.status === 'paused' || entry.run.status === 'queued'
      })
      for (const target of targets) {
        const runtime = getPipelineRuntime(target.run.projectPath)
        if (runtime?.runId === target.run.runId) {
          runtime.aborted = true
          runtime.paused = false
          const resolvers = [...runtime.resumeResolvers]
          runtime.resumeResolvers.length = 0
          for (const resolver of resolvers) resolver()
        } else if (target.run.status === 'queued') {
          await setPipelineRunStatus(target.run.runId, 'aborted', {
            state: 'idle',
            endedAt: nowIso(),
            errorMessage: scope?.reason
          })
        }
        abortedCount += 1
      }
      return { success: true, abortedCount }
    }
    case 'pipeline:retry': {
      const [stage] = args
      const activeEntry = listPipelineEntries(state, true).find((entry) => entry.run.status === 'running' || entry.run.status === 'paused')
      const source = activeEntry || listPipelineEntries(state, true)[0]
      if (!source) return { success: false }
      const project = state.projects.find((item) => item.id === source.run.projectId || item.projectPath === source.run.projectPath)
      if (!project) return { success: false }
      const run = createPipelineRunRecord(project, {
        episodeNum: source.run.episodeNum,
        startStage: stage || source.run.currentStage,
        singleStage: source.run.singleStage,
        strategy: {
          batchId: source.run.batchId,
          batchLabel: source.run.batchLabel,
          priority: source.run.priority,
          maxAutoRetries: source.run.maxAutoRetries,
          attempt: source.run.attempt + 1,
          rootRunId: source.run.rootRunId,
          templateId: source.run.templateId,
          templateLabel: source.run.templateLabel
        },
        orchestration: {
          dependsOnRootRunId: source.run.dependsOnRootRunId,
          condition: source.run.triggerCondition,
          scheduleId: source.run.scheduleId,
          scheduleLabel: source.run.scheduleLabel,
          automationKey: source.run.automationKey
        }
      })
      const context = createPipelineContextFromRun(run)
      await writeState({
        ...state,
        pipelineRuns: [{ run, context, logs: [], llmCalls: [] }, ...(state.pipelineRuns || [])]
      })
      await maybeStartQueuedPipelineRuns()
      return { success: true, run }
    }
    case 'pipeline:skip': {
      const [stage] = args
      const runtime = Array.from(pipelineRuntimeByProjectPath.values())[0] || null
      if (!runtime) return { success: false }
      runtime.skipReviewStage = stage || findPipelineEntry(await readState(), runtime.runId)?.run?.currentStage || 'director'
      await emitPipelineLogForRun(runtime.runId, runtime.skipReviewStage, '已跳过当前审核', 'warn', 'review_skip')
      return { success: true }
    }
    case 'pipeline:getState': {
      const [projectPath] = args
      const runtime = projectPath ? getPipelineRuntime(projectPath) : Array.from(pipelineRuntimeByProjectPath.values())[0] || null
      if (runtime?.context) return runtime.context
      const relatedEntry = projectPath
        ? listPipelineEntries(state, true).find((entry) => entry.run.projectPath === projectPath)
        : listPipelineEntries(state, true)[0]
      return relatedEntry?.context || createIdlePipelineContext(projectPath, relatedEntry?.run?.projectId)
    }
    case 'pipeline:listAllRuns': {
      const [limit = 100, includeArchived = false] = args
      return listPipelineEntries(state, includeArchived).slice(0, limit).map((entry) => entry.run)
    }
    case 'pipeline:listRuns': {
      const [projectId, limit = 20, includeArchived = false] = args
      return listPipelineEntries(state, includeArchived)
        .filter((entry) => entry.run.projectId === projectId)
        .slice(0, limit)
        .map((entry) => entry.run)
    }
    case 'pipeline:getRunDetail': {
      const [runId] = args
      const entry = findPipelineEntry(state, runId)
      if (!entry) return null
      return {
        run: entry.run,
        logs: entry.logs || [],
        llmCalls: entry.llmCalls || []
      }
    }
    case 'pipeline:cancelRun': {
      const [runId] = args
      const target = findPipelineEntry(state, runId)
      if (!target) return { success: false }
      if (target.run.status === 'queued') {
        await setPipelineRunStatus(runId, 'aborted', {
          state: 'idle',
          endedAt: nowIso(),
          errorMessage: '任务已取消'
        })
        return { success: true }
      }
      const runtime = getPipelineRuntime(target.run.projectPath)
      if (runtime?.runId === runId) {
        runtime.aborted = true
        runtime.paused = false
        const resolvers = [...runtime.resumeResolvers]
        runtime.resumeResolvers.length = 0
        for (const resolver of resolvers) resolver()
        return { success: true }
      }
      return { success: false }
    }
    case 'pipeline:retryRun': {
      const [runId] = args
      const source = findPipelineEntry(state, runId)
      if (!source) return { error: '任务不存在' }
      const project = state.projects.find((item) => item.id === source.run.projectId || item.projectPath === source.run.projectPath)
      if (!project) return { error: '项目不存在' }
      const run = createPipelineRunRecord(project, {
        episodeNum: source.run.episodeNum,
        startStage: source.run.currentStage,
        singleStage: source.run.singleStage,
        strategy: {
          batchId: source.run.batchId,
          batchLabel: source.run.batchLabel,
          priority: source.run.priority,
          maxAutoRetries: source.run.maxAutoRetries,
          attempt: source.run.attempt + 1,
          rootRunId: source.run.rootRunId,
          templateId: source.run.templateId,
          templateLabel: source.run.templateLabel
        },
        orchestration: {
          condition: 'always'
        }
      })
      const context = createPipelineContextFromRun(run)
      await writeState({
        ...state,
        pipelineRuns: [{ run, context, logs: [], llmCalls: [] }, ...(state.pipelineRuns || [])]
      })
      await maybeStartQueuedPipelineRuns()
      return { success: true, run }
    }
    case 'pipeline:archiveRuns': {
      const [olderThanDays = 7, projectId] = args
      const threshold = Date.now() - Math.max(0, olderThanDays) * 24 * 60 * 60 * 1000
      let count = 0
      const nextRuns = (state.pipelineRuns || []).map((entry) => {
        const endedAt = entry.run.endedAt ? new Date(entry.run.endedAt).getTime() : 0
        if (!isRunTerminalStatus(entry.run.status)) return entry
        if (projectId && entry.run.projectId !== projectId) return entry
        if (endedAt && endedAt <= threshold && !entry.run.archivedAt) {
          count += 1
          return {
            ...entry,
            run: {
              ...entry.run,
              archivedAt: nowIso(),
              lastUpdatedAt: nowIso()
            }
          }
        }
        return entry
      })
      await writeState({ ...state, pipelineRuns: nextRuns })
      return { success: true, count }
    }
    case 'pipeline:getDiagnostics':
      return buildPipelineDiagnostics(state)
    case 'pipeline:triggerAutomationScan':
    case 'pipeline:triggerRecoverySweep':
      return buildPipelineDiagnostics(state)
    case 'pipeline:triggerSchedule': {
      const [projectId, scheduleId] = args
      const project = state.projects.find((item) => item.id === projectId)
      if (!project) return { error: '项目不存在' }
      const schedules = project.config?.taskSchedules || []
      const templates = project.config?.taskTemplates || []
      const schedule = schedules.find((item) => item.id === scheduleId)
      if (!schedule) return { error: '计划不存在' }
      const template = templates.find((item) => item.id === schedule.templateId)
      const runs = []
      let previousRootRunId
      const batchId = createId('schedule-batch')
      let nextState = state
      for (const episodeNum of schedule.episodeNumbers || []) {
        const run = createPipelineRunRecord(project, {
          episodeNum,
          startStage: template?.startStage || 'director',
          singleStage: !!template?.singleStage,
          strategy: {
            batchId,
            batchLabel: schedule.label,
            priority: template?.priority || 'normal',
            maxAutoRetries: template?.maxAutoRetries || 0,
            attempt: 1,
            templateId: template?.id,
            templateLabel: template?.label
          },
          orchestration: {
            condition: 'always',
            scheduleId: schedule.id,
            scheduleLabel: schedule.label,
            automationKey: `${projectId}:${schedule.id}`,
            dependsOnRootRunId: previousRootRunId
          }
        })
        previousRootRunId = run.rootRunId
        runs.push(run)
        nextState = {
          ...nextState,
          pipelineRuns: [{ run, context: createPipelineContextFromRun(run), logs: [], llmCalls: [] }, ...(nextState.pipelineRuns || [])]
        }
      }
      await writeState(nextState)
      await maybeStartQueuedPipelineRuns()
      return { success: true, runs }
    }
    default:
      throw new Error(`Unsupported channel: ${channel}`)
  }
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const eventClients = new Set()

function emitEvent(channel, args) {
  const payload = `data: ${JSON.stringify({ channel, args })}\n\n`
  for (const client of eventClients) {
    if (client.channel && client.channel !== channel) continue
    client.res.write(payload)
  }
}

function emitAdaptState(project, files, overrides = {}) {
  const context = createAdaptContext(project, files, overrides)
  emitEvent('adapt:stateChanged', [{
    newState: context.state,
    context
  }])
  return context
}

function emitAdaptLog(projectPath, stage, message, level = 'info', eventType = 'status') {
  emitEvent('adapt:log', [createLogEntry(projectPath, stage, message, level, eventType)])
}

function emitAdaptStream(chunk) {
  emitEvent('adapt:stream', [{ chunk }])
}

function emitAdaptStageComplete(report) {
  emitEvent('adapt:stageComplete', [report])
}

function emitAdaptError(message, error) {
  emitEvent('adapt:error', [{ message, error }])
}

function emitPipelineState(context) {
  emitEvent('pipeline:stateChanged', [{
    newState: context.state,
    context
  }])
}

function emitPipelineLog(entry) {
  emitEvent('pipeline:log', [entry])
}

function emitPipelineStream(chunk) {
  emitEvent('pipeline:stream', [{ chunk }])
}

function emitPipelineStageComplete(payload) {
  emitEvent('pipeline:stageComplete', [payload])
}

function emitPipelineReviewResult(result) {
  emitEvent('pipeline:reviewResult', [{ result }])
}

function emitPipelineError(message, error) {
  emitEvent('pipeline:error', [{ message, error }])
}

async function syncPipelineContext(runId, overrides = {}) {
  const entry = await updatePipelineEntry(runId, (current) => {
    const mergedContext = {
      ...(current.context || createPipelineContextFromRun(current.run)),
      ...overrides,
      lastUpdatedAt: overrides.lastUpdatedAt || nowIso()
    }
    return {
      ...current,
      context: mergedContext,
      run: {
        ...current.run,
        currentStage: mergedContext.currentStage,
        state: mergedContext.state,
        lastUpdatedAt: mergedContext.lastUpdatedAt,
        startedAt: mergedContext.runStartedAt || current.run.startedAt,
        endedAt: mergedContext.runEndedAt || current.run.endedAt,
        errorMessage: mergedContext.error || current.run.errorMessage
      }
    }
  })
  if (entry?.context) {
    const runtime = getPipelineRuntime(entry.run.projectPath)
    if (runtime?.runId === runId) {
      runtime.context = entry.context
    }
    emitPipelineState(entry.context)
  }
  return entry
}

async function setPipelineRunStatus(runId, status, patch = {}) {
  const entry = await updatePipelineEntry(runId, (current) => ({
    ...current,
    run: {
      ...current.run,
      ...patch,
      status,
      currentStage: patch.currentStage || current.run.currentStage,
      state: patch.state || current.run.state,
      lastUpdatedAt: patch.lastUpdatedAt || nowIso()
    }
  }))
  return entry
}

async function emitPipelineLogForRun(runId, stage, message, level = 'info', eventType = 'status') {
  const entry = await findPipelineEntry(await readState(), runId)
  if (!entry) return null
  const log = createLogEntry(entry.run.projectPath, stage, message, level, eventType)
  const nextEntry = await appendPipelineLog(runId, log)
  emitPipelineLog(log)
  return nextEntry
}

function createSyntheticLLMCall(run, stage, title) {
  const durationMs = 900 + Math.floor(Math.random() * 1200)
  const inputTokens = 900 + Math.floor(Math.random() * 500)
  const outputTokens = 500 + Math.floor(Math.random() * 300)
  return {
    id: createId('llmcall'),
    runId: run.runId,
    stage,
    phase: 'stage_execution',
    provider: 'web-platform',
    model: 'stub-creative-v1',
    stream: true,
    startedAt: new Date(Date.now() - durationMs).toISOString(),
    endedAt: nowIso(),
    durationMs,
    status: 'success',
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      tokenSource: 'estimated'
    },
    estimatedCostUsd: Number((((inputTokens + outputTokens) / 1000) * 0.0008).toFixed(4))
  }
}

function renderStageArtifact(project, run, stage, state) {
  const scriptContent = buildPipelineScript(project, run.episodeNum, state)
  if (stage === 'director') {
    return [
      `# EP${String(run.episodeNum).padStart(3, '0')} 导演分析`,
      '',
      `项目：${project.name}`,
      `视觉方向：${project.visualStyle || '未设置'}`,
      '',
      '## 节奏判断',
      '',
      '建议采用“3 段式推进 + 1 个结尾钩子”的桌面短剧结构。',
      '',
      '## 关键镜头',
      '',
      scriptContent.slice(0, 800)
    ].join('\n')
  }
  if (stage === 'art') {
    return [
      `# EP${String(run.episodeNum).padStart(3, '0')} 美术提示词`,
      '',
      `项目：${project.name}`,
      `目标介质：${project.targetMedium || '未设置'}`,
      '',
      '## 主场景提示词',
      '',
      '- cinematic key visual, dramatic close shot, high contrast lighting',
      '- character emotion focus, polished costume details, environment depth',
      '',
      '## 镜头组建议',
      '',
      '1. 开场建立场景',
      '2. 冲突近景',
      '3. 情绪反打',
      '4. 尾声钩子',
      '',
      scriptContent.slice(0, 500)
    ].join('\n')
  }
  return [
    `# EP${String(run.episodeNum).padStart(3, '0')} 分镜镜头草案`,
    '',
    '## 镜头列表',
    '',
    '1. 全景建立空间关系',
    '2. 中近景推进人物情绪',
    '3. 特写强化冲突点',
    '4. 留白镜头连接下一集',
    '',
    '## 生成提示词',
    '',
    '- shot list, cinematic storyboard, dramatic blocking, emotional pacing',
    '',
    scriptContent.slice(0, 700)
  ].join('\n')
}

function createReviewResult(run, stage, approved = true) {
  return {
    stage,
    reviewType: 'business',
    result: approved ? 'PASS' : 'FAIL',
    passed: approved,
    score: approved ? 8.6 : 5.2,
    feedback: approved ? '当前内容达到最小可交付标准。' : '需要补强冲突表达与镜头节奏。改善后再试。 ',
    issues: approved ? [] : [{ severity: 'major', description: '当前阶段内容质量不足', suggestion: '补充视觉描述与冲突转折。' }],
    createdAt: nowIso()
  }
}

async function controlledPipelineDelay(runtime, ms) {
  const endAt = Date.now() + ms
  while (Date.now() < endAt) {
    if (runtime.aborted) {
      throw new Error('PIPELINE_ABORTED')
    }
    if (runtime.paused) {
      await new Promise((resolve) => runtime.resumeResolvers.push(resolve))
      continue
    }
    await wait(Math.min(120, endAt - Date.now()))
  }
}

async function persistPipelineArtifacts(project, run, stage, state) {
  const latestState = await readState()
  let nextState = { ...latestState, files: { ...latestState.files } }
  const scriptPath = buildScriptPath(project.projectPath, run.episodeNum)
  const scriptContent = buildPipelineScript(project, run.episodeNum, state)
  nextState.files[scriptPath] = scriptContent
  nextState = createArtifactSnapshot(nextState, {
    projectPath: project.projectPath,
    filePath: scriptPath,
    content: scriptContent,
    kind: 'script_episode',
    episodeNum: run.episodeNum,
    sourceRunId: run.runId
  })
  if (stage === 'director') {
    const artifactPath = buildDirectorAnalysisPath(project.projectPath, run.episodeNum)
    const content = renderStageArtifact(project, run, stage, state)
    nextState.files[artifactPath] = content
    nextState = createArtifactSnapshot(nextState, {
      projectPath: project.projectPath,
      filePath: artifactPath,
      content,
      kind: 'director_output',
      episodeNum: run.episodeNum,
      stage: 'director',
      sourceRunId: run.runId
    })
  } else {
    const artifactPath = buildPromptPath(project.projectPath, run.episodeNum, 'prompts')
    const content = renderStageArtifact(project, run, stage, state)
    nextState.files[artifactPath] = content
    nextState = createArtifactSnapshot(nextState, {
      projectPath: project.projectPath,
      filePath: artifactPath,
      content,
      kind: 'seedance_prompts',
      episodeNum: run.episodeNum,
      stage,
      sourceRunId: run.runId
    })
    if (stage === 'art') {
      const artPath = buildPromptPath(project.projectPath, run.episodeNum, 'art')
      nextState.files[artPath] = content
      nextState = createArtifactSnapshot(nextState, {
        projectPath: project.projectPath,
        filePath: artPath,
        content,
        kind: 'art_output',
        episodeNum: run.episodeNum,
        stage: 'art',
        sourceRunId: run.runId
      })
    }
  }
  await writeState(nextState)
  return nextState
}

async function executePipelineStage(project, runId, stage) {
  const runtime = getPipelineRuntime(project.projectPath)
  if (!runtime) return
  const state = await readState()
  const entry = findPipelineEntry(state, runId)
  if (!entry) return
  const run = entry.run
  const config = getPipelineStageConfig(stage)

  await syncPipelineContext(runId, {
    currentStage: stage,
    state: config.executing
  })
  await setPipelineRunStatus(runId, runtime.paused ? 'paused' : 'running', {
    currentStage: stage,
    state: config.executing,
    startedAt: run.startedAt || nowIso()
  })
  await emitPipelineLogForRun(runId, stage, `开始${config.logLabel}`, 'info', 'stage_start')
  emitPipelineStream(`EP${String(run.episodeNum).padStart(3, '0')} ${config.title}处理中...\n`)
  await appendPipelineLLMCall(runId, createSyntheticLLMCall(run, stage, config.title))
  await controlledPipelineDelay(runtime, 320)

  await syncPipelineContext(runId, {
    currentStage: stage,
    state: config.reviewing
  })
  await emitPipelineLogForRun(runId, stage, `${config.title}进入审核`, 'info', 'review_start')
  emitPipelineStream(`审核 ${config.title} 输出...\n`)
  await controlledPipelineDelay(runtime, runtime.skipReviewStage === stage ? 80 : 220)
  runtime.skipReviewStage = null

  const nextState = await persistPipelineArtifacts(project, run, stage, state)
  const review = createReviewResult(run, stage, true)
  const updated = await updatePipelineEntry(runId, (current) => {
    const context = current.context || createPipelineContextFromRun(current.run)
    return {
      ...current,
      context: {
        ...context,
        currentStage: stage,
        state: config.done,
        reviews: [...(context.reviews || []), review],
        lastUpdatedAt: nowIso(),
        scriptPath: buildScriptPath(project.projectPath, run.episodeNum),
        directorAnalysisPath: buildDirectorAnalysisPath(project.projectPath, run.episodeNum),
        seedancePromptsPath: buildPromptPath(project.projectPath, run.episodeNum, 'prompts')
      },
      run: {
        ...current.run,
        currentStage: stage,
        state: config.done,
        status: config.done === 'episode_complete' ? 'completed' : 'running',
        lastUpdatedAt: nowIso(),
        endedAt: config.done === 'episode_complete' ? nowIso() : current.run.endedAt
      }
    }
  })
  await emitPipelineLogForRun(runId, stage, `${config.title}完成`, 'info', 'stage_complete')
  emitPipelineReviewResult(review)
  emitPipelineStageComplete({
    runId,
    projectId: run.projectId,
    projectPath: run.projectPath,
    episodeNum: run.episodeNum,
    stage,
    summary: `${config.title}已完成`
  })
  emitPipelineState(updated.context)
  return nextState
}

async function finishPipelineRun(projectPath, runId, status, errorMessage) {
  const entry = await updatePipelineEntry(runId, (current) => {
    const endedAt = nowIso()
    const context = current.context || createPipelineContextFromRun(current.run)
    return {
      ...current,
      context: {
        ...context,
        state: status === 'completed' ? 'episode_complete' : status === 'aborted' ? 'idle' : 'error',
        runEndedAt: endedAt,
        lastUpdatedAt: endedAt,
        error: errorMessage
      },
      run: {
        ...current.run,
        status,
        state: status === 'completed' ? 'episode_complete' : status === 'aborted' ? 'idle' : 'error',
        endedAt,
        lastUpdatedAt: endedAt,
        errorMessage
      }
    }
  })
  if (entry?.context) {
    emitPipelineState(entry.context)
  }
  clearPipelineRuntime(projectPath)
  await maybeStartQueuedPipelineRuns()
  return entry
}

async function runPipelineExecution(project, runId) {
  const runtime = getPipelineRuntime(project.projectPath)
  if (!runtime) return
  const state = await readState()
  const entry = findPipelineEntry(state, runId)
  if (!entry) return
  const run = entry.run
  const flowStartIndex = Math.max(0, PIPELINE_STAGE_FLOW.findIndex((item) => item.stage === run.currentStage))
  const stages = PIPELINE_STAGE_FLOW.slice(flowStartIndex)

  try {
    await syncPipelineContext(runId, {
      runStartedAt: run.startedAt || nowIso(),
      currentStage: run.currentStage,
      state: 'script_loaded'
    })
    await emitPipelineLogForRun(runId, run.currentStage, '已加载剧本上下文', 'info', 'state_changed')

    for (const stageInfo of stages) {
      await executePipelineStage(project, runId, stageInfo.stage)
      const refreshed = findPipelineEntry(await readState(), runId)
      if (!refreshed) return
      if (run.singleStage && stageInfo.stage !== 'storyboard') {
        await finishPipelineRun(project.projectPath, runId, 'completed')
        return
      }
      if (runtime.aborted) {
        await finishPipelineRun(project.projectPath, runId, 'aborted')
        return
      }
      if (refreshed.run.state === 'episode_complete') {
        await finishPipelineRun(project.projectPath, runId, 'completed')
        return
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'PIPELINE_ABORTED') {
      await emitPipelineLogForRun(runId, run.currentStage, '任务已终止', 'warn', 'aborted')
      await finishPipelineRun(project.projectPath, runId, 'aborted')
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    await emitPipelineLogForRun(runId, run.currentStage, `流水线执行失败: ${message}`, 'error', 'runtime_error')
    emitPipelineError('Pipeline 任务执行失败', message)
    await finishPipelineRun(project.projectPath, runId, 'failed', message)
  }
}

async function startPipelineRun(runId) {
  const state = await readState()
  const entry = findPipelineEntry(state, runId)
  if (!entry) return null
  const project = state.projects.find((item) => item.projectPath === entry.run.projectPath || item.id === entry.run.projectId)
  if (!project) {
    await finishPipelineRun(entry.run.projectPath, runId, 'failed', '项目不存在')
    return null
  }

  const runtime = {
    runId,
    paused: false,
    aborted: false,
    timerIds: [],
    resumeResolvers: [],
    skipReviewStage: null,
    context: entry.context || createPipelineContextFromRun(entry.run)
  }
  setPipelineRuntime(project.projectPath, runtime)
  await setPipelineRunStatus(runId, 'running', {
    state: 'script_loaded',
    startedAt: entry.run.startedAt || nowIso(),
    currentStage: entry.run.currentStage
  })
  const timerId = setTimeout(() => {
    void runPipelineExecution(project, runId)
  }, 0)
  runtime.timerIds.push(timerId)
  return runtime
}

async function maybeStartQueuedPipelineRuns() {
  const runnable = await listRunnablePipelineEntries()
  for (const entry of runnable) {
    if (getPipelineRuntime(entry.run.projectPath)) continue
    await startPipelineRun(entry.run.runId)
  }
}

function buildPipelineQueueSnapshot(state) {
  const queued = listPipelineEntries(state, true).filter((entry) => entry.run.status === 'queued')
  return queued.map((entry, index) => ({
    runId: entry.run.runId,
    rootRunId: entry.run.rootRunId,
    projectId: entry.run.projectId,
    projectPath: entry.run.projectPath,
    episodeNum: entry.run.episodeNum,
    currentStage: entry.run.currentStage,
    priority: entry.run.priority,
    queuePosition: index + 1,
    scheduledAt: entry.run.scheduledAt,
    dependsOnRootRunId: entry.run.dependsOnRootRunId,
    scheduleLabel: entry.run.scheduleLabel,
    templateLabel: entry.run.templateLabel
  }))
}

function buildPipelineDiagnostics(state) {
  const entries = listPipelineEntries(state, true)
  const runs = entries.map((entry) => entry.run)
  const queue = buildPipelineQueueSnapshot(state)
  const activeRun = runs.find((run) => run.status === 'running' || run.status === 'paused')
  const deadLetterCount = runs.filter((run) => run.status === 'dead_letter').length
  const failedRuns = runs.filter((run) => run.status === 'failed')
  const totalDurationMs = runs.reduce((sum, run) => sum + (run.telemetry?.totalDurationMs || 0), 0)
  const totalTokens = runs.reduce((sum, run) => sum + (run.telemetry?.totalTokens || 0), 0)
  const estimatedCostUsd = Number(runs.reduce((sum, run) => sum + (run.telemetry?.estimatedCostUsd || 0), 0).toFixed(4))
  const issues = []
  for (const run of failedRuns.slice(0, 5)) {
    issues.push({
      severity: 'warning',
      projectId: run.projectId,
      projectName: run.projectName || run.projectId,
      projectPath: run.projectPath,
      scope: 'runtime',
      field: 'run',
      message: `EP${String(run.episodeNum).padStart(3, '0')} 执行失败：${run.errorMessage || '未知错误'}`,
      id: run.runId
    })
  }
  if (deadLetterCount > 0) {
    const dead = runs.find((run) => run.status === 'dead_letter')
    issues.push({
      severity: 'error',
      projectId: dead?.projectId || '',
      projectName: dead?.projectName || '未知项目',
      projectPath: dead?.projectPath || '',
      scope: 'recovery',
      field: 'deadLetter',
      message: `当前存在 ${deadLetterCount} 条死信任务，请先处理后再继续批量运行。`,
      id: dead?.runId
    })
  }

  return {
    generatedAt: nowIso(),
    activeRun: activeRun ? {
      runId: activeRun.runId,
      projectId: activeRun.projectId,
      projectPath: activeRun.projectPath,
      episodeNum: activeRun.episodeNum,
      currentStage: activeRun.currentStage,
      state: activeRun.state,
      startedAt: activeRun.startedAt
    } : null,
    queue,
    queueSummary: {
      total: queue.length,
      waitingForSchedule: queue.filter((item) => item.scheduledAt && new Date(item.scheduledAt).getTime() > Date.now()).length,
      waitingForDependency: queue.filter((item) => !!item.dependsOnRootRunId).length,
      deadLetter: deadLetterCount
    },
    automation: {
      projectCount: state.projects.length,
      enabledScheduleCount: state.projects.reduce((sum, project) => sum + ((project.config?.taskSchedules || []).filter((schedule) => schedule.enabled).length || 0), 0),
      lastScanAt: nowIso()
    },
    recovery: {
      deadLetterCount,
      orphanedRunCount: 0,
      lastSweepAt: nowIso()
    },
    telemetry: {
      runCount: runs.length,
      callCount: runs.reduce((sum, run) => sum + (run.telemetry?.callCount || 0), 0),
      successCount: runs.filter((run) => run.status === 'completed').length,
      failureCount: failedRuns.length,
      totalDurationMs,
      totalTokens,
      estimatedCostUsd,
      lastCalledAt: runs.find((run) => run.telemetry?.callCount)?.telemetry?.lastCalledAt
    },
    issues
  }
}

async function persistBreakdownArtifacts(project, state) {
  const derived = buildDerivedBreakdown(project, state.files)
  const nextFiles = {
    ...state.files,
    [buildPlotBreakdownPath(project.projectPath)]: derived.raw
  }
  const nextState = { ...state, files: nextFiles }
  await writeState(nextState)
  return nextState
}

function buildEpisodeScript(project, episodeNum, state) {
  const chapters = listNovelDocs(project.projectPath, state.files)
  const start = (episodeNum - 1) * 3
  const slice = chapters.slice(start, start + 3)
  const title = `${project.name} EP${String(episodeNum).padStart(3, '0')}`
  const body = slice.length > 0
    ? slice.map((chapter, index) => `## 场景 ${index + 1}\n\n来源：第${chapter.chapterNum}章\n\n${chapter.content.slice(0, 320)}`).join('\n\n')
    : '## 场景 1\n\n待补充剧情内容。'
  return `# ${title}\n\n${body}\n`
}

async function persistScriptArtifacts(project, state, episodeRange) {
  const nextFiles = { ...state.files }
  for (const episodeNum of episodeRange) {
    nextFiles[buildScriptPath(project.projectPath, episodeNum)] = buildEpisodeScript(project, episodeNum, { ...state, files: nextFiles })
  }
  const nextState = { ...state, files: nextFiles }
  await writeState(nextState)
  return nextState
}

async function runBreakdownTask(project) {
  let state = await readState()
  emitAdaptLog(project.projectPath, 'breakdown', '开始剧情拆解', 'info', 'stage_start')
  emitAdaptStream('正在整理章节与剧情点...\n')
  emitAdaptState(project, state.files, {
    currentStage: 'breakdown',
    state: 'breakdown_executing',
    currentBatch: 1
  })
  await wait(350)
  state = await persistBreakdownArtifacts(project, state)
  emitAdaptLog(project.projectPath, 'breakdown', '剧情拆解完成', 'info', 'stage_complete')
  emitAdaptStageComplete({
    stage: 'breakdown',
    summary: '已根据章节生成基础剧情库存',
    extractedPlots: buildWaterLevel(project, state.files).totalPlots,
    chapterRange: [1, buildWaterLevel(project, state.files).totalChapters],
    waterLevel: buildWaterLevel(project, state.files)
  })
  emitAdaptState(project, state.files, {
    currentStage: 'breakdown',
    state: 'breakdown_done',
    currentBatch: 1
  })
}

async function runScriptTask(project, episodeNums = null) {
  let state = await readState()
  const targetEpisodes = episodeNums || Array.from({ length: Math.max(Math.ceil(buildWaterLevel(project, state.files).totalChapters / 3), 1) }, (_, index) => index + 1)
  emitAdaptLog(project.projectPath, 'script', '开始剧本生成', 'info', 'stage_start')
  emitAdaptStream(`正在生成 ${targetEpisodes.length} 集剧本...\n`)
  emitAdaptState(project, state.files, {
    currentStage: 'script',
    state: 'script_executing',
    currentScriptBatch: 1
  })
  await wait(450)
  state = await persistScriptArtifacts(project, state, targetEpisodes)
  emitAdaptLog(project.projectPath, 'script', '剧本生成完成', 'info', 'stage_complete')
  emitAdaptStageComplete({
    stage: 'script',
    summary: '已生成基础剧本草稿',
    episodeRange: `${targetEpisodes[0]}-${targetEpisodes[targetEpisodes.length - 1]}`,
    episodeCount: targetEpisodes.length,
    waterLevel: buildWaterLevel(project, state.files)
  })
  emitAdaptState(project, state.files, {
    currentStage: 'script',
    state: 'script_done',
    currentScriptBatch: 1
  })
}

function scheduleTask(projectPath, runner) {
  const runtime = getAdaptRuntime(projectPath) || { aborted: false, timeoutIds: [] }
  runtime.aborted = false
  setAdaptRuntime(projectPath, runtime)
  const timeoutId = setTimeout(async () => {
    try {
      if (runtime.aborted) return
      await runner()
    } catch (error) {
      emitAdaptError('Adapt 任务执行失败', error instanceof Error ? error.message : String(error))
    }
  }, 0)
  runtime.timeoutIds.push(timeoutId)
}

const server = createServer(async (req, res) => {
  setCorsHeaders(res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url?.startsWith('/api/platform/events')) {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`)
    const channel = url.searchParams.get('channel') || ''
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`)
    const client = { res, channel }
    eventClients.add(client)
    req.on('close', () => {
      eventClients.delete(client)
    })
    return
  }

  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, version: `${packageJson.version}-web-platform` }))
    return
  }

  if (req.method === 'POST' && req.url === '/api/platform/invoke') {
    try {
      const raw = await readBody(req)
      const payload = raw ? JSON.parse(raw) : {}
      const result = await invokeChannel(payload.channel, Array.isArray(payload.args) ? payload.args : [])
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, result }))
    } catch (error) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }))
    }
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: 'Not found' }))
})

await ensureDataLayout()

server.listen(PORT, HOST, () => {
  console.log(`[web-platform] listening on http://${HOST}:${PORT}`)
  console.log(`[web-platform] invoke endpoint: http://${HOST}:${PORT}/api/platform/invoke`)
  console.log(`[web-platform] events endpoint: http://${HOST}:${PORT}/api/platform/events`)
  console.log(`[web-platform] data dir: ${DATA_DIR}`)
})
