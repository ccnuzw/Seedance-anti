// ============================================================
// Output Parser — LLM 输出解析器
// ============================================================
//
// 解析 LLM 返回的文本，提取:
//   - 审核结果（PASS/FAIL、评分、问题列表）
//   - 导演分析中的剧情点数和时长
//   - Seedance 提示词的条数和总时长
//

import type { ReviewIssue, ReviewResultStatus } from '@shared/types'
import { parseDocument } from 'yaml'

export interface ParsedReview {
  result: ReviewResultStatus
  passed: boolean
  score: number
  issues: ReviewIssue[]
  feedback: string
}

export class OutputParser {
  /**
   * 解析审核结果
   * LLM 审核输出通常包含评分和 PASS/FAIL 结论
   */
  static parseReview(response: string, passScore = 7): ParsedReview {
    const text = response.trim()
    const invalid = (reason: string, score = 0): ParsedReview => ({
      result: 'INVALID',
      passed: false,
      score,
      issues: [
        { severity: 'critical', description: `审核输出无效：${reason}` }
      ],
      feedback: text
    })
    if (!Number.isFinite(passScore) || passScore < 0 || passScore > 10) {
      return invalid('通过阈值必须在 0..10 范围内')
    }

    const fenced = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i)
    const jsonText = fenced ? fenced[1].trim() : text
    if (jsonText.startsWith('{') || jsonText.startsWith('[')) {
      let value: Record<string, unknown>
      try {
        if (parseDocument(jsonText, { uniqueKeys: true }).errors.length > 0) {
          return invalid('JSON 含重复字段或无效结构')
        }
        const parsed: unknown = JSON.parse(jsonText)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return invalid('必须返回审核 JSON 对象')
        }
        value = parsed as Record<string, unknown>
      } catch {
        return invalid('JSON 无法解析')
      }
      if (value.result !== 'PASS' && value.result !== 'FAIL') {
        return invalid('缺少明确的 PASS/FAIL 结论')
      }
      if (
        typeof value.score !== 'number' ||
        !Number.isFinite(value.score) ||
        value.score < 0 ||
        value.score > 10
      ) {
        return invalid('评分必须是 0..10 的有限数值')
      }
      if (typeof value.feedback !== 'string' || !Array.isArray(value.issues)) {
        return invalid('缺少 feedback 或 issues')
      }
      const issues: ReviewIssue[] = []
      for (const issue of value.issues) {
        if (
          !issue ||
          typeof issue !== 'object' ||
          !['critical', 'major', 'minor'].includes(issue.severity) ||
          typeof issue.description !== 'string' ||
          !issue.description.trim() ||
          (issue.location !== undefined &&
            typeof issue.location !== 'string') ||
          (issue.suggestion !== undefined &&
            typeof issue.suggestion !== 'string')
        ) {
          return invalid('问题清单格式不合法', value.score)
        }
        issues.push({
          severity: issue.severity,
          description: issue.description,
          ...(issue.location !== undefined ? { location: issue.location } : {}),
          ...(issue.suggestion !== undefined
            ? { suggestion: issue.suggestion }
            : {})
        })
      }
      const passed = value.result === 'PASS' && value.score >= passScore
      if (
        value.passed !== undefined &&
        value.passed !== (value.result === 'PASS')
      ) {
        return invalid('结论与 passed 相互矛盾', value.score)
      }
      const opposite = value.result === 'PASS' ? 'FAIL' : 'PASS'
      if (
        new RegExp(`\\b${opposite}\\b`, 'i').test(value.feedback) ||
        ['verdict', 'conclusion'].some(
          (key) => value[key] !== undefined && value[key] !== value.result
        )
      ) {
        return invalid('综合意见与最终结论相互矛盾', value.score)
      }
      return {
        result: passed ? 'PASS' : 'FAIL',
        passed,
        score: value.score,
        issues,
        feedback: value.feedback
      }
    }

    // 兼容明确的旧 Markdown；绝不从分数或缺省值推断通过。
    const normalized = text.replace(/\*\*|__/g, '')
    const explicitVerdict =
      /(?:^|\n)\s*(?:[-#>]+\s*)?(?:(?:✅|❌|☑️?|✖️?)\s*)?(?:(?:最终结论|审核结论|结论|结果|业务审核|合规审核|拆解质检|verdict|conclusion)\s*[：:]\s*)?(?:PASS|FAIL|不通过|未通过|通过)(?=\s|[（(。！!]|$)/i
    if (!explicitVerdict.test(normalized)) return invalid('缺少明确的最终结论')
    const verdicts = new Set<string>(
      [...normalized.matchAll(/\b(PASS|FAIL)\b/gi)].map((match) =>
        match[1].toUpperCase()
      )
    )
    for (const match of normalized.matchAll(
      /(?:结论|结果|审核|质检|verdict|conclusion)\s*[：:]\s*(不通过|未通过|通过)/gi
    )) {
      verdicts.add(match[1] === '通过' ? 'PASS' : 'FAIL')
    }
    if (verdicts.size !== 1) return invalid('结论缺失或相互矛盾')
    const scores = [
      ...normalized.matchAll(
        /(?:综合评分|总平均分|剧情点平均分|平均分|总分|总评|评分|得分|分数|score|rating)\s*[：:]\s*(-?\d+(?:\.\d+)?)(?:\s*[/／]\s*(\d+(?:\.\d+)?))?/gi
      )
    ]
    // 没有命名总分时，仅接受唯一的 X/10，而不是任意“X 分”。
    const matches =
      scores.length > 0
        ? scores
        : [
            ...normalized.matchAll(
              /(-?\d+(?:\.\d+)?)\s*[/／]\s*(\d+(?:\.\d+)?)/g
            )
          ]
    const values = new Set(matches.map((match) => Number(match[1])))
    if (
      values.size !== 1 ||
      matches.some((match) => match[2] && Number(match[2]) !== 10)
    ) {
      return invalid('必须包含明确且唯一的 10 分制综合评分')
    }
    const score = Number(matches[0][1])
    if (!Number.isFinite(score) || score < 0 || score > 10) {
      return invalid('评分必须在 0..10 范围内')
    }
    const passed = verdicts.has('PASS') && score >= passScore
    return {
      result: passed ? 'PASS' : 'FAIL',
      passed,
      score,
      issues: this.extractIssues(text),
      feedback: text
    }
  }

  /**
   * 提取问题列表
   */
  private static extractIssues(text: string): ReviewIssue[] {
    const issues: ReviewIssue[] = []
    const seen = new Set<string>()

    // 匹配常见的问题格式：
    // - ❌ / ⚠️ / 问题1: ...
    // - **问题N**: ...
    const issuePatterns = [
      /(?:问题|issue)\s*\d*[：:]\s*(.+)/gi,
      /(?:❌|⚠️|🔴|🟡)\s*(.+)/g,
      /\*\*(?:问题|改进建议)\s*\d*\*\*[：:]\s*(.+)/gi
    ]

    for (const pattern of issuePatterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(text)) !== null) {
        const description = match[1].trim()
        if (description.length > 5 && !seen.has(description)) {
          // 过滤太短的噪声
          seen.add(description)
          const severity = this.classifySeverity(description)
          issues.push({
            severity,
            description,
            suggestion: undefined
          })
        }
      }
    }

    return issues
  }

  /**
   * 根据描述文本推断问题严重程度
   */
  private static classifySeverity(desc: string): ReviewIssue['severity'] {
    const criticalKeywords = [
      '严重',
      '缺失',
      '遗漏',
      '错误',
      '违规',
      '红线',
      'critical'
    ]
    const majorKeywords = ['不足', '偏差', '不一致', '问题', 'major']

    const lower = desc.toLowerCase()
    for (const kw of criticalKeywords) {
      if (lower.includes(kw)) return 'critical'
    }
    for (const kw of majorKeywords) {
      if (lower.includes(kw)) return 'major'
    }
    return 'minor'
  }

  /**
   * 从导演分析输出中提取剧情点数量和总时长
   */
  static parseDirectorAnalysis(text: string): {
    plotPoints: number
    totalDuration: number
  } {
    let plotPoints = 0
    let totalDuration = 0

    // 计数剧情点 (P01, P02, ...)
    const plotPointRegex = /(?:P|剧情点)\s*(\d+)/gi
    let match: RegExpExecArray | null
    const plotNumbers = new Set<number>()
    while ((match = plotPointRegex.exec(text)) !== null) {
      plotNumbers.add(parseInt(match[1]))
    }
    plotPoints = plotNumbers.size

    // 提取总时长
    const durationPatterns = [
      /总(?:时长|计)[：:]\s*(\d+)\s*[秒s]/,
      /合计[：:]\s*(\d+)\s*[秒s]/,
      /(\d+)\s*秒.*?[（(]总/
    ]
    for (const pattern of durationPatterns) {
      const dMatch = text.match(pattern)
      if (dMatch) {
        totalDuration = parseInt(dMatch[1])
        break
      }
    }

    // 如果总时长未找到，累加各点时长
    if (totalDuration === 0) {
      const perPointDuration = /(\d+)\s*[秒s]/g
      while ((match = perPointDuration.exec(text)) !== null) {
        const val = parseInt(match[1])
        if (val >= 3 && val <= 15) {
          // 合理的单条时长范围
          totalDuration += val
        }
      }
    }

    return { plotPoints, totalDuration }
  }

  /**
   * 从 Seedance 提示词输出中提取条数和总时长
   */
  static parseSeedancePrompts(text: string): {
    promptCount: number
    totalDuration: number
  } {
    let promptCount = 0
    let totalDuration = 0

    // 计数提示词 (P01/P02 或 ### 分隔的段落)
    const promptRegex = /(?:^|\n)\s*(?:###?\s*)?(?:P|提示词)\s*(\d+)/gim
    const promptNumbers = new Set<number>()
    let match: RegExpExecArray | null
    while ((match = promptRegex.exec(text)) !== null) {
      promptNumbers.add(parseInt(match[1]))
    }
    promptCount = promptNumbers.size

    // 累加时长
    const durationRegex = /(?:时长|duration)[：:]\s*(\d+)\s*[秒s]/gi
    while ((match = durationRegex.exec(text)) !== null) {
      totalDuration += parseInt(match[1])
    }

    return { promptCount, totalDuration }
  }
}
