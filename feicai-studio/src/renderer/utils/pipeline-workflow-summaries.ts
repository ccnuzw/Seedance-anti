import type { Episode } from '@shared/types'
import {
  countMatches,
  parseReviewScore,
  uniquePromptPoints,
  type WorkflowSummaryMap
} from '@renderer/utils/pipeline-view'

export interface WorkflowArtifactTexts {
  novelRaw: string | null
  storyRaw: string | null
  storyReviewRaw: string | null
  scriptRaw: string | null
  scriptReviewRaw: string | null
  directorRaw: string | null
  characterRaw: string | null
  artRaw: string | null
  promptsRaw: string | null
  storyboardReviewRaw: string | null
}

export function buildWorkflowSummaries(
  texts: WorkflowArtifactTexts,
  episode?: Episode
): { hasSourceNovel: boolean; summaryMap: WorkflowSummaryMap } {
  const summaryMap: WorkflowSummaryMap = {}
  const hasSourceNovel = !!texts.novelRaw?.trim()

  if (hasSourceNovel) {
    const novelContent = texts.novelRaw ?? ''
    summaryMap.novel = [`原文 ${novelContent.split('\n').length} 行`]
  }
  if (texts.storyRaw) {
    summaryMap.story = [
      `${countMatches(texts.storyRaw, /^###\s+Beat/gm)} 个 beats`,
      `${texts.storyRaw.split('\n').length} 行内容`
    ]
  }
  if (texts.storyReviewRaw) {
    const score = parseReviewScore(texts.storyReviewRaw)
    summaryMap.story_review = score
      ? [`审核评分 ${score}`]
      : ['已生成剧情拆解审核记录']
  }
  if (texts.scriptRaw) {
    summaryMap.script = [
      `${countMatches(texts.scriptRaw, /^##\s+场景/gm)} 个场景`,
      `${texts.scriptRaw.split('\n').length} 行剧本`
    ]
  }
  if (texts.scriptReviewRaw) {
    const score = parseReviewScore(texts.scriptReviewRaw)
    summaryMap.script_review = score
      ? [`审核评分 ${score}`]
      : ['已生成剧本审核记录']
    summaryMap.script_approved = score
      ? [`已通过门槛，评分 ${score}`]
      : ['已具备进入制作段条件']
  }
  if (texts.directorRaw) {
    summaryMap.director = [
      `${uniquePromptPoints(texts.directorRaw)} 个剧情点`,
      `${texts.directorRaw.split('\n').length} 行分析`
    ]
  }
  if (texts.characterRaw) {
    summaryMap.character = [
      `${countMatches(texts.characterRaw, /^##\s+/gm)} 个角色条目`
    ]
  }
  if (texts.artRaw) {
    summaryMap.art = [`${texts.artRaw.split('\n').length} 行服化道稿`]
  }
  if (
    texts.promptsRaw ||
    episode?.totalPrompts ||
    episode?.totalDurationSeconds
  ) {
    const promptCount =
      episode?.totalPrompts ??
      (texts.promptsRaw ? countMatches(texts.promptsRaw, /^##\s+/gm) : 0)
    const promptDuration = episode?.totalDurationSeconds
    summaryMap.storyboard = [
      promptCount > 0 ? `${promptCount} 条提示词` : '已生成分镜产物',
      promptDuration ? `总时长 ${promptDuration}s` : '等待时长统计'
    ]
    summaryMap.complete = summaryMap.storyboard
  }
  if (texts.storyboardReviewRaw) {
    const score = parseReviewScore(texts.storyboardReviewRaw)
    summaryMap.storyboard_review = score
      ? [`审核评分 ${score}`]
      : ['已生成分镜审核记录']
  }

  return { hasSourceNovel, summaryMap }
}
