import type {
  Episode,
  ProjectEntryStage,
  ProjectWorkflowMode
} from '@shared/types'
import type {
  WorkflowCard,
  WorkflowCardActionMeta
} from '@renderer/utils/pipeline-view'

const ENTRY_PRESENTATION = {
  novel: {
    title: '从小说到剧本',
    description: '导入小说，拆解并审核剧情库存，再生成和审核单集剧本。',
    stepIds: ['novel', 'story', 'script'] as const
  },
  story: {
    title: '从剧情到剧本',
    description:
      '导入或编写单集剧情，通过当前有效审核后生成剧本，再审核剧本。无需小说原文。',
    stepIds: ['story', 'script'] as const
  },
  script: {
    title: '从剧本进入制作',
    description:
      '导入或编写现成剧本，通过当前有效审核后进入导演、角色、服化道与分镜制作。',
    stepIds: ['script'] as const
  }
}

const MODE_LABELS: Record<ProjectWorkflowMode, string> = {
  legacy_shortdrama: '经典短剧流程',
  novel_to_shortdrama: '小说改编短剧',
  story_to_shortdrama: '剧情改编短剧',
  script_to_shortdrama: '剧本制作短剧'
}

export const FLOW_STATE_LABELS: Record<WorkflowCard['state'], string> = {
  done: '已完成',
  active: '执行中',
  ready: '可继续',
  blocked: '前置未满足',
  skipped: '本入口不适用',
  warning: '需补齐'
}

export function getEntryPresentation(entryStage: ProjectEntryStage) {
  return ENTRY_PRESENTATION[entryStage]
}

export function getWorkflowModeLabel(mode?: string): string {
  return MODE_LABELS[mode as ProjectWorkflowMode] || '未设置流程模式'
}

export interface StoryPipelineStep {
  id: 'novel' | 'story' | 'script'
  label: string
  description: string
  state: WorkflowCard['state']
  stateLabel: string
  primaryLabel: string
  primaryDisabled?: boolean
  primaryAction: () => void
}

export function buildStoryPipelineSteps(params: {
  entryStage: ProjectEntryStage
  episode?: Episode
  cards: WorkflowCard[]
  actionMetaMap: Partial<Record<WorkflowCard['id'], WorkflowCardActionMeta>>
  onOpen: (path: string) => void
}): StoryPipelineStep[] {
  const { entryStage, episode, cards, actionMetaMap, onOpen } = params
  return ENTRY_PRESENTATION[entryStage].stepIds.map((id) => {
    const card = cards.find((item) => item.id === id)!
    const reviewId = id === 'story' ? 'story_review' : 'script_review'
    const review =
      id === 'novel' ? undefined : cards.find((item) => item.id === reviewId)
    const sharedInventory = entryStage === 'novel' && id === 'story'
    const hasFile = sharedInventory
      ? card.state === 'done'
      : id === 'novel'
        ? card.state === 'done'
        : id === 'story'
          ? !!episode?.hasStoryBeat
          : !!episode?.hasScript
    const approved = sharedInventory
      ? card.state === 'done'
      : id === 'story'
        ? !!episode?.hasStoryReview
        : id === 'script'
          ? !!episode?.hasScriptReview
          : hasFile
    const state =
      card.state === 'active'
        ? 'active'
        : review?.state === 'active'
          ? 'active'
          : hasFile && approved
            ? 'done'
            : hasFile
              ? review?.state || 'blocked'
              : card.state
    const meta =
      actionMetaMap[hasFile && review && !sharedInventory ? reviewId : id]
    const sourcePath = id === 'novel' ? meta?.openPath : undefined
    return {
      id,
      label:
        id === 'novel'
          ? '小说原文'
          : id === 'story'
            ? entryStage === 'novel'
              ? '剧情准备'
              : '单集剧情'
            : '单集剧本',
      state,
      stateLabel:
        state === 'active'
          ? '执行中'
          : hasFile && approved
            ? sharedInventory
              ? '剧情已就绪'
              : id === 'novel'
                ? '原文已就绪'
                : '审核有效'
            : hasFile
              ? state === 'blocked'
                ? '文件已存在 · 审核被阻塞'
                : '文件已存在 · 待有效审核'
              : state === 'blocked'
                ? '前置未满足 · 待补齐内容'
                : '待补齐内容',
      description:
        state === 'active'
          ? '正在处理当前阶段，请等待任务结束。'
          : hasFile && review && !sharedInventory
            ? review.note
            : card.note,
      primaryLabel:
        id === 'novel'
          ? hasFile
            ? '查看原文'
            : '录入原文'
          : meta?.primaryLabel || '暂不可用',
      primaryDisabled:
        id === 'novel' ? !sourcePath : !meta || meta.primaryDisabled,
      primaryAction: sourcePath
        ? () => onOpen(sourcePath)
        : meta?.primaryAction || (() => {})
    }
  })
}

export function getCommandProgress(steps: StoryPipelineStep[]) {
  const applicable = steps.filter((step) => step.state !== 'skipped')
  const completed = applicable.filter((step) => step.state === 'done').length
  return {
    completed,
    total: applicable.length,
    percent: applicable.length
      ? Math.round((completed / applicable.length) * 100)
      : 0
  }
}

export function pickNextWorkflowCard(
  cards: WorkflowCard[]
): WorkflowCard | undefined {
  // Preserve prerequisite order, including missing/invalid reviews. Active work
  // takes precedence even when it is outside the source-to-script section.
  return (
    cards.find((card) => card.state === 'active') ||
    cards.find(
      (card) =>
        card.state !== 'done' &&
        card.state !== 'skipped' &&
        card.id !== 'script_approved'
    ) ||
    cards.find((card) => card.id === 'complete')
  )
}
