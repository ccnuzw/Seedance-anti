import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Episode, ProjectEntryStage } from '@shared/types'
import {
  buildWorkflowCards,
  getStageAvailability,
  getWorkflowActionAvailability,
  type WorkflowCard,
  type WorkflowCardActionMeta
} from '@renderer/utils/pipeline-view'
import {
  buildWorkflowRoutePaths,
  resolveWorkflowCardActionMeta
} from '@renderer/utils/pipeline-card-actions'
import PipelineCommandCenter from './PipelineCommandCenter'
import UnifiedWorkflowChain from './UnifiedWorkflowChain'
import {
  buildStoryPipelineSteps,
  getCommandProgress,
  getEntryPresentation,
  getWorkflowModeLabel,
  pickNextWorkflowCard
} from './command-center-view'

function scenario(
  entryStage: ProjectEntryStage,
  partial: Partial<Episode> = {},
  busy = false
) {
  const episode: Episode = {
    id: 'ep-1',
    projectId: 'p-1',
    episodeNumber: 1,
    title: '第一集',
    status: 'idle',
    hasStoryBeat: false,
    hasStoryReview: false,
    hasScript: false,
    hasScriptReview: false,
    hasDirectorAnalysis: false,
    hasCharacterDesign: false,
    hasArtDesign: false,
    hasStoryboard: false,
    hasSeedancePrompts: false,
    hasStoryboardReview: false,
    createdAt: '',
    updatedAt: '',
    ...partial
  }
  const hasSourceNovel = entryStage === 'novel'
  const cards = buildWorkflowCards({
    episode,
    entryStage,
    displayState: 'idle',
    displayIsRunning: false,
    hasSourceNovel,
    summaryMap: {}
  })
  const navigate = vi.fn()
  const onWorkflowAction = vi.fn()
  const onAutomationAction = vi.fn()
  const actionMetaMap = Object.fromEntries(
    cards.map((card) => [
      card.id,
      resolveWorkflowCardActionMeta({
        card,
        specParams: {
          currentEpisode: episode,
          hasSourceNovel,
          busyWorkflow: busy,
          busyPipeline: busy,
          paths: buildWorkflowRoutePaths('p-1', 1),
          workflowAvailability: {
            story: getWorkflowActionAvailability(
              episode,
              'story',
              entryStage,
              hasSourceNovel
            ),
            story_review: getWorkflowActionAvailability(
              episode,
              'story_review',
              entryStage,
              hasSourceNovel
            ),
            script: getWorkflowActionAvailability(
              episode,
              'script',
              entryStage,
              hasSourceNovel
            ),
            script_review: getWorkflowActionAvailability(
              episode,
              'script_review',
              entryStage,
              hasSourceNovel
            ),
            character: getWorkflowActionAvailability(
              episode,
              'character',
              entryStage,
              hasSourceNovel
            ),
            storyboard_review: getWorkflowActionAvailability(
              episode,
              'storyboard_review',
              entryStage,
              hasSourceNovel
            )
          },
          stageAvailability: {
            director: getStageAvailability(episode, 'director'),
            art: getStageAvailability(episode, 'art'),
            storyboard: getStageAvailability(episode, 'storyboard')
          }
        },
        navigate,
        onWorkflowAction,
        onAutomationAction
      })
    ])
  ) as Record<WorkflowCard['id'], WorkflowCardActionMeta>
  const steps = buildStoryPipelineSteps({
    entryStage,
    episode,
    cards,
    actionMetaMap,
    onOpen: navigate
  })
  const next = pickNextWorkflowCard(cards)!
  const meta = actionMetaMap[next.id]
  const props: Parameters<typeof PipelineCommandCenter>[0] = {
    episodeNum: 1,
    entryStage,
    entryLabel: `从${entryStage === 'novel' ? '小说' : entryStage === 'story' ? '剧情' : '剧本'}开始`,
    workflowMode: `${entryStage}_to_shortdrama`,
    currentStageLabel: '待开始',
    displayState: 'idle',
    displayIsRunning: false,
    isRunning: busy,
    currentEpisode: episode,
    storyPipelineSteps: steps,
    nextStep: {
      label: next.label,
      state: next.state,
      status: '',
      reason: next.note,
      primaryAction: {
        label: meta.primaryLabel,
        action: meta.primaryAction,
        disabled: meta.primaryDisabled
      }
    },
    onStop: vi.fn(),
    onRetry: vi.fn(),
    onOpen: navigate
  }
  return {
    episode,
    cards,
    actionMetaMap,
    steps,
    props,
    navigate,
    onWorkflowAction,
    onAutomationAction
  }
}

function render(props: Parameters<typeof PipelineCommandCenter>[0]) {
  return renderToStaticMarkup(createElement(PipelineCommandCenter, props))
}

describe('制作总控入口与下一步', () => {
  it.each([
    ['novel', ['novel', 'story', 'script'], '从小说到剧本', 3],
    ['story', ['story', 'script'], '从剧情到剧本', 2],
    ['script', ['script'], '从剧本进入制作', 1]
  ] as const)(
    '%s 只显示适用阶段，并提供中文入口说明与进度语义',
    (entry, ids, title, total) => {
      const { props, steps } = scenario(entry)
      expect(steps.map((step) => step.id)).toEqual(ids)
      expect(getCommandProgress(steps).total).toBe(total)
      expect(getEntryPresentation(entry).title).toBe(title)
      const html = render(props)
      expect(html).toContain(title)
      expect(html).toContain('role="progressbar"')
      expect(html).toContain('aria-label="剧本准备进度"')
      expect(html).toContain(` / ${total} 个适用阶段已就绪`)
      expect(html).not.toContain(`${entry}_to_shortdrama`)
      expect(html).not.toContain('>idle<')
      if (entry === 'script') expect(html).not.toContain('录入原文')
    }
  )

  it('人工剧情和剧本入口首先导航到对应编辑页，不触发生成', () => {
    for (const entry of ['story', 'script'] as const) {
      const view = scenario(entry)
      view.steps[0].primaryAction()
      expect(view.navigate).toHaveBeenCalledWith(`/project/p-1/${entry}?ep=1`)
      expect(view.onWorkflowAction).not.toHaveBeenCalled()
      expect(pickNextWorkflowCard(view.cards)?.id).toBe(entry)
    }
  })

  it('文件存在与有效审核分开计数；剧情未有效通过时阻止剧本审核', () => {
    const view = scenario('story', { hasStoryBeat: true, hasScript: true })
    expect(getCommandProgress(view.steps)).toEqual({
      completed: 0,
      total: 2,
      percent: 0
    })
    expect(
      view.steps.every((step) => step.stateLabel.includes('文件已存在'))
    ).toBe(true)
    expect(view.steps[1].primaryDisabled).toBe(true)
    expect(view.steps[1].description).toContain('剧情通过当前有效审核')
    expect(pickNextWorkflowCard(view.cards)?.id).toBe('story_review')
    view.steps[0].primaryAction()
    expect(view.onWorkflowAction).toHaveBeenCalledWith('story_review')
  })

  it('剧本有效审核后主线达到 1/1，下一步进入导演分析', () => {
    const view = scenario('script', { hasScript: true, hasScriptReview: true })
    expect(getCommandProgress(view.steps)).toEqual({
      completed: 1,
      total: 1,
      percent: 100
    })
    expect(view.steps[0].stateLabel).toBe('审核有效')
    const next = pickNextWorkflowCard(view.cards)!
    expect(next.id).toBe('director')
    view.actionMetaMap[next.id].primaryAction()
    expect(view.onAutomationAction).toHaveBeenCalledWith('director', true)
    view.steps[0].primaryAction()
    expect(view.navigate).toHaveBeenCalledWith('/project/p-1/review?ep=1')
  })

  it('后续产物或旧审核路径不冒充当前有效审核，也不让可执行制作抢占补齐路径', () => {
    const view = scenario('script', {
      hasScript: true,
      hasDirectorAnalysis: true,
      scriptReviewPath: '/old/review.md',
      status: 'director'
    })
    expect(getCommandProgress(view.steps).completed).toBe(0)
    expect(
      view.cards.find((card) => card.id === 'script_approved')?.state
    ).toBe('blocked')
    expect(pickNextWorkflowCard(view.cards)?.id).toBe('script_review')
    expect(view.props.nextStep.reason).toContain('旧审核文件不代表当前有效')
  })

  it('执行阶段优先于缺失项，并保持主操作和阶段按钮的忙碌禁用', () => {
    const view = scenario('story', { hasStoryBeat: true }, true)
    const cards = view.cards.map((card) =>
      card.id === 'story_review' ? { ...card, state: 'active' as const } : card
    )
    const steps = buildStoryPipelineSteps({
      entryStage: 'story',
      episode: view.episode,
      cards,
      actionMetaMap: view.actionMetaMap,
      onOpen: view.navigate
    })
    expect(pickNextWorkflowCard(cards)?.id).toBe('story_review')
    expect(steps[0].stateLabel).toBe('执行中')
    expect(steps[0].primaryDisabled).toBe(true)
    const html = render({ ...view.props, storyPipelineSteps: steps })
    expect(html).toMatch(/disabled="" aria-label="单集剧情：审核剧情"/)
    expect(html).toContain('aria-describedby=')
  })

  it('完整制作链将剧本入口的小说、剧情和剧情审核全部标为不适用并隐藏这些动作', () => {
    const view = scenario('script')
    const skipped = view.cards.filter((card) => card.state === 'skipped')
    expect(skipped.map((card) => card.id)).toEqual([
      'novel',
      'story',
      'story_review'
    ])
    const html = renderToStaticMarkup(
      createElement(UnifiedWorkflowChain, {
        cards: skipped,
        actionMetaMap: view.actionMetaMap,
        onOpen: view.navigate
      })
    )
    expect(html).toContain('本入口不适用')
    expect(html).not.toContain('<button')
  })

  it('错误和暂停用中文说明，重试在其他任务执行时禁用', () => {
    const view = scenario('script')
    const error = render({
      ...view.props,
      displayState: 'error',
      isRunning: true
    })
    expect(error).toContain('其他任务执行中')
    expect(error).toContain('disabled="">重试上次流水线任务')
    expect(render({ ...view.props, displayState: 'error' })).toContain(
      '执行失败'
    )
    expect(render({ ...view.props, displayState: 'paused' })).toContain(
      '已暂停'
    )
    expect(getWorkflowModeLabel('legacy_shortdrama')).toBe('经典短剧流程')
    expect(getWorkflowModeLabel('unknown')).toBe('未设置流程模式')
  })
})
