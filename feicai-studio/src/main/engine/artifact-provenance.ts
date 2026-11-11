import { createHash } from 'crypto'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { DEFAULT_PIPELINE_SETTINGS } from '@shared/types'
import type { ProjectConfig, ReviewResult, ReviewStage } from '@shared/types'
import type { EpisodeArtifactId } from '@shared/artifact-registry'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath,
  resolveProjectLayout
} from '@shared/path-resolver'
import { parsePlotBreakdownMarkdown } from '@shared/plot-breakdown'
import { getEntryRequirements } from '@shared/workflow'
import { readArtReference } from './art-output-merger'
import {
  assertEpisodeNumber,
  assertPathWithinProject
} from '../security/access-control'

export interface ReviewProvenance {
  artifactHash: string
  inputHashes: Record<string, string>
}

const reviewedArtifact: Record<ReviewStage, EpisodeArtifactId> = {
  story_review: 'storyBeat',
  script_review: 'script',
  director: 'directorAnalysis',
  art: 'artDesign',
  storyboard_review: 'seedancePrompts'
}

export function hashReviewContent(content: string): string {
  // 操作身份用于恢复/取消追踪，不属于被审正文；批次身份仍保留。
  const reviewedContent = content.replace(
    /<!--\s*feicai-operation:[^>]*-->/g,
    ''
  )
  return createHash('sha256').update(reviewedContent, 'utf8').digest('hex')
}

function readContent(
  projectPath: string,
  filePath: string,
  required = false
): string | null {
  const safePath = assertPathWithinProject(projectPath, filePath)
  try {
    const content = readFileSync(safePath, 'utf8')
    if (required && !content.trim())
      throw new Error('待审产物为空，不能绑定审核')
    return content
  } catch (error) {
    if (!required && (error as NodeJS.ErrnoException).code === 'ENOENT')
      return null
    throw error
  }
}

function hashOptional(content: string | null): string {
  // 缺失与空正文是不同的依赖状态；新出现的依赖同样使旧审核失效。
  return hashReviewContent(content === null ? 'missing' : `content\0${content}`)
}

/** 同步读取实际正文及稳定的相关依赖，不包含库存消费状态或本次审核发布动作。 */
export function captureReviewProvenance(
  projectPath: string,
  stage: ReviewStage,
  episodeNum: number,
  config?: Partial<ProjectConfig> | null
): ReviewProvenance {
  assertEpisodeNumber(episodeNum)
  if (!Object.prototype.hasOwnProperty.call(reviewedArtifact, stage))
    throw new Error('未知审核阶段')
  const readEpisode = (
    artifact: EpisodeArtifactId,
    episode = episodeNum,
    required = false
  ) =>
    readContent(
      projectPath,
      resolveEpisodeArtifactPath(projectPath, artifact, episode, config),
      required
    )
  const output = readEpisode(reviewedArtifact[stage], episodeNum, true)!
  const inputHashes: Record<string, string> = {}
  const add = (key: string, value: string | null) => {
    inputHashes[key] = hashOptional(value)
  }
  const entry = getEntryRequirements(config?.entryStage)
  // Dependency schema changes invalidate old credentials conservatively.
  add('dependencySchema', '2')
  add(
    'reviewConfig',
    JSON.stringify({
      entryStage: config?.entryStage ?? 'novel',
      projectName: config?.projectName ?? null,
      visualStyle: config?.visualStyle ?? null,
      targetMedium: config?.targetMedium ?? null,
      chaptersPerEpisode: config?.chaptersPerEpisode ?? null,
      totalEpisodes: config?.totalEpisodes ?? null,
      // Workflow actions read partial disk settings; pipeline launches fill defaults.
      // Hash the same effective values in a fixed key order for both paths.
      pipelineSettings: {
        ...DEFAULT_PIPELINE_SETTINGS,
        ...config?.pipelineSettings
      }
    })
  )

  const batchMatch = output.match(/<!--\s*feicai-story-batch:(\d+)\s*-->/)
  const batch = batchMatch ? Number(batchMatch[1]) : episodeNum
  if (stage === 'story_review') assertEpisodeNumber(batch)
  const chapterWindow =
    stage === 'story_review'
      ? 6
      : Math.max(0, Number(config?.chaptersPerEpisode) || 0)
  if (stage === 'story_review' && entry.requiresNovel && !batchMatch)
    throw new Error('旧剧情草稿缺少批次身份，请重新生成或明确批次后再审核')
  const sourceUnit = stage === 'story_review' ? batch : episodeNum
  const chapterStart = (sourceUnit - 1) * chapterWindow + 1
  const chapterEnd = chapterStart + chapterWindow - 1
  const maxChapter =
    Number(config?.totalEpisodes) > 0 && Number(config?.chaptersPerEpisode) > 0
      ? Number(config?.totalEpisodes) * Number(config?.chaptersPerEpisode)
      : Infinity
  const chapterDir = assertPathWithinProject(
    projectPath,
    join(projectPath, resolveProjectLayout(config).sourceDir, 'chapters')
  )
  let chapterFiles: string[] = []
  if (entry.requiresNovel && chapterWindow > 0) {
    try {
      chapterFiles = readdirSync(chapterDir)
        .filter((name) => /^chapter-\d+.*\.md$/i.test(name))
        .sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  if (entry.requiresNovel) {
    if (chapterFiles.length === 0 || chapterWindow === 0) {
      add(
        'sourceNovel',
        readContent(
          projectPath,
          resolveProjectArtifactPath(projectPath, 'sourceNovel', config)
        )
      )
    } else {
      const selected = chapterFiles.filter((name) => {
        const index = Number(name.match(/^chapter-(\d+)/i)![1])
        return (
          index >= chapterStart && index <= chapterEnd && index <= maxChapter
        )
      })
      add(
        'sourceChapterWindow',
        JSON.stringify({ chapterStart, chapterEnd, files: selected })
      )
      for (const file of selected)
        add(
          `sourceChapter:${file}`,
          readContent(projectPath, join(chapterDir, file), true)
        )
    }
  }

  if (stage === 'story_review' && entry.requiresInventory) {
    const inventory = readContent(
      projectPath,
      resolveProjectArtifactPath(projectPath, 'plotBreakdown', config)
    )
    // The current batch is the reviewed output, and publishing/consuming it is
    // not an upstream edit. Other batches still constrain numbering/allocation.
    const otherBatches = inventory
      ? parsePlotBreakdownMarkdown(inventory)
          .batches.filter(
            (group) =>
              Number(group.heading.match(/^###\s+第(\d+)批/u)?.[1]) !== batch
          )
          .map((group) => ({
            heading: group.heading,
            entries: group.entries.map(({ id, index, content, episode }) => ({
              id,
              index,
              content,
              episode
            }))
          }))
      : []
    add('storyInventoryContext', JSON.stringify(otherBatches))
  }
  if (stage !== 'story_review') {
    if (entry.requiresStoryReview) {
      add('storyBeat', readEpisode('storyBeat', episodeNum, true))
      add('storyReview', readEpisode('storyReview'))
    }
    if (entry.requiresInventory) {
      const inventory = readContent(
        projectPath,
        resolveProjectArtifactPath(projectPath, 'plotBreakdown', config)
      )
      const related =
        inventory === null
          ? null
          : parsePlotBreakdownMarkdown(inventory)
              .batches.flatMap((group) => group.entries)
              .filter((entry) => entry.episode === episodeNum)
              .map(({ id, index, content, episode }) => ({
                id,
                index,
                content,
                episode
              }))
              .sort((a, b) => a.index - b.index)
      add('plotBreakdown', related === null ? null : JSON.stringify(related))
    }
    if (episodeNum > 1)
      add('previousScript', readEpisode('script', episodeNum - 1))
    if (!config?.totalEpisodes || episodeNum < config.totalEpisodes)
      add('nextScript', readEpisode('script', episodeNum + 1))
  }
  if (
    stage === 'director' ||
    stage === 'art' ||
    stage === 'storyboard_review'
  ) {
    add('script', readEpisode('script', episodeNum, true))
    add('scriptReview', readEpisode('scriptReview'))
  }
  if (stage === 'art' || stage === 'storyboard_review') {
    add('directorAnalysis', readEpisode('directorAnalysis', episodeNum, true))
    add('characterDesign', readEpisode('characterDesign'))
    // Both stages depend on the stable art references; storyboard additionally
    // consumes the published shared assets verbatim.
    for (const artifact of ['characterPrompts', 'scenePrompts'] as const) {
      add(
        `artReference:${artifact}`,
        readArtReference(projectPath, artifact, episodeNum, config)
      )
      if (stage === 'storyboard_review')
        add(
          artifact,
          readArtReference(projectPath, artifact, undefined, config)
        )
    }
  }
  if (stage === 'storyboard_review')
    add('artDesign', readEpisode('artDesign', episodeNum, true))
  return { artifactHash: hashReviewContent(output), inputHashes }
}

/** legacy 未绑定、格式无效、正文/任一相关上游变更，均不能成为当前有效通过。 */
export function isReviewCurrent(
  review: ReviewResult,
  projectPath: string,
  episodeNum: number,
  config?: Partial<ProjectConfig> | null
): boolean {
  if (
    review.result !== 'PASS' ||
    review.passed !== true ||
    !Number.isFinite(review.score) ||
    review.score < 0 ||
    review.score > 10 ||
    !review.artifactHash ||
    !review.inputHashes
  )
    return false
  if (review.score < (config?.pipelineSettings?.passScore ?? 7)) return false
  try {
    const current = captureReviewProvenance(
      projectPath,
      review.stage,
      episodeNum,
      config
    )
    const keys = Object.keys(current.inputHashes)
    return (
      current.artifactHash === review.artifactHash &&
      keys.length === Object.keys(review.inputHashes).length &&
      keys.every((key) => current.inputHashes[key] === review.inputHashes![key])
    )
  } catch {
    return false
  }
}
