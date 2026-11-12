import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const noop = () => () => undefined
  globalThis.window = {
    feicaiAPI: {
      onPipelineTaskChanged: noop(),
      onPipelineStateChanged: noop(),
      onPipelineLog: noop(),
      onPipelineStream: noop(),
      onPipelineReviewResult: noop(),
      onPipelineError: noop()
    }
  } as never
})

import type { PipelineTaskSnapshot } from '@shared/pipeline-task'
import {
  BatchStartButton,
  canStartBatch,
  getBackgroundControlRequest,
  getBackgroundStopRequest,
  getBatchBackgroundView
} from '@renderer/utils/batch-page-state'

const identity = {
  projectId: 'project-1',
  taskId: 'task-1',
  runId: 'run-1',
  episodeNum: 2,
  stage: 'story' as const
}

const task = {
  identity,
  kind: 'workflow' as const,
  status: 'running' as const,
  settings: {}
} as PipelineTaskSnapshot

function startButton(disabled: boolean) {
  return renderToStaticMarkup(
    createElement(BatchStartButton, {
      disabled,
      label: '批量执行 1 集',
      onClick: () => undefined
    })
  )
}

describe('BatchPage 后台准入与身份控制', () => {
  it('无任务且无租约时允许已选集启动，并渲染可点击按钮', () => {
    const view = getBatchBackgroundView(
      { busy: false, phase: 'idle' },
      [],
      'project-1'
    )
    expect(view.state).toBe('ready')
    expect(
      canStartBatch({
        autoMode: false,
        hasWaterline: false,
        waterlineDone: false,
        selectedCount: 1,
        backgroundState: view.state,
        pipelineRunning: false
      })
    ).toBe(true)
    expect(startButton(false)).not.toContain('disabled=""')
  })

  it.each([
    ['pipeline', { ...task, kind: 'pipeline' as const }],
    ['independent workflow', task]
  ] as const)('%s 忙碌时显示 busy 语义并禁用启动按钮', (_label, activeTask) => {
    const view = getBatchBackgroundView(
      { busy: true, phase: 'running', owner: activeTask.kind },
      [activeTask],
      'project-1'
    )
    expect(view.state).toBe('running')
    expect(view.task?.identity).toEqual(identity)
    expect(
      canStartBatch({
        autoMode: false,
        hasWaterline: false,
        waterlineDone: false,
        selectedCount: 1,
        backgroundState: view.state,
        pipelineRunning: false
      })
    ).toBe(false)
    expect(startButton(true)).toContain('disabled=""')
  })

  it('暂停和停止始终保留独立 workflow 的运行身份，不回退到无目标控制', () => {
    expect(getBackgroundControlRequest('running', task)).toEqual({
      action: 'pause',
      target: identity
    })
    expect(getBackgroundControlRequest('paused', task)).toEqual({
      action: 'resume',
      target: identity
    })
    expect(getBackgroundStopRequest(task)).toEqual({
      action: 'abort',
      target: identity
    })
  })

  it('读取失败和停止中均 fail closed，项目切换过滤旧任务', () => {
    expect(
      canStartBatch({
        autoMode: false,
        hasWaterline: false,
        waterlineDone: false,
        selectedCount: 1,
        backgroundState: 'failed',
        pipelineRunning: false
      })
    ).toBe(false)
    expect(
      canStartBatch({
        autoMode: false,
        hasWaterline: false,
        waterlineDone: false,
        selectedCount: 1,
        backgroundState: 'stopping',
        pipelineRunning: false
      })
    ).toBe(false)
    expect(
      getBatchBackgroundView(
        { busy: true, phase: 'running', owner: 'workflow' },
        [task],
        'other-project'
      ).task
    ).toBeNull()
  })
})
