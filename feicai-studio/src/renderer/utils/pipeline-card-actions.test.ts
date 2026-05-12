import { describe, expect, it, vi } from 'vitest'
import {
  buildWorkflowRoutePaths,
  resolveWorkflowCardActionMeta
} from './pipeline-card-actions'
import type { WorkflowCard } from '@renderer/utils/pipeline-view'

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

  it('会把 workflow intent 转成可执行动作', () => {
    const onWorkflowAction = vi.fn()
    const navigate = vi.fn()
    const onAutomationAction = vi.fn()

    const meta = resolveWorkflowCardActionMeta({
      card: {
        id: 'story',
        label: '剧情拆解',
        emoji: '🧩',
        hint: '',
        mode: 'workflow',
        state: 'ready',
        note: '',
        summaryLines: []
      } satisfies WorkflowCard,
      specParams: {
        currentEpisode: undefined,
        hasSourceNovel: true,
        workflowAvailability: {
          story: { canStart: true, reason: 'ok' },
          story_review: { canStart: false, reason: 'blocked' },
          script: { canStart: false, reason: 'blocked' },
          script_review: { canStart: false, reason: 'blocked' },
          character: { canStart: false, reason: 'blocked' },
          storyboard_review: { canStart: false, reason: 'blocked' }
        },
        stageAvailability: {
          director: { canStart: false, reason: 'blocked' },
          art: { canStart: false, reason: 'blocked' },
          storyboard: { canStart: false, reason: 'blocked' }
        },
        busyWorkflow: false,
        busyPipeline: false,
        paths: buildWorkflowRoutePaths('project-1', 2)
      },
      navigate,
      onWorkflowAction,
      onAutomationAction
    })

    meta.primaryAction()
    expect(onWorkflowAction).toHaveBeenCalledWith('story')
    expect(navigate).not.toHaveBeenCalled()
    expect(onAutomationAction).not.toHaveBeenCalled()
  })

  it('会把 automation intent 转成单阶段启动动作', () => {
    const onAutomationAction = vi.fn()

    const meta = resolveWorkflowCardActionMeta({
      card: {
        id: 'director',
        label: '导演分析',
        emoji: '🎬',
        hint: '',
        mode: 'automation',
        state: 'ready',
        note: '',
        summaryLines: []
      } satisfies WorkflowCard,
      specParams: {
        currentEpisode: undefined,
        hasSourceNovel: true,
        workflowAvailability: {
          story: { canStart: true, reason: 'ok' },
          story_review: { canStart: true, reason: 'ok' },
          script: { canStart: true, reason: 'ok' },
          script_review: { canStart: true, reason: 'ok' },
          character: { canStart: true, reason: 'ok' },
          storyboard_review: { canStart: true, reason: 'ok' }
        },
        stageAvailability: {
          director: { canStart: true, reason: 'ok' },
          art: { canStart: false, reason: 'blocked' },
          storyboard: { canStart: false, reason: 'blocked' }
        },
        busyWorkflow: false,
        busyPipeline: false,
        paths: buildWorkflowRoutePaths('project-1', 2)
      },
      navigate: vi.fn(),
      onWorkflowAction: vi.fn(),
      onAutomationAction
    })

    meta.primaryAction()
    expect(onAutomationAction).toHaveBeenCalledWith('director', true)
  })
})
