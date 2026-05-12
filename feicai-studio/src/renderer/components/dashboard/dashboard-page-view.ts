import type {
  Project,
  ProjectEntryStage,
  ProjectWorkflowMode
} from '@shared/types'

export type WizardStep = 1 | 2 | 3

export interface EntryOption {
  entryStage: ProjectEntryStage
  workflowMode: ProjectWorkflowMode
  title: string
  subtitle: string
  badge: string
  directories: string[]
}

export const ENTRY_OPTIONS: EntryOption[] = [
  {
    entryStage: 'novel',
    workflowMode: 'novel_to_shortdrama',
    title: '从小说开始',
    subtitle: '适合从小说原文出发，逐步生成剧情、剧本与后续制作资产。',
    badge: '完整流程',
    directories: [
      'source/',
      'story/',
      'script/',
      'assets/',
      'outputs/',
      'reviews/'
    ]
  },
  {
    entryStage: 'story',
    workflowMode: 'story_to_shortdrama',
    title: '从剧情开始',
    subtitle: '已有集纲或剧情拆解，直接进入剧本生成与后续制作。',
    badge: '中段接入',
    directories: ['story/', 'script/', 'assets/', 'outputs/', 'reviews/']
  },
  {
    entryStage: 'script',
    workflowMode: 'script_to_shortdrama',
    title: '从剧本开始',
    subtitle: '已有剧本文件，直接进入剧本审核、导演、角色、服化道与分镜。',
    badge: '快速接入',
    directories: ['script/', 'assets/', 'outputs/', 'reviews/']
  }
]

export function getEntryOption(entryStage: ProjectEntryStage): EntryOption {
  return (
    ENTRY_OPTIONS.find((option) => option.entryStage === entryStage) ||
    ENTRY_OPTIONS[0]
  )
}

export function getDashboardStats(projects: Project[]) {
  return {
    projectCount: projects.length,
    totalEpisodes: projects.reduce(
      (sum, project) => sum + (project.totalEpisodes || 0),
      0
    )
  }
}
