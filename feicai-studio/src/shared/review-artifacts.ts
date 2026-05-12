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
  const resultMatch = raw.match(/-\s*结果：\s*(PASS|FAIL)/)
  const scoreMatch = raw.match(/-\s*评分：\s*(\d+(?:\.\d+)?)\s*\/\s*10/)
  const timeMatch = raw.match(/-\s*时间：\s*(.+)/)
  const feedbackMatch = raw.match(/##\s*综合反馈\s*([\s\S]*?)\n##\s*问题清单/)

  if (!resultMatch || !scoreMatch || !timeMatch || !feedbackMatch) {
    return null
  }

  const result = resultMatch[1] as ReviewResult['result']
  return {
    stage,
    reviewType: 'business',
    result,
    passed: result === 'PASS',
    score: Number(scoreMatch[1]),
    feedback: feedbackMatch[1].trim(),
    issues: parseIssues(raw),
    createdAt: timeMatch[1].trim()
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
