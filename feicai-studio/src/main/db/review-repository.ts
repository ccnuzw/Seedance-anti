import { v4 as uuid } from 'uuid'
import { getDatabase } from './database'
import type { ReviewResult } from '@shared/types'

export function saveReview(data: {
  episodeId: string
  stage: string
  reviewType: string
  score: number
  result: string
  feedback: string
  issues: unknown[]
}): void {
  const db = getDatabase()
  const id = uuid()
  db.prepare(
    `
    INSERT INTO reviews (id, episode_id, stage, review_type, score, result, feedback, issues_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    data.episodeId,
    data.stage,
    data.reviewType,
    data.score,
    data.result,
    data.feedback,
    JSON.stringify(data.issues)
  )
}

export function getReviews(episodeId: string): ReviewResult[] {
  const db = getDatabase()
  const rows = db
    .prepare(
      'SELECT * FROM reviews WHERE episode_id = ? ORDER BY created_at DESC'
    )
    .all(episodeId) as Record<string, unknown>[]
  return rows.map((row) => {
    const result = row.result as ReviewResult['result']
    return {
      stage: row.stage as ReviewResult['stage'],
      reviewType: row.review_type as ReviewResult['reviewType'],
      result,
      passed: result === 'PASS',
      score: row.score as number,
      feedback: row.feedback as string,
      issues: row.issues_json ? JSON.parse(row.issues_json as string) : [],
      createdAt: row.created_at as string
    }
  })
}
