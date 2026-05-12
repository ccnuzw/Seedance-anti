import type { Edge, Node } from '@xyflow/react'
import { MarkerType } from '@xyflow/react'
import {
  describeEpisodeArtifact,
  describeProjectArtifact
} from '@shared/path-resolver'
import {
  WORKFLOW_STAGE_DEFINITIONS,
  type WorkflowStageMode
} from '@shared/workflow-definition'
import type {
  AutomatedPipelineStage,
  Episode,
  PipelineState,
  ProjectEntryStage,
  ReviewResult,
  WorkflowStageId
} from '@shared/types'
import { isEpisodeComplete } from '@shared/episode-status'

export const AUTO_STAGES: Array<{
  id: AutomatedPipelineStage
  label: string
  emoji: string
}> = [
  { id: 'director', label: '导演分析', emoji: '🎬' },
  { id: 'art', label: '服化道', emoji: '🎨' },
  { id: 'storyboard', label: '分镜编写', emoji: '📐' }
]

const STAGE_EMOJI_MAP: Record<WorkflowStageId, string> = {
  novel: '📚',
  story: '🧩',
  story_review: '🔎',
  script: '📖',
  script_review: '📝',
  script_approved: '✅',
  director: '🎬',
  character: '🎭',
  art: '🎨',
  storyboard: '📐',
  storyboard_review: '🔍',
  complete: '🏁'
}

export const FULL_WORKFLOW: Array<{
  id: WorkflowStageId
  label: string
  emoji: string
  hint: string
  mode: WorkflowStageMode
}> = WORKFLOW_STAGE_DEFINITIONS.map((stage) => ({
  id: stage.id,
  label: stage.cardLabel,
  emoji: STAGE_EMOJI_MAP[stage.id],
  hint: stage.hint,
  mode: stage.mode
}))

export type FlowCardState =
  | 'done'
  | 'active'
  | 'ready'
  | 'blocked'
  | 'skipped'
  | 'warning'
export type WorkflowActionId =
  | 'story'
  | 'story_review'
  | 'script'
  | 'script_review'
  | 'character'
  | 'storyboard_review'
export type WorkflowSummaryMap = Partial<Record<WorkflowStageId, string[]>>

export interface WorkflowActionResult {
  stage: WorkflowActionId
  success: boolean
  outputPath?: string
  review?: ReviewResult
  error?: string
}

export interface WorkflowCard {
  id: WorkflowStageId
  label: string
  emoji: string
  hint: string
  mode: WorkflowStageMode
  state: FlowCardState
  note: string
  summaryLines: string[]
}

export interface WorkflowCardActionMeta {
  openLabel: string
  openPath?: string
  primaryLabel: string
  primaryDisabled?: boolean
  primaryAction: () => void
  secondaryLabel?: string
  secondaryDisabled?: boolean
  secondaryAction?: () => void
}

export type WorkflowCardActionIntent =
  | { type: 'navigate'; path?: string }
  | { type: 'workflow'; stage: WorkflowActionId }
  | {
      type: 'automation'
      stage?: AutomatedPipelineStage
      singleStage?: boolean
    }

export interface WorkflowCardActionSpec {
  openLabel: string
  openPath?: string
  primaryLabel: string
  primaryDisabled?: boolean
  primaryIntent: WorkflowCardActionIntent
  secondaryLabel?: string
  secondaryDisabled?: boolean
  secondaryIntent?: WorkflowCardActionIntent
}

export interface StageAvailability {
  canStart: boolean
  reason: string
}

export type AutomatedStageAvailabilityMap = Record<
  AutomatedPipelineStage,
  StageAvailability
>
export type WorkflowAvailabilityMap = Record<
  WorkflowActionId,
  StageAvailability
>

export interface WorkflowCardActionSpecParams {
  cardId: WorkflowStageId
  currentEpisode?: Episode
  hasSourceNovel: boolean
  workflowAvailability: WorkflowAvailabilityMap
  stageAvailability: AutomatedStageAvailabilityMap
  busyWorkflow: boolean
  busyPipeline: boolean
  paths: {
    sourcePath?: string
    storyPath?: string
    storyReviewPath?: string
    scriptPath?: string
    reviewPath?: string
    assetsPath?: string
    pipelinePath?: string
    promptBasePath?: string
  }
}

export function isStageActive(
  stage: AutomatedPipelineStage,
  state: PipelineState
): boolean {
  const stateStr = state as string
  if (stage === 'director') return stateStr.startsWith('director_')
  if (stage === 'art') return stateStr.startsWith('art_')
  if (stage === 'storyboard') return stateStr.startsWith('storyboard_')
  return false
}

export function isStageDone(
  stage: AutomatedPipelineStage,
  state: PipelineState
): boolean {
  const order: AutomatedPipelineStage[] = ['director', 'art', 'storyboard']
  const stageIdx = order.indexOf(stage)
  const stateStr = state as string
  if (stateStr === 'episode_complete') return true
  if (
    stage === 'director' &&
    (stateStr === 'director_done' ||
      stateStr === 'art_done' ||
      stateStr === 'storyboard_done')
  )
    return true
  if (
    stage === 'art' &&
    (stateStr === 'art_done' || stateStr === 'storyboard_done')
  )
    return true
  for (let i = stageIdx + 1; i < order.length; i++) {
    if (stateStr.startsWith(order[i] + '_') || stateStr === `${order[i]}_done`)
      return true
  }
  return false
}

export function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function getEntryIndex(entryStage: ProjectEntryStage): number {
  if (entryStage === 'story') return 1
  if (entryStage === 'script') return 2
  return 0
}

export function mapEpisodeStatusToDisplayState(
  status?: Episode['status']
): PipelineState {
  switch (status) {
    case 'complete':
      return 'episode_complete'
    case 'storyboard_review':
      return 'storyboard_reviewing'
    case 'storyboard':
      return 'storyboard_done'
    case 'art':
      return 'art_done'
    case 'character':
      return 'character_done'
    case 'director':
      return 'director_done'
    case 'script_review':
      return 'script_reviewing'
    case 'story_review':
      return 'story_reviewing'
    case 'story':
      return 'story_done'
    case 'script':
    case 'script_approved':
      return 'script_done'
    case 'novel':
      return 'idle'
    default:
      return 'idle'
  }
}

export function getStageAvailability(
  episode: Episode | undefined,
  stage: AutomatedPipelineStage
): StageAvailability {
  if (!episode?.hasScript) {
    return {
      canStart: false,
      reason: `缺少剧本文件，请先补齐 ${describeEpisodeArtifact('script')}。`
    }
  }

  if (stage === 'director') {
    if (
      episode.hasScriptReview ||
      episode.hasDirectorAnalysis ||
      episode.hasArtDesign ||
      episode.hasSeedancePrompts
    ) {
      return { canStart: true, reason: '已满足导演分析前置条件。' }
    }
    return {
      canStart: false,
      reason: `请先完成剧本审核并补齐 ${describeEpisodeArtifact('scriptReview')}。`
    }
  }

  if (stage === 'art') {
    if (!episode.hasDirectorAnalysis) {
      return {
        canStart: false,
        reason: `请先完成导演分析，生成 ${describeEpisodeArtifact('directorAnalysis')}。`
      }
    }
    return { canStart: true, reason: '已满足服化道前置条件。' }
  }

  if (!episode.hasArtDesign) {
    return {
      canStart: false,
      reason: `请先完成服化道，生成 ${describeEpisodeArtifact('artDesign')}。`
    }
  }
  return { canStart: true, reason: '已满足分镜前置条件。' }
}

export function getWorkflowActionAvailability(
  episode: Episode | undefined,
  stage: WorkflowActionId,
  entryStage: ProjectEntryStage,
  hasSourceNovel: boolean
): StageAvailability {
  if (stage === 'story') {
    if (entryStage === 'script') {
      return {
        canStart: false,
        reason: '当前项目从剧本起步，这一步可直接跳过。'
      }
    }
    if (!hasSourceNovel) {
      return {
        canStart: false,
        reason: `缺少 ${describeProjectArtifact('sourceNovel')}，请先补齐小说原文或设定。`
      }
    }
    return { canStart: true, reason: '已满足剧情拆解前置条件。' }
  }

  if (stage === 'script') {
    if (entryStage === 'script') {
      return {
        canStart: false,
        reason: episode?.hasScript
          ? '当前项目从剧本起步，已存在剧本，可直接进入剧本审核。'
          : `当前项目从剧本起步，请先手动导入或编写 ${describeEpisodeArtifact('script')}。`
      }
    }
    if (!hasSourceNovel) {
      return {
        canStart: false,
        reason: `缺少 ${describeProjectArtifact('sourceNovel')}，请先补齐小说原文或设定。`
      }
    }
    return {
      canStart: true,
      reason: '已满足剧本生成前置条件。若当前集没有未用剧情点，执行时会提示先补充剧情库存。'
    }
  }

  if (stage === 'story_review') {
    if (entryStage === 'script') {
      return {
        canStart: false,
        reason: '当前项目从剧本起步，这一步可直接跳过。'
      }
    }
    if (!episode?.hasStoryBeat) {
      return {
        canStart: false,
        reason: `缺少 ${describeEpisodeArtifact('storyBeat')}，请先完成剧情拆解。`
      }
    }
    return { canStart: true, reason: '已满足剧情拆解审核前置条件。' }
  }

  if (stage === 'script_review') {
    if (!episode?.hasScript) {
      return {
        canStart: false,
        reason: `缺少剧本文件，请先补齐 ${describeEpisodeArtifact('script')}。`
      }
    }
    return { canStart: true, reason: '已满足剧本审核前置条件。' }
  }

  if (stage === 'character') {
    if (!episode?.hasDirectorAnalysis) {
      return {
        canStart: false,
        reason: `请先完成导演分析，生成 ${describeEpisodeArtifact('directorAnalysis')}。`
      }
    }
    return { canStart: true, reason: '已满足角色设计前置条件。' }
  }

  if (!episode?.hasSeedancePrompts) {
    return { canStart: false, reason: '请先生成分镜 prompts，再执行分镜审核。' }
  }
  return { canStart: true, reason: '已满足分镜审核前置条件。' }
}

export function parseReviewScore(raw: string): string | null {
  const match = raw.match(/(?:-\s*)?评分[：:]\s*(\d+(?:\.\d+)?)\s*\/\s*10/)
  if (!match) return null
  return `${match[1]}/10`
}

export function countMatches(raw: string, pattern: RegExp): number {
  return [...raw.matchAll(pattern)].length
}

export function uniquePromptPoints(raw: string): number {
  const points = new Set<string>()
  for (const match of raw.matchAll(/(?:^|\n)(?:###?\s*)?(P\d{2})/gm)) {
    points.add(match[1])
  }
  return points.size
}

export function buildMissingFileHints(
  episode: Episode | undefined,
  entryStage: ProjectEntryStage,
  hasSourceNovel: boolean
): Partial<Record<WorkflowStageId, string[]>> {
  const result: Partial<Record<WorkflowStageId, string[]>> = {}

  if (entryStage !== 'script' && !hasSourceNovel) {
    result.novel = [`缺少 ${describeProjectArtifact('sourceNovel')}`]
  }
  if (!episode?.hasStoryBeat && entryStage !== 'script') {
    result.story = [`缺少 ${describeEpisodeArtifact('storyBeat')}`]
  }
  if (!episode?.hasStoryReview && entryStage !== 'script') {
    result.story_review = [`缺少 ${describeEpisodeArtifact('storyReview')}`]
  }
  if (!episode?.hasScript) {
    result.script = [`缺少 ${describeEpisodeArtifact('script')}`]
  }
  if (!episode?.hasScriptReview) {
    result.script_review = [`缺少 ${describeEpisodeArtifact('scriptReview')}`]
  }
  if (!episode?.hasDirectorAnalysis) {
    result.director = [`缺少 ${describeEpisodeArtifact('directorAnalysis')}`]
  }
  if (!episode?.hasCharacterDesign) {
    result.character = [`缺少 ${describeEpisodeArtifact('characterDesign')}`]
  }
  if (!episode?.hasArtDesign) {
    result.art = [`缺少 ${describeEpisodeArtifact('artDesign')}`]
  }
  if (!episode?.hasSeedancePrompts && !episode?.hasStoryboard) {
    result.storyboard = [`缺少 ${describeEpisodeArtifact('seedancePrompts')}`]
  }
  if (!episode?.hasStoryboardReview) {
    result.storyboard_review = [
      `缺少 ${describeEpisodeArtifact('storyboardReview')}`
    ]
  }

  return result
}

export function buildWorkflowCards(params: {
  episode: Episode | undefined
  entryStage: ProjectEntryStage
  displayState: PipelineState
  displayIsRunning: boolean
  summaryMap: WorkflowSummaryMap
  hasSourceNovel: boolean
}): WorkflowCard[] {
  const {
    episode,
    entryStage,
    displayState,
    displayIsRunning,
    summaryMap,
    hasSourceNovel
  } = params
  const entryIndex = getEntryIndex(entryStage)
  const hasLaterThanStory = !!(
    episode?.hasStoryReview ||
    episode?.hasScript ||
    episode?.hasScriptReview ||
    episode?.hasDirectorAnalysis ||
    episode?.hasCharacterDesign ||
    episode?.hasArtDesign ||
    episode?.hasStoryboard ||
    episode?.hasSeedancePrompts ||
    episode?.hasStoryboardReview
  )
  const hasLaterThanStoryReview = !!(
    episode?.hasScript ||
    episode?.hasScriptReview ||
    episode?.hasDirectorAnalysis ||
    episode?.hasCharacterDesign ||
    episode?.hasArtDesign ||
    episode?.hasStoryboard ||
    episode?.hasSeedancePrompts ||
    episode?.hasStoryboardReview
  )
  const hasLaterThanScript = !!(
    episode?.hasScriptReview ||
    episode?.hasDirectorAnalysis ||
    episode?.hasCharacterDesign ||
    episode?.hasArtDesign ||
    episode?.hasStoryboard ||
    episode?.hasSeedancePrompts ||
    episode?.hasStoryboardReview
  )
  const hasLaterThanScriptReview = !!(
    episode?.hasDirectorAnalysis ||
    episode?.hasCharacterDesign ||
    episode?.hasArtDesign ||
    episode?.hasStoryboard ||
    episode?.hasSeedancePrompts ||
    episode?.hasStoryboardReview
  )
  const hasLaterThanCharacter = !!(
    episode?.hasArtDesign ||
    episode?.hasStoryboard ||
    episode?.hasSeedancePrompts ||
    episode?.hasStoryboardReview
  )
  const missingHints = buildMissingFileHints(
    episode,
    entryStage,
    hasSourceNovel
  )

  return FULL_WORKFLOW.map((stage, index) => {
    if (index < entryIndex) {
      return {
        ...stage,
        state: 'skipped',
        note: '当前项目从更后面的阶段接入。',
        summaryLines: ['该阶段在当前项目中被跳过']
      }
    }

    let state: FlowCardState = 'blocked'
    let note = stage.hint
    const summaryLines = summaryMap[stage.id] || missingHints[stage.id] || []

    const activeAutomation =
      displayIsRunning &&
      stage.mode === 'automation' &&
      isStageActive(stage.id as AutomatedPipelineStage, displayState)

    if (activeAutomation) {
      return {
        ...stage,
        state: 'active',
        note: '自动化执行中，请查看日志与实时输出。',
        summaryLines: summaryMap[stage.id] || ['正在生成最新产物']
      }
    }

    switch (stage.id) {
      case 'novel':
        state = hasSourceNovel || episode?.status !== 'idle' ? 'done' : 'ready'
        note = hasSourceNovel
          ? '已检测到小说原文或项目设定。'
          : episode?.status === 'idle'
            ? '等待导入小说原文或参考资料。'
            : '项目已进入后续阶段。'
        break
      case 'story':
        if (episode?.hasStoryBeat) {
          state = 'done'
          note = '已检测到每集剧情拆解文件。'
        } else if (hasLaterThanStory) {
          state = 'warning'
          note = `已进入后续阶段，但缺少 ${describeEpisodeArtifact('storyBeat')}。`
        } else {
          state =
            entryStage === 'novel'
              ? 'ready'
              : entryStage === 'story'
                ? 'ready'
                : 'blocked'
          note = '建议先生成每集剧情拆解，再进入剧本。'
        }
        break
      case 'story_review':
        if (episode?.hasStoryReview) {
          state = 'done'
          note = '已检测到剧情拆解审核记录。'
        } else if (hasLaterThanStoryReview) {
          state = 'warning'
          note = `已进入后续阶段，但缺少 ${describeEpisodeArtifact('storyReview')}。`
        } else {
          state = episode?.hasStoryBeat ? 'ready' : 'blocked'
          note = '建议先审核剧情拆解，再进入剧本生成。'
        }
        break
      case 'script':
        if (episode?.hasScript) {
          state = 'done'
          note = '已检测到剧本文件。'
        } else if (hasLaterThanScript) {
          state = 'warning'
          note = `已进入后续阶段，但缺少 ${describeEpisodeArtifact('script')}。`
        } else {
          state =
            entryStage === 'script' || episode?.hasStoryBeat
              ? 'ready'
              : 'blocked'
          note = '准备生成或补齐剧本文件。'
        }
        break
      case 'script_review':
        if (episode?.hasScriptReview) {
          state = 'done'
          note = '已检测到剧本审核记录。'
        } else if (hasLaterThanScriptReview) {
          state = 'warning'
          note = `已进入制作段，但缺少 ${describeEpisodeArtifact('scriptReview')}。`
        } else {
          state = episode?.hasScript ? 'ready' : 'blocked'
          note =
            '可以直接执行剧本审核，审核通过后才建议启动导演、角色、服化道与分镜。'
        }
        break
      case 'script_approved':
        if (episode?.hasScriptReview || hasLaterThanScriptReview) {
          state = 'done'
          note = '剧本已具备进入制作段的门槛。'
        } else {
          state = 'blocked'
          note = '等待剧本审核完成。'
        }
        break
      case 'director':
        if (episode?.hasDirectorAnalysis) {
          state = activeAutomation ? 'active' : 'done'
          note = '导演分析产物已存在。'
        } else {
          const availability = getStageAvailability(episode, 'director')
          state = availability.canStart ? 'ready' : 'blocked'
          note = availability.reason
        }
        break
      case 'character':
        if (episode?.hasCharacterDesign) {
          state = 'done'
          note = '角色设计资产已存在。'
        } else if (hasLaterThanCharacter) {
          state = 'warning'
          note = '后续阶段已存在，但缺少角色设计产物，建议补齐角色视觉资产。'
        } else {
          state = episode?.hasDirectorAnalysis ? 'ready' : 'blocked'
          note =
            '当前阶段已支持执行，可补齐角色视觉资产并同步到 assets/character-prompts.md。'
        }
        break
      case 'art':
        if (episode?.hasArtDesign) {
          state = activeAutomation ? 'active' : 'done'
          note = '服化道产物已存在。'
        } else {
          const availability = getStageAvailability(episode, 'art')
          state = availability.canStart ? 'ready' : 'blocked'
          note = availability.reason
        }
        break
      case 'storyboard':
        if (episode?.hasStoryboard || episode?.hasSeedancePrompts) {
          state = activeAutomation ? 'active' : 'done'
          note = episode?.hasStoryboard
            ? '已检测到分镜稿。'
            : '已检测到旧版 Seedance prompts，视作分镜阶段已完成。'
        } else {
          const availability = getStageAvailability(episode, 'storyboard')
          state = availability.canStart ? 'ready' : 'blocked'
          note = availability.reason
        }
        break
      case 'storyboard_review':
        if (episode?.hasStoryboardReview) {
          state = 'done'
          note = '已检测到分镜审核记录。'
        } else if (isEpisodeComplete(episode?.status || 'idle')) {
          state = 'warning'
          note = `已生成最终 prompts，但缺少 ${describeEpisodeArtifact('storyboardReview')}。`
        } else {
          state = episode?.hasSeedancePrompts ? 'ready' : 'blocked'
          note = '建议在导出前补齐分镜审核记录。'
        }
        break
      case 'complete':
        if (isEpisodeComplete(episode?.status || 'idle')) {
          state = 'done'
          note = '当前集已具备导出条件。'
        } else {
          state = episode?.hasSeedancePrompts ? 'ready' : 'blocked'
          note = '完成分镜产出后即可进入导出阶段。'
        }
        break
    }

    return { ...stage, state, note, summaryLines }
  })
}

export function getFlowCardClass(state: FlowCardState): string {
  return `flow-card flow-card--${state}`
}

export function resolveWorkflowCardActionSpec(
  params: WorkflowCardActionSpecParams
): WorkflowCardActionSpec {
  const {
    cardId,
    currentEpisode,
    hasSourceNovel,
    workflowAvailability,
    stageAvailability,
    busyWorkflow,
    busyPipeline,
    paths
  } = params
  const {
    sourcePath,
    storyPath,
    storyReviewPath,
    scriptPath,
    reviewPath,
    assetsPath,
    pipelinePath,
    promptBasePath
  } = paths

  switch (cardId) {
    case 'novel':
      return {
        openLabel: hasSourceNovel ? '编辑原文' : '录入原文',
        openPath: sourcePath,
        primaryLabel: workflowAvailability.story.canStart
          ? '拆解一批剧情'
          : '打开小说原文',
        primaryDisabled: workflowAvailability.story.canStart
          ? busyWorkflow
          : !sourcePath,
        primaryIntent: workflowAvailability.story.canStart
          ? { type: 'workflow', stage: 'story' }
          : { type: 'navigate', path: sourcePath }
      }
    case 'story':
      return {
        openLabel: '打开剧情拆解',
        openPath: storyPath,
        primaryLabel: workflowAvailability.story.canStart
          ? currentEpisode?.hasStoryBeat
            ? '重新拆解当前批次'
            : '拆解当前批次'
          : '进入剧情拆解',
        primaryDisabled: workflowAvailability.story.canStart
          ? busyWorkflow
          : !storyPath,
        primaryIntent: workflowAvailability.story.canStart
          ? { type: 'workflow', stage: 'story' }
          : { type: 'navigate', path: storyPath },
        secondaryLabel: storyPath ? '编辑内容' : undefined,
        secondaryIntent: storyPath
          ? { type: 'navigate', path: storyPath }
          : undefined
      }
    case 'story_review':
      return {
        openLabel: '查看剧情审核',
        openPath: currentEpisode?.hasStoryReview
          ? storyReviewPath
          : storyPath,
        primaryLabel: currentEpisode?.hasStoryReview
          ? '查看审核结果'
          : '审核当前批次',
        primaryDisabled: currentEpisode?.hasStoryReview
          ? !storyReviewPath
          : busyWorkflow || !workflowAvailability.story_review.canStart,
        primaryIntent: currentEpisode?.hasStoryReview
          ? { type: 'navigate', path: storyReviewPath }
          : { type: 'workflow', stage: 'story_review' },
        secondaryLabel: storyPath ? '返回剧情拆解' : undefined,
        secondaryIntent: storyPath
          ? { type: 'navigate', path: storyPath }
          : undefined
      }
    case 'script':
      return {
        openLabel: '打开剧本',
        openPath: scriptPath,
        primaryLabel: workflowAvailability.script.canStart
          ? currentEpisode?.hasScript
            ? '重新生成剧本'
            : '执行剧本生成'
          : '进入剧本页',
        primaryDisabled: workflowAvailability.script.canStart
          ? busyWorkflow
          : !scriptPath,
        primaryIntent: workflowAvailability.script.canStart
          ? { type: 'workflow', stage: 'script' }
          : { type: 'navigate', path: scriptPath },
        secondaryLabel: scriptPath ? '手动编辑' : undefined,
        secondaryIntent: scriptPath
          ? { type: 'navigate', path: scriptPath }
          : undefined
      }
    case 'script_review':
      return {
        openLabel: '查看审核',
        openPath: currentEpisode?.hasScriptReview ? reviewPath : scriptPath,
        primaryLabel: currentEpisode?.hasScriptReview
          ? '查看审核结果'
          : '执行剧本审核',
        primaryDisabled: currentEpisode?.hasScriptReview
          ? !reviewPath
          : busyWorkflow || !workflowAvailability.script_review.canStart,
        primaryIntent: currentEpisode?.hasScriptReview
          ? { type: 'navigate', path: reviewPath }
          : { type: 'workflow', stage: 'script_review' },
        secondaryLabel: scriptPath ? '返回剧本' : undefined,
        secondaryIntent: scriptPath
          ? { type: 'navigate', path: scriptPath }
          : undefined
      }
    case 'script_approved':
      return {
        openLabel: '进入制作段',
        openPath: pipelinePath,
        primaryLabel: currentEpisode?.hasScriptReview
          ? '进入导演阶段'
          : '补齐剧本审核',
        primaryDisabled: currentEpisode?.hasScriptReview
          ? !pipelinePath
          : !scriptPath,
        primaryIntent: currentEpisode?.hasScriptReview
          ? { type: 'navigate', path: pipelinePath }
          : { type: 'navigate', path: scriptPath }
      }
    case 'director':
      return {
        openLabel: '查看导演产物',
        openPath: currentEpisode?.hasDirectorAnalysis
          ? promptBasePath
            ? `${promptBasePath}&tab=director`
            : undefined
          : pipelinePath,
        primaryLabel: currentEpisode?.hasDirectorAnalysis
          ? '查看导演分析'
          : '启动导演分析',
        primaryDisabled: currentEpisode?.hasDirectorAnalysis
          ? !promptBasePath
          : busyPipeline || !stageAvailability.director.canStart,
        primaryIntent: currentEpisode?.hasDirectorAnalysis
          ? {
              type: 'navigate',
              path: promptBasePath
                ? `${promptBasePath}&tab=director`
                : undefined
            }
          : { type: 'automation', stage: 'director', singleStage: true },
        secondaryLabel: pipelinePath ? '回到执行台' : undefined,
        secondaryIntent: pipelinePath
          ? { type: 'navigate', path: pipelinePath }
          : undefined
      }
    case 'character':
      return {
        openLabel: '查看角色资产',
        openPath: currentEpisode?.hasCharacterDesign
          ? assetsPath
          : pipelinePath,
        primaryLabel: currentEpisode?.hasCharacterDesign
          ? '打开素材库'
          : '执行角色设计',
        primaryDisabled: currentEpisode?.hasCharacterDesign
          ? !assetsPath
          : busyWorkflow || !workflowAvailability.character.canStart,
        primaryIntent: currentEpisode?.hasCharacterDesign
          ? { type: 'navigate', path: assetsPath }
          : { type: 'workflow', stage: 'character' },
        secondaryLabel: assetsPath ? '查看素材库' : undefined,
        secondaryIntent: assetsPath
          ? { type: 'navigate', path: assetsPath }
          : undefined
      }
    case 'art':
      return {
        openLabel: '查看服化道产物',
        openPath: currentEpisode?.hasArtDesign
          ? promptBasePath
            ? `${promptBasePath}&tab=art`
            : undefined
          : pipelinePath,
        primaryLabel: currentEpisode?.hasArtDesign
          ? '查看服化道设计'
          : '启动服化道',
        primaryDisabled: currentEpisode?.hasArtDesign
          ? !promptBasePath
          : busyPipeline || !stageAvailability.art.canStart,
        primaryIntent: currentEpisode?.hasArtDesign
          ? {
              type: 'navigate',
              path: promptBasePath ? `${promptBasePath}&tab=art` : undefined
            }
          : { type: 'automation', stage: 'art', singleStage: true },
        secondaryLabel: assetsPath ? '查看素材库' : undefined,
        secondaryIntent: assetsPath
          ? { type: 'navigate', path: assetsPath }
          : undefined
      }
    case 'storyboard':
      return {
        openLabel: '查看分镜产物',
        openPath:
          currentEpisode?.hasSeedancePrompts || currentEpisode?.hasStoryboard
            ? promptBasePath
              ? `${promptBasePath}&tab=prompts`
              : undefined
            : pipelinePath,
        primaryLabel:
          currentEpisode?.hasSeedancePrompts || currentEpisode?.hasStoryboard
            ? '查看提示词'
            : '启动分镜生成',
        primaryDisabled:
          currentEpisode?.hasSeedancePrompts || currentEpisode?.hasStoryboard
            ? !promptBasePath
            : busyPipeline || !stageAvailability.storyboard.canStart,
        primaryIntent:
          currentEpisode?.hasSeedancePrompts || currentEpisode?.hasStoryboard
            ? {
                type: 'navigate',
                path: promptBasePath
                  ? `${promptBasePath}&tab=prompts`
                  : undefined
              }
            : { type: 'automation', stage: 'storyboard', singleStage: true },
        secondaryLabel: reviewPath ? '查看审核页' : undefined,
        secondaryIntent: reviewPath
          ? { type: 'navigate', path: reviewPath }
          : undefined
      }
    case 'storyboard_review':
      return {
        openLabel: '查看审核结果',
        openPath: currentEpisode?.hasStoryboardReview
          ? reviewPath
          : pipelinePath,
        primaryLabel: currentEpisode?.hasStoryboardReview
          ? '查看分镜审核'
          : '执行分镜审核',
        primaryDisabled: currentEpisode?.hasStoryboardReview
          ? !reviewPath
          : busyWorkflow || !workflowAvailability.storyboard_review.canStart,
        primaryIntent: currentEpisode?.hasStoryboardReview
          ? { type: 'navigate', path: reviewPath }
          : { type: 'workflow', stage: 'storyboard_review' },
        secondaryLabel: promptBasePath ? '查看提示词' : undefined,
        secondaryIntent: promptBasePath
          ? { type: 'navigate', path: `${promptBasePath}&tab=prompts` }
          : undefined
      }
    case 'complete':
      return {
        openLabel: '查看最终产物',
        openPath: currentEpisode?.hasSeedancePrompts
          ? promptBasePath
            ? `${promptBasePath}&tab=prompts`
            : undefined
          : pipelinePath,
        primaryLabel: currentEpisode?.hasSeedancePrompts
          ? '查看最终提示词'
          : '回到执行台',
        primaryDisabled: currentEpisode?.hasSeedancePrompts
          ? !promptBasePath
          : !pipelinePath,
        primaryIntent: currentEpisode?.hasSeedancePrompts
          ? {
              type: 'navigate',
              path: promptBasePath ? `${promptBasePath}&tab=prompts` : undefined
            }
          : { type: 'navigate', path: pipelinePath },
        secondaryLabel: reviewPath ? '查看审核汇总' : undefined,
        secondaryIntent: reviewPath
          ? { type: 'navigate', path: reviewPath }
          : undefined
      }
  }
}

export function buildPipelineNodes(params: {
  displayState: PipelineState
  displayTimings: Array<{
    stage: AutomatedPipelineStage
    startedAt: number
    endedAt?: number
    elapsed: number
  }>
  displayCurrentStage: AutomatedPipelineStage | null
  stageElapsed: number
  isEngineMatch: boolean
  reviews: ReviewResult[]
  currentEpisode?: Episode
}): Node[] {
  const {
    displayState,
    displayTimings,
    displayCurrentStage,
    stageElapsed,
    isEngineMatch,
    reviews,
    currentEpisode
  } = params
  const result: Node[] = []
  const xStart = 80
  const xGap = 200
  const yStage = 90
  const yReview = 210

  result.push({
    id: 'start',
    type: 'stage',
    position: { x: xStart - 160, y: yStage },
    data: {
      label: '剧本通过',
      emoji: '✅',
      stage: 'start',
      state: displayState,
      isActive: false,
      isDone:
        currentEpisode?.hasScriptReview ||
        currentEpisode?.hasDirectorAnalysis ||
        false
    }
  })

  AUTO_STAGES.forEach((stage, i) => {
    const x = xStart + i * xGap
    const timing = displayTimings.find((t) => t.stage === stage.id)
    const active = isStageActive(stage.id, displayState)
    const done = isStageDone(stage.id, displayState)

    let timeLabel = ''
    if (timing) {
      if (timing.endedAt) {
        timeLabel = fmtTime(timing.elapsed)
      } else if (active && stage.id === displayCurrentStage) {
        timeLabel = fmtTime(stageElapsed)
      }
    }

    result.push({
      id: stage.id,
      type: 'stage',
      position: { x, y: yStage },
      data: {
        label: stage.label,
        emoji: stage.emoji,
        stage: stage.id,
        state: displayState,
        isActive: active,
        isDone: done,
        timeLabel
      }
    })

    const reviewStage =
      stage.id === 'storyboard' ? 'storyboard_review' : stage.id
    const reviewForStage =
      (isEngineMatch ? reviews : [])
        .filter((r) => r.stage === reviewStage)
        .pop() || null
    result.push({
      id: `review-${stage.id}`,
      type: 'review',
      position: { x: x + 24, y: yReview },
      data: {
        label: '审核',
        stage: stage.id,
        review: reviewForStage,
        isActive: (displayState as string) === `${stage.id}_reviewing`
      }
    })
  })

  return result
}

export function buildPipelineEdges(displayState: PipelineState): Edge[] {
  const result: Edge[] = [
    {
      id: 'e-start-director',
      source: 'start',
      target: 'director',
      animated: displayState === 'script_done',
      style: { stroke: 'var(--color-border)' },
      markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-border)' }
    }
  ]

  AUTO_STAGES.forEach((stage, i) => {
    result.push({
      id: `e-${stage.id}-review`,
      source: stage.id,
      target: `review-${stage.id}`,
      animated: isStageActive(stage.id, displayState),
      style: { stroke: 'var(--color-border)' }
    })

    if (i < AUTO_STAGES.length - 1) {
      result.push({
        id: `e-${stage.id}-${AUTO_STAGES[i + 1].id}`,
        source: stage.id,
        target: AUTO_STAGES[i + 1].id,
        animated:
          isStageDone(stage.id, displayState) &&
          isStageActive(AUTO_STAGES[i + 1].id, displayState),
        style: { stroke: 'var(--color-border)' },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: 'var(--color-border)'
        }
      })
    }
  })

  return result
}
