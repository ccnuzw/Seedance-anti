import type { Episode } from '@shared/types'
import type {
  WorkflowActionId,
  WorkflowActionResult,
  WorkflowAvailabilityMap
} from '@renderer/utils/pipeline-view'

export interface WorkflowActionCardViewModel {
  id: WorkflowActionId
  badge: string
  title: string
  description: string
  stateLabel: string
  stateClassName: 'done' | 'ready' | 'blocked'
  actionLabel: string
}

const WORKFLOW_ACTION_CARD_BASE: Record<
  WorkflowActionId,
  Pick<
    WorkflowActionCardViewModel,
    'badge' | 'title' | 'description' | 'actionLabel'
  >
> = {
  story: {
    badge: '源头',
    title: '🧩 剧情拆解',
    description:
      '根据 `source/novel.md` 生成当前集的剧情拆解，写入 `story/episode-beats/epXX.md`。',
    actionLabel: '执行剧情拆解'
  },
  story_review: {
    badge: '门槛',
    title: '🔎 剧情审核',
    description:
      '按旧版 8 维规则审核剧情拆解、剧情库存与原文还原，通过后写入 `reviews/story/epXX.md`。',
    actionLabel: '执行剧情审核'
  },
  script: {
    badge: '源头',
    title: '📖 剧本生成',
    description:
      '根据 `story/episode-beats/epXX.md` 生成完整剧本，写入 `script/epXX.md`。',
    actionLabel: '执行剧本生成'
  },
  script_review: {
    badge: '门槛',
    title: '📝 剧本审核',
    description:
      '审核短剧节奏、结构、角色动机和制作可执行性，通过后写入 `reviews/script/epXX.md`。',
    actionLabel: '执行剧本审核'
  },
  character: {
    badge: '补齐',
    title: '🎭 角色设计',
    description:
      '生成角色视觉资产，同时同步到 `outputs/epXX/01.2-character-design.md` 和 `assets/character-prompts.md`。',
    actionLabel: '执行角色设计'
  },
  storyboard_review: {
    badge: '门槛',
    title: '🔍 分镜审核',
    description:
      '审核镜头逻辑、Seedance 提示词可执行性与角色一致性，通过后写入 `reviews/storyboard/epXX.md`。',
    actionLabel: '执行分镜审核'
  }
}

function resolveActionState(params: {
  episode: Episode | undefined
  stage: WorkflowActionId
  availability: WorkflowAvailabilityMap[WorkflowActionId] | undefined
}): Pick<WorkflowActionCardViewModel, 'stateLabel' | 'stateClassName'> {
  const { episode, stage, availability } = params
  const done =
    (stage === 'story' && episode?.hasStoryBeat) ||
    (stage === 'story_review' && episode?.hasStoryReview) ||
    (stage === 'script' && episode?.hasScript) ||
    (stage === 'script_review' && episode?.hasScriptReview) ||
    (stage === 'character' && episode?.hasCharacterDesign) ||
    (stage === 'storyboard_review' && episode?.hasStoryboardReview)

  if (done) {
    const doneLabel = {
      story: '已存在',
      story_review: '已通过',
      script: '已存在',
      script_review: '已通过',
      character: '已完成',
      storyboard_review: '已通过'
    } satisfies Record<WorkflowActionId, string>

    return { stateLabel: doneLabel[stage], stateClassName: 'done' }
  }

  if (availability?.canStart) {
    return { stateLabel: '可执行', stateClassName: 'ready' }
  }

  return { stateLabel: '未开放', stateClassName: 'blocked' }
}

export function buildWorkflowActionCards(
  episode: Episode | undefined,
  workflowAvailability: WorkflowAvailabilityMap
): WorkflowActionCardViewModel[] {
  return (Object.keys(WORKFLOW_ACTION_CARD_BASE) as WorkflowActionId[]).map(
    (stage) => ({
      id: stage,
      ...WORKFLOW_ACTION_CARD_BASE[stage],
      ...resolveActionState({
        episode,
        stage,
        availability: workflowAvailability[stage]
      })
    })
  )
}

export function getWorkflowReportTitle(stage: WorkflowActionId): string {
  return {
    story: '剧情拆解',
    story_review: '剧情拆解审核',
    script: '剧本生成',
    script_review: '剧本审核',
    character: '角色设计',
    storyboard_review: '分镜审核'
  }[stage]
}

export function getWorkflowReportStatus(report: WorkflowActionResult): string {
  if (report.success) return '执行完成'
  if (report.review) return `未通过 ${report.review.score}/10`
  return '执行失败'
}
