import { describe, expect, it } from 'vitest'
import { buildWorkflowRoutePaths } from './pipeline-card-actions'

describe('pipeline-card-actions', () => {
  it('会为项目和集数生成统一路由路径', () => {
    expect(buildWorkflowRoutePaths('project-1', 3)).toEqual({
      sourcePath: '/project/project-1/source',
      storyPath: '/project/project-1/story?ep=3',
      storyReviewPath: '/project/project-1/review?ep=3&stage=story_review',
      scriptPath: '/project/project-1/script?ep=3',
      reviewPath: '/project/project-1/review?ep=3',
      assetsPath: '/project/project-1/assets',
      pipelinePath: '/project/project-1/pipeline?ep=3',
      promptBasePath: '/project/project-1/prompts?ep=3'
    })
  })
})
