import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  project: vi.fn(),
  current: vi.fn(),
  regular: vi.fn()
}))
vi.mock('../io/atomic-file', () => ({
  readJsonWithRecovery: mocks.read,
  readRegularFile: mocks.regular
}))
vi.mock('./project-service', () => ({ getProjectByPath: mocks.project }))
vi.mock('../engine/artifact-provenance', () => ({
  isReviewCurrent: mocks.current
}))
vi.mock('../security/access-control', () => ({
  assertPathWithinProject: (_root: string, path: string) => path,
  isMissingFileError: (error: unknown) =>
    error instanceof Error && error.message === 'ENOENT'
}))
import { getProjectPipelineState } from './project-state-service'

describe('project state recovery boundary', () => {
  beforeEach(() => vi.clearAllMocks())
  it('reads the configured state through backup recovery', async () => {
    mocks.project.mockReturnValue({
      config: { directories: { outputsDir: 'custom-outputs' } }
    })
    const state = { projectId: 'p', episodes: {}, updatedAt: 'now' }
    mocks.read.mockResolvedValue(state)
    expect(await getProjectPipelineState('/tmp/project')).toEqual(state)
    expect(mocks.read).toHaveBeenCalledWith(
      '/tmp/project/custom-outputs/pipeline-state.json',
      { readOnly: true }
    )
  })
  it('returns null only when no saved state exists', async () => {
    mocks.project.mockReturnValue(undefined)
    mocks.read.mockResolvedValue(null)
    expect(await getProjectPipelineState('/tmp/project')).toBeNull()
  })
  it('surfaces unrecoverable corruption instead of presenting an empty project', async () => {
    mocks.read.mockRejectedValue(new Error('主文件和备份均损坏'))
    await expect(getProjectPipelineState('/tmp/project')).rejects.toThrow(
      '均损坏'
    )
  })
})

describe('stale approval projection for project overview', () => {
  it('marks obsolete approvals stale and removes downstream completion without deleting review history', async () => {
    const review = {
      stage: 'director',
      reviewType: 'business',
      passed: true,
      result: 'PASS',
      score: 8,
      feedback: '通过',
      issues: [],
      createdAt: 'now'
    }
    mocks.project.mockReturnValue({ id: 'current', config: {} })
    mocks.regular.mockRejectedValue(new Error('ENOENT'))
    mocks.current.mockReturnValue(false)
    mocks.read.mockResolvedValue({
      projectId: 'old',
      updatedAt: 'now',
      episodes: {
        1: {
          episodeNum: 1,
          status: 'complete',
          lastStage: 'storyboard',
          completedStages: ['director', 'art', 'storyboard'],
          stageStates: {
            director: {
              stage: 'director',
              status: 'passed',
              attempts: 1,
              updatedAt: 'now',
              lastReview: review
            },
            art: {
              stage: 'art',
              status: 'passed',
              attempts: 1,
              updatedAt: 'now'
            }
          },
          reviews: [review],
          totalDurationSeconds: 0,
          updatedAt: 'now'
        }
      }
    })
    const result = await getProjectPipelineState('/tmp/project')
    expect(result?.projectId).toBe('current')
    expect(result?.episodes[1]?.completedStages).toEqual([])
    expect(result?.episodes[1]?.stageStates.director?.status).toBe('stale')
    expect(result?.episodes[1]?.stageStates.art?.status).toBe('stale')
    expect(result?.episodes[1]?.status).toBe('idle')
    expect(result?.episodes[1]?.reviews).toHaveLength(1)
  })
})
