import { describe, expect, it } from 'vitest'
import {
  buildWorkflowCards,
  getStageAvailability,
  getWorkflowActionAvailability,
  isStageActive,
  isStageDone,
  mapEpisodeStatusToDisplayState,
  parseReviewScore,
  resolveWorkflowCardActionSpec,
  uniquePromptPoints
} from './pipeline-view'
import type { Episode } from '@shared/types'

function createEpisode(partial: Partial<Episode> = {}): Episode {
  return {
    id: 'ep-1',
    projectId: 'p-1',
    episodeNumber: 1,
    title: '第1集',
    status: 'idle',
    hasStoryBeat: false,
    hasScript: false,
    hasScriptReview: false,
    hasDirectorAnalysis: false,
    hasCharacterDesign: false,
    hasArtDesign: false,
    hasStoryboard: false,
    hasSeedancePrompts: false,
    hasStoryboardReview: false,
    createdAt: '2026-05-07T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:00.000Z',
    ...partial
  }
}

describe('pipeline-view', () => {
  it('能识别自动执行段活跃与完成态', () => {
    expect(isStageActive('director', 'director_analyzing')).toBe(true)
    expect(isStageDone('director', 'art_done')).toBe(true)
    expect(isStageDone('art', 'storyboard_done')).toBe(true)
    expect(isStageActive('storyboard', 'idle')).toBe(false)
  })

  it('能推导自动执行与工作流前置条件', () => {
    const episode = createEpisode({
      hasScript: true,
      hasScriptReview: true,
      hasDirectorAnalysis: true
    })
    expect(getStageAvailability(episode, 'director').canStart).toBe(true)
    expect(getStageAvailability(episode, 'art').canStart).toBe(true)
    expect(
      getWorkflowActionAvailability(episode, 'character', 'novel', true)
        .canStart
    ).toBe(true)
    expect(
      getWorkflowActionAvailability(createEpisode(), 'story', 'novel', false)
        .canStart
    ).toBe(false)
  })

  it('能根据阶段产物构建流程卡片', () => {
    const episode = createEpisode({
      status: 'script_approved',
      hasStoryBeat: true,
      hasScript: true,
      hasScriptReview: true
    })

    const cards = buildWorkflowCards({
      episode,
      entryStage: 'novel',
      displayState: 'script_done',
      displayIsRunning: false,
      summaryMap: {},
      hasSourceNovel: true
    })

    expect(cards.find((card) => card.id === 'novel')?.state).toBe('done')
    expect(cards.find((card) => card.id === 'script_review')?.state).toBe(
      'done'
    )
    expect(cards.find((card) => card.id === 'director')?.state).toBe('ready')
  })

  it('能根据门槛与入口阶段推导工作流卡片按钮意图', () => {
    const episode = createEpisode({
      status: 'script_approved',
      hasScript: true,
      hasScriptReview: true
    })

    const workflowAvailability = {
      story: getWorkflowActionAvailability(episode, 'story', 'script', false),
      script: getWorkflowActionAvailability(episode, 'script', 'script', false),
      script_review: getWorkflowActionAvailability(
        episode,
        'script_review',
        'script',
        false
      ),
      character: getWorkflowActionAvailability(
        episode,
        'character',
        'script',
        false
      ),
      storyboard_review: getWorkflowActionAvailability(
        episode,
        'storyboard_review',
        'script',
        false
      )
    }
    const stageAvailability = {
      director: getStageAvailability(episode, 'director'),
      art: getStageAvailability(episode, 'art'),
      storyboard: getStageAvailability(episode, 'storyboard')
    }

    const novelSpec = resolveWorkflowCardActionSpec({
      cardId: 'novel',
      currentEpisode: episode,
      hasSourceNovel: false,
      workflowAvailability,
      stageAvailability,
      busyWorkflow: false,
      busyPipeline: false,
      paths: { sourcePath: '/project/1/source' }
    })
    expect(novelSpec.primaryIntent).toEqual({
      type: 'navigate',
      path: '/project/1/source'
    })
    expect(novelSpec.primaryLabel).toBe('打开小说原文')

    const approvedSpec = resolveWorkflowCardActionSpec({
      cardId: 'script_approved',
      currentEpisode: episode,
      hasSourceNovel: false,
      workflowAvailability,
      stageAvailability,
      busyWorkflow: false,
      busyPipeline: false,
      paths: {
        pipelinePath: '/project/1/pipeline?ep=1',
        scriptPath: '/project/1/script?ep=1'
      }
    })
    expect(approvedSpec.primaryIntent).toEqual({
      type: 'navigate',
      path: '/project/1/pipeline?ep=1'
    })
    expect(approvedSpec.primaryDisabled).toBe(false)
  })

  it('能为自动化阶段推导启动按钮与禁用状态', () => {
    const episode = createEpisode({
      status: 'script_approved',
      hasScript: true,
      hasScriptReview: true
    })
    const workflowAvailability = {
      story: getWorkflowActionAvailability(episode, 'story', 'novel', true),
      script: getWorkflowActionAvailability(episode, 'script', 'novel', true),
      script_review: getWorkflowActionAvailability(
        episode,
        'script_review',
        'novel',
        true
      ),
      character: getWorkflowActionAvailability(
        episode,
        'character',
        'novel',
        true
      ),
      storyboard_review: getWorkflowActionAvailability(
        episode,
        'storyboard_review',
        'novel',
        true
      )
    }
    const stageAvailability = {
      director: getStageAvailability(episode, 'director'),
      art: getStageAvailability(episode, 'art'),
      storyboard: getStageAvailability(episode, 'storyboard')
    }

    const directorSpec = resolveWorkflowCardActionSpec({
      cardId: 'director',
      currentEpisode: episode,
      hasSourceNovel: true,
      workflowAvailability,
      stageAvailability,
      busyWorkflow: false,
      busyPipeline: false,
      paths: { pipelinePath: '/project/1/pipeline?ep=1' }
    })
    expect(directorSpec.primaryIntent).toEqual({
      type: 'automation',
      stage: 'director',
      singleStage: true
    })
    expect(directorSpec.primaryDisabled).toBe(false)

    const storyboardSpec = resolveWorkflowCardActionSpec({
      cardId: 'storyboard',
      currentEpisode: episode,
      hasSourceNovel: true,
      workflowAvailability,
      stageAvailability,
      busyWorkflow: false,
      busyPipeline: true,
      paths: { pipelinePath: '/project/1/pipeline?ep=1' }
    })
    expect(storyboardSpec.primaryIntent).toEqual({
      type: 'automation',
      stage: 'storyboard',
      singleStage: true
    })
    expect(storyboardSpec.primaryDisabled).toBe(true)
  })

  it('能解析展示辅助信息', () => {
    expect(mapEpisodeStatusToDisplayState('script_approved')).toBe(
      'script_done'
    )
    expect(mapEpisodeStatusToDisplayState('story')).toBe('story_done')
    expect(mapEpisodeStatusToDisplayState('script_review')).toBe(
      'script_reviewing'
    )
    expect(mapEpisodeStatusToDisplayState('character')).toBe('character_done')
    expect(mapEpisodeStatusToDisplayState('storyboard')).toBe('storyboard_done')
    expect(mapEpisodeStatusToDisplayState('storyboard_review')).toBe(
      'storyboard_reviewing'
    )
    expect(parseReviewScore('- 评分：8.5 / 10')).toBe('8.5/10')
    expect(uniquePromptPoints('# P01\n内容\n## P02\n内容\nP01')).toBe(2)
  })
})
