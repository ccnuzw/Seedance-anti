import { describe, expect, it } from 'vitest'
import { buildProductionRows, productionPath } from './project-production-view'
import type {
  Episode,
  Project,
  ProjectPipelineState,
  ProjectEntryStage
} from '@shared/types'

function project(
  entryStage: ProjectEntryStage = 'story',
  id = 'A',
  totalEpisodes = 1
): Project {
  return {
    id,
    name: `项目${id}`,
    projectPath: `/fixtures/${id}`,
    visualStyle: '',
    targetMedium: '',
    totalEpisodes,
    config: {
      entryStage,
      projectName: `项目${id}`,
      totalEpisodes,
      visualStyle: '',
      targetMedium: '',
      createdAt: ''
    },
    createdAt: '',
    updatedAt: ''
  }
}
function episode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: 'A-1',
    projectId: 'A',
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
    ...overrides
  }
}
function build(
  entry: ProjectEntryStage,
  ep = episode(),
  pipeline: ProjectPipelineState | null = null,
  extra = {}
) {
  return buildProductionRows({
    project: project(entry),
    episodes: [ep],
    pipeline,
    hasSource: true,
    ...extra
  })[0]
}

describe('project production view: current service gates', () => {
  it('uses shared inventory for novel, reviewed story for story, skips story for script', () => {
    expect(
      build('novel', episode(), null, { readyEpisodeNumbers: [] }).next?.path
    ).toBe('/project/A/batch?mode=smart_next')
    expect(
      build('novel', episode(), null, { readyEpisodeNumbers: [1] }).next?.stage
    ).toBe('script')
    expect(
      build('novel', episode(), null, { hasSource: false }).next?.path
    ).toBe('/project/A/source')
    expect(
      build('novel', episode(), null, { readyEpisodeNumbers: [2] }).next?.stage
    ).toBe('story')
    expect(build('story').next?.stage).toBe('story')
    expect(build('story', episode({ hasStoryBeat: true })).next?.stage).toBe(
      'story'
    )
    expect(
      build('story', episode({ hasStoryBeat: true, hasStoryReview: true })).next
        ?.stage
    ).toBe('script')
    expect(build('script').cells[0]).toMatchObject({
      applicable: false,
      status: '不适用'
    })
    expect(build('script').next?.stage).toBe('script')
  })

  it('does not offer already used inventory when the script is absent', () => {
    const row = build('novel', episode(), null, {
      readyEpisodeNumbers: [1],
      usedEpisodeNumbers: [1]
    })
    expect(row.next?.stage).toBe('story')
    expect(row.next?.status).toBe('库存已使用，需核对')
    expect(
      build('novel', episode({ hasScript: true }), null, {
        readyEpisodeNumbers: [1],
        usedEpisodeNumbers: [1]
      }).next?.stage
    ).toBe('script')
  })

  it('does not promote physical files or a legacy complete status to a valid PASS', () => {
    const row = build(
      'script',
      episode({
        status: 'complete',
        scriptPath: '/script',
        directorAnalysisPath: '/director',
        artDesignPath: '/art',
        seedancePromptsPath: '/prompts',
        scriptReviewPath: '/review'
      })
    )
    expect(row.complete).toBe(false)
    expect(row.next?.stage).toBe('script')
    expect(row.cells[1].status).toBe('缺少有效 PASS')
    expect(row.cells[2].detail).toContain('产物存在')
    expect(row.cells[2].satisfied).toBe(false)
  })

  it('requires server-validated director and art snapshots before completion', () => {
    const ep = episode({
      hasScript: true,
      hasScriptReview: true,
      hasDirectorAnalysis: true,
      hasArtDesign: true,
      hasSeedancePrompts: true,
      hasStoryboardReview: true
    })
    const state: ProjectPipelineState = {
      projectId: 'A',
      updatedAt: '',
      episodes: {
        1: {
          episodeNum: 1,
          status: 'complete',
          lastStage: 'storyboard_review',
          completedStages: [],
          reviews: [],
          totalDurationSeconds: 0,
          updatedAt: '',
          stageStates: {
            director: {
              stage: 'director',
              status: 'passed',
              attempts: 1,
              updatedAt: ''
            },
            art: { stage: 'art', status: 'passed', attempts: 1, updatedAt: '' }
          }
        }
      }
    }
    expect(build('script', ep).next?.stage).toBe('director')
    expect(build('script', ep, state).complete).toBe(true)
    state.episodes[1].stageStates.director!.status = 'stale'
    expect(build('script', ep, state).next?.status).toBe('需要更新审核')
    state.projectId = 'B'
    expect(build('script', ep, state).complete).toBe(false)
  })

  it('ignores another project and represents missing snapshots as unknown', () => {
    const rows = buildProductionRows({
      project: project('script', 'A', 2),
      episodes: [episode({ projectId: 'B', hasScriptReview: true })],
      pipeline: null,
      hasSource: null
    })
    expect(rows).toHaveLength(2)
    expect(rows[0].cells[1].status).toBe('状态未取得')
    expect(rows[0].complete).toBe(false)
    expect(
      build('novel', episode(), null, { hasSource: null }).next?.status
    ).toBe('原文状态未知')
    expect(
      buildProductionRows({
        project: project('script', 'A', 0),
        episodes: [],
        pipeline: null,
        hasSource: null
      })
    ).toEqual([])
  })

  it('routes existing editors and prompt tabs with explicit episode and project', () => {
    expect(productionPath('A B', 12, 'story')).toBe(
      '/project/A%20B/story?ep=12'
    )
    expect(productionPath('B', 3, 'script')).toBe('/project/B/script?ep=3')
    expect(productionPath('B', 3, 'director')).toBe(
      '/project/B/prompts?ep=3&tab=director'
    )
    expect(productionPath('B', 3, 'art')).toBe(
      '/project/B/prompts?ep=3&tab=art'
    )
    expect(productionPath('B', 3, 'storyboard')).toBe(
      '/project/B/prompts?ep=3&tab=prompts'
    )
  })
})
