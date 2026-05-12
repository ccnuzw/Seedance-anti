import { describe, expect, it, vi } from 'vitest'
import type { Project } from '@shared/types'
import type { WorkflowActionId } from '@renderer/utils/pipeline-view'
import {
  executePipelineWorkflowAction,
  getPipelineWorkflowStageLabel
} from './pipeline-workflow-service'

vi.mock('@renderer/services/workflow-actions', () => ({
  runStoryGeneration: vi
    .fn()
    .mockResolvedValue({ success: true, outputPath: '/tmp/story.md' }),
  runStoryReview: vi
    .fn()
    .mockResolvedValue({ success: true, review: { score: 8 } }),
  runScriptGeneration: vi
    .fn()
    .mockResolvedValue({ success: true, outputPath: '/tmp/script.md' }),
  runScriptReview: vi
    .fn()
    .mockResolvedValue({ success: true, review: { score: 9 } }),
  runCharacterDesign: vi
    .fn()
    .mockResolvedValue({ success: true, outputPath: '/tmp/character.md' }),
  runStoryboardReview: vi
    .fn()
    .mockResolvedValue({ success: true, review: { score: 8 } })
}))

function createProject(): Project {
  return {
    id: 'project-1',
    name: '项目',
    visualStyle: '现实',
    targetMedium: '短剧',
    projectPath: '/tmp/project',
    totalEpisodes: 12,
    config: {
      projectName: '项目',
      totalEpisodes: 12,
      visualStyle: '现实',
      targetMedium: '短剧',
      createdAt: '2026-05-07T00:00:00.000Z'
    },
    createdAt: '2026-05-07T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:00.000Z'
  }
}

describe('pipeline-workflow-service', () => {
  it('可以返回阶段中文标签', () => {
    expect(getPipelineWorkflowStageLabel('story')).toBe('剧情批次拆解')
    expect(getPipelineWorkflowStageLabel('story_review')).toBe(
      '剧情批次审核'
    )
    expect(getPipelineWorkflowStageLabel('storyboard_review')).toBe('分镜审核')
  })

  it('可以执行阶段动作并回写结果', async () => {
    const addToast = vi.fn()
    const syncEpisodeStatus = vi.fn().mockResolvedValue(undefined)
    const setReviewFeedback = vi.fn()
    const setWorkflowReport = vi.fn()

    const result = await executePipelineWorkflowAction({
      project: createProject(),
      episodeNum: 2,
      stage: 'script_review' as WorkflowActionId,
      availability: { canStart: true, reason: 'ok' },
      addToast,
      syncEpisodeStatus,
      setReviewFeedback,
      setWorkflowReport
    })

    expect(result.success).toBe(true)
    expect(result.stage).toBe('script_review')
    expect(syncEpisodeStatus).toHaveBeenCalled()
    expect(setReviewFeedback).toHaveBeenCalled()
    expect(setWorkflowReport).toHaveBeenCalled()
    expect(addToast).toHaveBeenCalledWith('success', '剧本审核已完成')
  })

  it('前置不满足时会直接返回 error 并提示失败', async () => {
    const addToast = vi.fn()
    const syncEpisodeStatus = vi.fn()
    const setReviewFeedback = vi.fn()
    const setWorkflowReport = vi.fn()

    const result = await executePipelineWorkflowAction({
      project: createProject(),
      episodeNum: 2,
      stage: 'story' as WorkflowActionId,
      availability: { canStart: false, reason: '缺少小说' },
      addToast,
      syncEpisodeStatus,
      setReviewFeedback,
      setWorkflowReport
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('缺少小说')
    expect(addToast).toHaveBeenCalledWith('error', '缺少小说')
    expect(syncEpisodeStatus).not.toHaveBeenCalled()
  })
})
