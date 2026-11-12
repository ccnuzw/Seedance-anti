import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath
} from '@shared/path-resolver'
import { formatReviewMarkdown } from '@shared/review-artifacts'
import type { ReviewResult } from '@shared/types'
const mocks = vi.hoisted(() => ({ project: vi.fn(), current: vi.fn() }))
vi.mock('./project-service', () => ({ getProjectByPath: mocks.project }))
vi.mock('../engine/artifact-provenance', () => ({
  isReviewCurrent: mocks.current
}))
import { recoverBatchCommit } from './batch-queue-recovery'
const roots: string[] = []
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'feicai-receipt-')))
  roots.push(root)
  mocks.project.mockReturnValue({ id: 'legacy-project', config: {} })
  const params = {
    projectPath: root,
    projectName: '项目',
    visualStyle: '写实',
    targetMedium: '短剧',
    episodeNum: 1
  }
  return { root, params }
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('atomic artifact receipts', () => {
  it('recovers only an exact operation marker, not any existing output', async () => {
    const { root, params } = fixture()
    const path = resolveEpisodeArtifactPath(root, 'script', 1)
    mkdirSync(join(root, 'script'), { recursive: true })
    writeFileSync(path, '<!-- feicai-operation:committed -->\n# 剧本\n【卡黑】')
    expect(
      await recoverBatchCommit('runScriptGeneration', params, 'other')
    ).toBeNull()
    expect(
      await recoverBatchCommit('runScriptGeneration', params, 'committed')
    ).toMatchObject({ success: true, stage: 'script', outputPath: path })
  })
  it('keeps controlled status repair for a legacy queue receipt without a journal', async () => {
    const { root, params } = fixture()
    mocks.current.mockReturnValue(true)
    const review: ReviewResult = {
      stage: 'director',
      reviewType: 'business',
      result: 'PASS',
      passed: true,
      score: 9,
      feedback: '通过',
      issues: [],
      createdAt: new Date().toISOString()
    }
    const path = resolveProjectArtifactPath(root, 'pipelineState')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(
      path,
      JSON.stringify({
        projectId: 'legacy-project',
        episodes: {
          1: {
            episodeNum: 1,
            status: 'script',
            completedStages: ['director'],
            reviews: [review],
            stageStates: {
              director: {
                stage: 'director',
                operationId: 'legacy-op',
                lastReview: review,
                status: 'passed',
                updatedAt: review.createdAt
              }
            },
            updatedAt: review.createdAt
          }
        },
        updatedAt: review.createdAt
      })
    )
    await expect(
      recoverBatchCommit('director', params, 'legacy-op')
    ).resolves.toMatchObject({ success: true, state: 'director_done' })
    expect(JSON.parse(readFileSync(path, 'utf8')).episodes[1].status).toBe(
      'director'
    )
  })

  it('preserves FAIL reviews as failed receipts instead of treating a marker as approval', async () => {
    const { root, params } = fixture()
    const path = resolveEpisodeArtifactPath(root, 'scriptReview', 1)
    const review: ReviewResult = {
      stage: 'script_review',
      reviewType: 'business',
      result: 'FAIL',
      passed: false,
      score: 4,
      feedback: '需要重写',
      issues: [],
      createdAt: new Date().toISOString()
    }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(
      path,
      formatReviewMarkdown('剧本审核', review) +
        '\n<!-- feicai-operation:review-op -->'
    )
    expect(
      await recoverBatchCommit('runScriptReview', params, 'review-op')
    ).toMatchObject({ success: false, review: { passed: false, score: 4 } })
  })
})
