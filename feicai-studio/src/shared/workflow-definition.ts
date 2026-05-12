import type { WorkflowStageId } from './types'

export type WorkflowStageMode =
  | 'source'
  | 'gate'
  | 'manual'
  | 'automation'
  | 'final'

export interface WorkflowStageDefinition {
  id: WorkflowStageId
  label: string
  cardLabel: string
  shortLabel: string
  progress: number
  hint: string
  mode: WorkflowStageMode
}

export const WORKFLOW_STAGE_DEFINITIONS: WorkflowStageDefinition[] = [
  {
    id: 'novel',
    label: '小说已导入',
    cardLabel: '小说导入',
    shortLabel: '小说',
    progress: 5,
    hint: '原著、设定、参考资料进入项目。',
    mode: 'source'
  },
  {
    id: 'story',
    label: '剧情已拆解',
    cardLabel: '剧情库存',
    shortLabel: '剧情',
    progress: 15,
    hint: '按批次拆解小说章节，生成剧情库存草稿。',
    mode: 'source'
  },
  {
    id: 'story_review',
    label: '剧情拆解审核已完成',
    cardLabel: '批次审核',
    shortLabel: '剧拆审',
    progress: 22,
    hint: '按旧版 8 维规则审核当前批次，PASS 后写入剧情库存。',
    mode: 'gate'
  },
  {
    id: 'script',
    label: '剧本已生成',
    cardLabel: '剧本生成',
    shortLabel: '剧本',
    progress: 30,
    hint: '输出可进入制作段的单集剧本。',
    mode: 'source'
  },
  {
    id: 'script_review',
    label: '剧本审核中',
    cardLabel: '剧本审核',
    shortLabel: '剧审',
    progress: 40,
    hint: '审核短剧节奏、结构、角色动机与合规。',
    mode: 'gate'
  },
  {
    id: 'script_approved',
    label: '剧本已通过',
    cardLabel: '剧本通过',
    shortLabel: '剧本通过',
    progress: 50,
    hint: '通过后进入导演、角色、服化道与分镜制作段。',
    mode: 'gate'
  },
  {
    id: 'director',
    label: '导演分析已完成',
    cardLabel: '导演分析',
    shortLabel: '导演',
    progress: 62,
    hint: '沉淀讲戏、节奏与镜头目标。',
    mode: 'automation'
  },
  {
    id: 'character',
    label: '角色设计已完成',
    cardLabel: '角色设计',
    shortLabel: '角色',
    progress: 72,
    hint: '沉淀角色视觉资产与跨集统一规则。',
    mode: 'manual'
  },
  {
    id: 'art',
    label: '服化道已完成',
    cardLabel: '服化道',
    shortLabel: '服化道',
    progress: 82,
    hint: '生成服装、化妆、道具、场景提示。',
    mode: 'automation'
  },
  {
    id: 'storyboard',
    label: '分镜已生成',
    cardLabel: '分镜生成',
    shortLabel: '分镜',
    progress: 92,
    hint: '输出分镜稿与 Seedance prompts。',
    mode: 'automation'
  },
  {
    id: 'storyboard_review',
    label: '分镜审核已完成',
    cardLabel: '分镜审核',
    shortLabel: '分镜审核',
    progress: 96,
    hint: '审核镜头逻辑、可执行性与一致性。',
    mode: 'gate'
  },
  {
    id: 'complete',
    label: '全流程完成',
    cardLabel: '导出完成',
    shortLabel: '完成',
    progress: 100,
    hint: '当前集已具备导出与归档条件。',
    mode: 'final'
  }
]

export const WORKFLOW_STAGE_ORDER = WORKFLOW_STAGE_DEFINITIONS.map(
  (stage) => stage.id
)

export const WORKFLOW_STAGE_MAP: Record<
  WorkflowStageId,
  WorkflowStageDefinition
> = WORKFLOW_STAGE_DEFINITIONS.reduce(
  (acc, stage) => {
    acc[stage.id] = stage
    return acc
  },
  {} as Record<WorkflowStageId, WorkflowStageDefinition>
)
