import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateStage = vi.fn()
const reviewStage = vi.fn()
const setProvider = vi.fn()

vi.mock('./workflow-engine', () => ({
  WorkflowEngine: class MockWorkflowEngine {
    setProvider = setProvider
    generateStage = generateStage
    reviewStage = reviewStage
  }
}))

describe('workflow-step-runner', async () => {
  const { WorkflowStepRunner } = await import('./workflow-step-runner')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('生成类 stage 成功时返回 stage/outputPath/success=true', async () => {
    generateStage.mockResolvedValue({
      stage: 'story',
      outputPath: '/tmp/project/story/ep01.md',
      content: 'story content',
      promptMetrics: {
        systemChars: 10,
        userChars: 20
      }
    })

    const runner = new WorkflowStepRunner('/tmp/skills')
    const result = await runner.runStoryGeneration({
      projectPath: '/tmp/project',
      episodeNum: 1,
      projectContext: {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 1
      }
    })

    expect(generateStage).toHaveBeenCalledWith(
      'story',
      {
        projectPath: '/tmp/project',
        episodeNum: 1,
        projectContext: {
          projectName: '项目',
          visualStyle: '现实',
          targetMedium: '短剧',
          episodeNumber: 1
        }
      },
      { reviewFeedback: undefined }
    )
    expect(result).toEqual({
      stage: 'story',
      success: true,
      outputPath: '/tmp/project/story/ep01.md'
    })
  })

  it('生成类 stage 失败时返回 success=false 和错误文案', async () => {
    generateStage.mockRejectedValue(new Error('generate failed'))

    const runner = new WorkflowStepRunner('/tmp/skills')
    const result = await runner.runCharacterDesign({
      projectPath: '/tmp/project',
      episodeNum: 2,
      projectContext: {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 2
      }
    })

    expect(result).toEqual({
      stage: 'character',
      success: false,
      error: 'generate failed'
    })
  })

  it('生成类 stage 会透传审核反馈用于修订', async () => {
    generateStage.mockResolvedValue({
      stage: 'story',
      outputPath: '/tmp/project/story/ep01.md',
      content: 'story content',
      promptMetrics: {
        systemChars: 10,
        userChars: 20
      }
    })

    const runner = new WorkflowStepRunner('/tmp/skills')
    await runner.runStoryGeneration({
      projectPath: '/tmp/project',
      episodeNum: 1,
      projectContext: {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 1
      },
      reviewFeedback: '冲突不足，需要加强钩子'
    })

    expect(generateStage).toHaveBeenCalledWith(
      'story',
      expect.objectContaining({
        reviewFeedback: '冲突不足，需要加强钩子'
      }),
      { reviewFeedback: '冲突不足，需要加强钩子' }
    )
  })

  it('审核类 stage 会以 review.passed 作为 success，并透传 review/outputPath', async () => {
    reviewStage.mockResolvedValue({
      stage: 'script_review',
      outputPath: '/tmp/project/reviews/script/ep01.md',
      review: {
        stage: 'script_review',
        reviewType: 'business',
        result: 'FAIL',
        passed: false,
        score: 6,
        feedback: '需要修改',
        issues: [],
        createdAt: '2026-05-07T00:00:00.000Z'
      }
    })

    const runner = new WorkflowStepRunner('/tmp/skills')
    const result = await runner.runScriptReview({
      projectPath: '/tmp/project',
      episodeNum: 1,
      projectContext: {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 1
      }
    })

    expect(reviewStage).toHaveBeenCalledWith('script_review', {
      projectPath: '/tmp/project',
      episodeNum: 1,
      projectContext: {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 1
      }
    })
    expect(result).toEqual({
      stage: 'script_review',
      success: false,
      outputPath: '/tmp/project/reviews/script/ep01.md',
      review: {
        stage: 'script_review',
        reviewType: 'business',
        result: 'FAIL',
        passed: false,
        score: 6,
        feedback: '需要修改',
        issues: [],
        createdAt: '2026-05-07T00:00:00.000Z'
      }
    })
  })

  it('剧情拆解审核会调用 story_review 并透传结果', async () => {
    reviewStage.mockResolvedValue({
      stage: 'story_review',
      outputPath: '/tmp/project/reviews/story/ep01.md',
      review: {
        stage: 'story_review',
        reviewType: 'business',
        result: 'PASS',
        passed: true,
        score: 8,
        feedback: '通过',
        issues: [],
        createdAt: '2026-05-07T00:00:00.000Z'
      }
    })

    const runner = new WorkflowStepRunner('/tmp/skills')
    const result = await runner.runStoryReview({
      projectPath: '/tmp/project',
      episodeNum: 1,
      projectContext: {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 1
      }
    })

    expect(reviewStage).toHaveBeenCalledWith('story_review', {
      projectPath: '/tmp/project',
      episodeNum: 1,
      projectContext: {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 1
      }
    })
    expect(result).toEqual({
      stage: 'story_review',
      success: true,
      outputPath: '/tmp/project/reviews/story/ep01.md',
      review: {
        stage: 'story_review',
        reviewType: 'business',
        result: 'PASS',
        passed: true,
        score: 8,
        feedback: '通过',
        issues: [],
        createdAt: '2026-05-07T00:00:00.000Z'
      }
    })
  })

  it('审核类 stage 抛异常时返回 success=false 和错误文案', async () => {
    reviewStage.mockRejectedValue(new Error('review failed'))

    const runner = new WorkflowStepRunner('/tmp/skills')
    const result = await runner.runStoryboardReview({
      projectPath: '/tmp/project',
      episodeNum: 3,
      projectContext: {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 3
      }
    })

    expect(result).toEqual({
      stage: 'storyboard_review',
      success: false,
      error: 'review failed'
    })
  })
})
