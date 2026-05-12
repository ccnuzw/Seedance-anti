export type ProjectArtifactId =
  | 'projectConfig'
  | 'sourceNovel'
  | 'plotBreakdown'
  | 'characterPrompts'
  | 'scenePrompts'
  | 'pipelineState'

export type EpisodeArtifactId =
  | 'storyBeat'
  | 'storyReview'
  | 'script'
  | 'scriptReview'
  | 'directorAnalysis'
  | 'characterDesign'
  | 'artDesign'
  | 'storyboard'
  | 'seedancePrompts'
  | 'storyboardReview'

export type ArtifactId = ProjectArtifactId | EpisodeArtifactId
export type ArtifactScope = 'project' | 'episode'

export interface ProjectLayout {
  sourceDir: string
  sourceNotesDir: string
  storyDir: string
  storyEpisodeBeatsDir: string
  scriptDir: string
  assetsDir: string
  assetsCharactersDir: string
  assetsArtDir: string
  assetsScenesDir: string
  outputsDir: string
  reviewsDir: string
  scriptReviewsDir: string
  storyboardReviewsDir: string
  storyReviewsDir: string
  exportsDir: string
}

export interface ArtifactDefinition {
  id: ArtifactId
  scope: ArtifactScope
  label: string
  resolveRelativePath: (layout: ProjectLayout, episodeToken?: string) => string
}

export const PROJECT_ARTIFACT_REGISTRY: Record<
  ProjectArtifactId,
  ArtifactDefinition
> = {
  projectConfig: {
    id: 'projectConfig',
    scope: 'project',
    label: '项目配置',
    resolveRelativePath: () => 'project-config.json'
  },
  sourceNovel: {
    id: 'sourceNovel',
    scope: 'project',
    label: '小说原文',
    resolveRelativePath: (layout) => `${layout.sourceDir}/novel.md`
  },
  plotBreakdown: {
    id: 'plotBreakdown',
    scope: 'project',
    label: '剧情库存',
    resolveRelativePath: (layout) => `${layout.storyDir}/plot-breakdown.md`
  },
  characterPrompts: {
    id: 'characterPrompts',
    scope: 'project',
    label: '角色资产库',
    resolveRelativePath: (layout) => `${layout.assetsDir}/character-prompts.md`
  },
  scenePrompts: {
    id: 'scenePrompts',
    scope: 'project',
    label: '场景资产库',
    resolveRelativePath: (layout) => `${layout.assetsDir}/scene-prompts.md`
  },
  pipelineState: {
    id: 'pipelineState',
    scope: 'project',
    label: '流水线持久化状态',
    resolveRelativePath: (layout) => `${layout.outputsDir}/pipeline-state.json`
  }
}

export const EPISODE_ARTIFACT_REGISTRY: Record<
  EpisodeArtifactId,
  ArtifactDefinition
> = {
  storyBeat: {
    id: 'storyBeat',
    scope: 'episode',
    label: '剧情拆解',
    resolveRelativePath: (layout, episodeToken = 'epXX') =>
      `${layout.storyEpisodeBeatsDir}/${episodeToken}.md`
  },
  storyReview: {
    id: 'storyReview',
    scope: 'episode',
    label: '剧情拆解审核',
    resolveRelativePath: (layout, episodeToken = 'epXX') =>
      `${layout.storyReviewsDir}/${episodeToken}.md`
  },
  script: {
    id: 'script',
    scope: 'episode',
    label: '剧本',
    resolveRelativePath: (layout, episodeToken = 'epXX') =>
      `${layout.scriptDir}/${episodeToken}.md`
  },
  scriptReview: {
    id: 'scriptReview',
    scope: 'episode',
    label: '剧本审核',
    resolveRelativePath: (layout, episodeToken = 'epXX') =>
      `${layout.scriptReviewsDir}/${episodeToken}.md`
  },
  directorAnalysis: {
    id: 'directorAnalysis',
    scope: 'episode',
    label: '导演分析',
    resolveRelativePath: (layout, episodeToken = 'epXX') =>
      `${layout.outputsDir}/${episodeToken}/01-director-analysis.md`
  },
  characterDesign: {
    id: 'characterDesign',
    scope: 'episode',
    label: '角色设计',
    resolveRelativePath: (layout, episodeToken = 'epXX') =>
      `${layout.outputsDir}/${episodeToken}/01.2-character-design.md`
  },
  artDesign: {
    id: 'artDesign',
    scope: 'episode',
    label: '服化道设计',
    resolveRelativePath: (layout, episodeToken = 'epXX') =>
      `${layout.outputsDir}/${episodeToken}/01.5-art-design-output.md`
  },
  storyboard: {
    id: 'storyboard',
    scope: 'episode',
    label: '分镜稿',
    resolveRelativePath: (layout, episodeToken = 'epXX') =>
      `${layout.outputsDir}/${episodeToken}/02-storyboard.md`
  },
  seedancePrompts: {
    id: 'seedancePrompts',
    scope: 'episode',
    label: 'Seedance 提示词',
    resolveRelativePath: (layout, episodeToken = 'epXX') =>
      `${layout.outputsDir}/${episodeToken}/02-seedance-prompts.md`
  },
  storyboardReview: {
    id: 'storyboardReview',
    scope: 'episode',
    label: '分镜审核',
    resolveRelativePath: (layout, episodeToken = 'epXX') =>
      `${layout.storyboardReviewsDir}/${episodeToken}.md`
  }
}

export const ARTIFACT_REGISTRY: Record<ArtifactId, ArtifactDefinition> = {
  ...PROJECT_ARTIFACT_REGISTRY,
  ...EPISODE_ARTIFACT_REGISTRY
}
