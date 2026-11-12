import { getNovelProductionReadiness } from './novel-production-readiness'
import { normalizeProjectConfig } from '@shared/project-config'
import type {
  Episode,
  EpisodeStageSnapshot,
  Project,
  ProjectPipelineState
} from '@shared/types'

export const PRODUCTION_STAGES = [
  { id: 'story', label: '剧情' },
  { id: 'script', label: '剧本' },
  { id: 'director', label: '导演' },
  { id: 'art', label: '服化道' },
  { id: 'storyboard', label: '分镜' }
] as const
export type ProductionStage = (typeof PRODUCTION_STAGES)[number]['id']
export interface ProductionCell {
  refresh?: boolean
  actionLabel?: string
  stage: ProductionStage
  label: string
  status: string
  detail: string
  satisfied: boolean
  applicable: boolean
  path: string
}
export interface ProductionRow {
  episodeNumber: number
  title: string
  cells: ProductionCell[]
  next: ProductionCell | null
  complete: boolean
}

export function productionPath(
  projectId: string,
  ep: number,
  stage: ProductionStage
): string {
  const base = `/project/${encodeURIComponent(projectId)}`
  if (stage === 'story' || stage === 'script')
    return `${base}/${stage}?ep=${ep}`
  return `${base}/prompts?ep=${ep}&tab=${stage === 'storyboard' ? 'prompts' : stage}`
}

function reviewStatus(
  snapshot: EpisodeStageSnapshot | undefined,
  hasReport: boolean
): string {
  if (snapshot?.status === 'stale') return '需要更新审核'
  if (snapshot?.status === 'failed') return '审核未通过或执行失败'
  if (snapshot?.status === 'interrupted') return '执行已中断'
  if (snapshot?.status === 'running') return '执行状态待确认'
  return hasReport ? '缺少有效 PASS' : '待审核'
}

// This is a read-only projection of server-validated flags and stage snapshots.
// A path proves an artifact exists; it never grants a review PASS.
export function buildProductionRows(params: {
  project: Project
  episodes: Episode[]
  pipeline: ProjectPipelineState | null
  hasSource: boolean | null
  readyEpisodeNumbers?: readonly number[] | null
  usedEpisodeNumbers?: readonly number[] | null
}): ProductionRow[] {
  const { project, pipeline, hasSource } = params
  const entry = normalizeProjectConfig(project.config).entryStage || 'novel'
  const episodes = params.episodes.filter((ep) => ep.projectId === project.id)
  const byNumber = new Map(episodes.map((ep) => [ep.episodeNumber, ep]))
  const count = Number.isFinite(project.totalEpisodes)
    ? Math.max(0, Math.trunc(project.totalEpisodes))
    : 0
  const numbers = new Set(Array.from({ length: count }, (_, i) => i + 1))
  for (const ep of episodes)
    if (Number.isInteger(ep.episodeNumber) && ep.episodeNumber > 0)
      numbers.add(ep.episodeNumber)
  return [...numbers]
    .sort((a, b) => a - b)
    .map((episodeNumber) => {
      const ep = byNumber.get(episodeNumber)
      const states =
        pipeline?.projectId === project.id
          ? pipeline.episodes[episodeNumber]?.stageStates
          : undefined
      const readiness = getNovelProductionReadiness({
        hasSource,
        waterline: params.readyEpisodeNumbers
          ? {
              readyEpisodeNumbers: [...params.readyEpisodeNumbers],
              usedEpisodeNumbers: [...(params.usedEpisodeNumbers || [])]
            }
          : null,
        projectId: project.id,
        episodeNumber,
        episode: ep
      })
      const scriptPass = ep?.hasScript === true && ep.hasScriptReview === true
      const directorPass =
        scriptPass &&
        ep?.hasDirectorAnalysis === true &&
        states?.director?.status === 'passed'
      const artPass =
        directorPass &&
        ep?.hasArtDesign === true &&
        states?.art?.status === 'passed'
      const storyboardPass =
        artPass &&
        ep?.hasSeedancePrompts === true &&
        ep.hasStoryboardReview === true
      const cells = PRODUCTION_STAGES.map(
        ({ id: stage, label }): ProductionCell => {
          const path = productionPath(project.id, episodeNumber, stage)
          const applicable = !(stage === 'story' && entry === 'script')
          if (!applicable)
            return {
              stage,
              label,
              path,
              applicable,
              satisfied: true,
              status: '不适用',
              detail: '从剧本开始，无需剧情阶段。'
            }
          const exists =
            stage === 'story'
              ? !!(ep?.storyBeatPath || ep?.hasStoryBeat)
              : stage === 'script'
                ? !!(ep?.scriptPath || ep?.hasScript)
                : stage === 'director'
                  ? !!(ep?.directorAnalysisPath || ep?.hasDirectorAnalysis)
                  : stage === 'art'
                    ? !!(ep?.artDesignPath || ep?.hasArtDesign)
                    : !!(ep?.seedancePromptsPath || ep?.hasSeedancePrompts)
          // Novel entry uses shared plot inventory, not the per-episode story review gate.
          const inventory = stage === 'story' && entry === 'novel'
          const satisfied = inventory
            ? !!(ep?.hasScript || ep?.scriptPath) || readiness.canStart
            : stage === 'story'
              ? ep?.hasStoryBeat === true && ep.hasStoryReview === true
              : stage === 'script'
                ? scriptPass
                : stage === 'director'
                  ? directorPass
                  : stage === 'art'
                    ? artPass
                    : storyboardPass
          const snapshot =
            states?.[
              stage === 'story'
                ? 'story_review'
                : stage === 'script'
                  ? 'script_review'
                  : stage === 'storyboard'
                    ? 'storyboard_review'
                    : stage
            ]
          const hasReport =
            stage === 'story'
              ? !!ep?.storyReviewPath
              : stage === 'script'
                ? !!ep?.scriptReviewPath
                : stage === 'storyboard'
                  ? !!ep?.storyboardReviewPath
                  : !!snapshot?.lastReview
          const missingInput =
            stage === 'story'
              ? entry === 'novel' && hasSource === false
              : stage === 'script'
                ? (entry === 'story' &&
                    !(ep?.hasStoryBeat && ep.hasStoryReview)) ||
                  (entry === 'novel' && hasSource === false)
                : stage === 'director'
                  ? !scriptPass
                  : stage === 'art'
                    ? !directorPass
                    : !artPass
          let status = satisfied
            ? '有效审核通过'
            : exists
              ? reviewStatus(snapshot, hasReport)
              : missingInput
                ? '缺少输入'
                : '未开始'
          let detail = `${exists ? '产物存在' : '无产物'}；${satisfied ? '当前审核有效' : '尚未满足当前审核门禁'}。`
          let targetPath = path
          if (inventory) {
            status =
              ep?.hasScript || ep?.scriptPath ? '已供给剧本' : readiness.label
            detail = readiness.reason
            targetPath =
              readiness.action === 'source'
                ? `/project/${encodeURIComponent(project.id)}/source`
                : productionPath(project.id, episodeNumber, 'story')
          } else if (!ep) {
            status = '状态未取得'
            detail = '尚无本集扫描结果，请刷新状态；可进入现有页面补齐输入。'
          }
          if (!satisfied && missingInput && exists)
            detail += ' 上游门禁尚未满足，请先处理本集下一步。'
          return {
            refresh: inventory && !satisfied && readiness.action === 'refresh',
            actionLabel: inventory && !satisfied ? readiness.label : undefined,
            stage,
            label,
            path: targetPath,
            applicable,
            satisfied,
            status,
            detail
          }
        }
      )
      return {
        episodeNumber,
        title: ep?.title || `第${episodeNumber}集`,
        cells,
        next: cells.find((cell) => !cell.satisfied) || null,
        complete: cells.every((cell) => cell.satisfied)
      }
    })
}
