import type { ReviewIssue, ReviewResult, ReviewStage } from './types'

function parseIssues(raw: string): ReviewIssue[] {
  const blocks = raw.split(/^###\s+问题\s+\d+/gm).slice(1)
  return blocks
    .map((block) => {
      const severityMatch = block.match(/-\s*严重级别：\s*(.+)/)
      const descriptionMatch = block.match(/-\s*描述：\s*(.+)/)
      const locationMatch = block.match(/-\s*位置：\s*(.+)/)
      const suggestionMatch = block.match(/-\s*建议：\s*(.+)/)
      return {
        severity:
          (severityMatch?.[1]?.trim() as ReviewIssue['severity']) || 'minor',
        description: descriptionMatch?.[1]?.trim() || '',
        location: locationMatch?.[1]?.trim(),
        suggestion: suggestionMatch?.[1]?.trim()
      }
    })
    .filter((issue) => issue.description.length > 0)
}

export function parseReviewMarkdown(
  raw: string,
  stage: ReviewStage
): ReviewResult | null {
  const header = raw.split(/^##\s+综合反馈\s*$/m, 1)[0]
  const resultMatches = [
    ...header.matchAll(/^-\s*结果：\s*(PASS|FAIL|INVALID)\s*$/gm)
  ]
  const scoreMatches = [
    ...header.matchAll(/^-\s*评分：\s*(-?\d+(?:\.\d+)?)\s*\/\s*10\s*$/gm)
  ]
  const timeMatch = header.match(/^-\s*时间：\s*(.+)$/m)
  const feedbackMatch = raw.match(
    /^##\s*综合反馈\s*\n([\s\S]*?)\n##\s*问题清单\s*$/m
  )
  if (
    resultMatches.length !== 1 ||
    scoreMatches.length !== 1 ||
    !timeMatch ||
    !feedbackMatch
  )
    return null
  const score = Number(scoreMatches[0][1])
  if (!Number.isFinite(score) || score < 0 || score > 10) return null
  const result = resultMatches[0][1] as ReviewResult['result']
  const artifactHashMatch = header.match(/^-\s*产物哈希：\s*(.+)$/m)
  const inputHashesMatch = header.match(/^-\s*上游哈希：\s*(.+)$/m)
  let artifactHash: string | undefined
  let inputHashes: Record<string, string> | undefined
  if (artifactHashMatch || inputHashesMatch) {
    if (
      !artifactHashMatch ||
      !inputHashesMatch ||
      !/^[a-f0-9]{64}$/.test(artifactHashMatch[1].trim())
    )
      return null
    try {
      const hashes: unknown = JSON.parse(inputHashesMatch[1])
      if (
        !hashes ||
        typeof hashes !== 'object' ||
        Array.isArray(hashes) ||
        Object.values(hashes).some(
          (hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)
        )
      )
        return null
      artifactHash = artifactHashMatch[1].trim()
      inputHashes = hashes as Record<string, string>
    } catch {
      return null
    }
  }
  return {
    stage,
    reviewType: 'business',
    result,
    passed: result === 'PASS',
    score,
    feedback: feedbackMatch[1].trim(),
    issues: parseIssues(raw),
    createdAt: timeMatch[1].trim(),
    ...(artifactHash ? { artifactHash, inputHashes } : {})
  }
}

export function formatReviewMarkdown(
  title: string,
  review: ReviewResult
): string {
  const issues =
    review.issues.length > 0
      ? review.issues
          .map((issue, index) => {
            const lines = [
              `### 问题 ${index + 1}`,
              `- 严重级别：${issue.severity}`,
              `- 描述：${issue.description}`
            ]
            if (issue.location) lines.push(`- 位置：${issue.location}`)
            if (issue.suggestion) lines.push(`- 建议：${issue.suggestion}`)
            return lines.join('\n')
          })
          .join('\n\n')
      : '无'

  return [
    `# ${title}`,
    '',
    `- 结果：${review.result}`,
    `- 评分：${review.score}/10`,
    `- 时间：${review.createdAt}`,
    ...(review.artifactHash && review.inputHashes
      ? [
          `- 产物哈希：${review.artifactHash}`,
          `- 上游哈希：${JSON.stringify(review.inputHashes)}`
        ]
      : []),
    '',
    '## 综合反馈',
    '',
    review.feedback.trim(),
    '',
    '## 问题清单',
    '',
    issues,
    ''
  ].join('\n')
}
