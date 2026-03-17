// ============================================================
// Output Parser — LLM 输出解析器
// ============================================================
//
// 解析 LLM 返回的文本，提取:
//   - 审核结果（PASS/FAIL、评分、问题列表）
//   - 导演分析中的剧情点数和时长
//   - Seedance 提示词的条数和总时长
//

import type { ReviewIssue } from '@shared/types'

export class OutputParser {
  /**
   * 解析审核结果
   * LLM 审核输出通常包含评分和 PASS/FAIL 结论
   */
  static parseReview(response: string, passScore = 7): {
    passed: boolean
    score: number
    issues: ReviewIssue[]
    feedback: string
  } {
    const text = response.trim()

    // 提取评分 — 匹配常见的评分格式
    let score = 7 // 默认锚定分数
    const scorePatterns = [
      /(?:总[分评]|评分|得分|分数)[：:]\s*(\d+(?:\.\d+)?)/,
      /(\d+(?:\.\d+)?)\s*[/／]\s*10/,
      /(?:score|rating)[：:]\s*(\d+(?:\.\d+)?)/i,
      /(\d+(?:\.\d+)?)\s*分/
    ]
    for (const pattern of scorePatterns) {
      const match = text.match(pattern)
      if (match) {
        const parsed = parseFloat(match[1])
        if (parsed >= 1 && parsed <= 10) {
          score = parsed
          break
        }
      }
    }

    // 提取 PASS/FAIL — 匹配常见的结论格式
    // 阈值使用项目级 passScore 参数
    let passed = score >= passScore
    const passPatterns = [
      /(?:结论|结果|verdict|conclusion)[：:]\s*(PASS|通过)/i,
      /(?:✅|☑️)\s*(PASS|通过)/i,
      /\*\*(PASS|通过)\*\*/i
    ]
    const failPatterns = [
      /(?:结论|结果|verdict|conclusion)[：:]\s*(FAIL|不通过|未通过)/i,
      /(?:❌|✖️)\s*(FAIL|不通过|未通过)/i,
      /\*\*(FAIL|不通过|未通过)\*\*/i
    ]
    // 优先检测明确的 PASS 标记
    let hasExplicitPass = false
    let hasExplicitFail = false
    for (const pattern of passPatterns) {
      if (pattern.test(text)) { hasExplicitPass = true; break }
    }
    for (const pattern of failPatterns) {
      if (pattern.test(text)) { hasExplicitFail = true; break }
    }
    // 明确标记优先于分数判定
    if (hasExplicitPass && !hasExplicitFail) {
      passed = true
    } else if (hasExplicitFail && !hasExplicitPass) {
      passed = false
    }
    // 如果没有明确标记，使用分数阈值（score >= 7）

    // 提取问题列表
    const issues = this.extractIssues(text)

    return { passed, score, issues, feedback: text }
  }

  /**
   * 提取问题列表
   */
  private static extractIssues(text: string): ReviewIssue[] {
    const issues: ReviewIssue[] = []

    // 匹配常见的问题格式：
    // - ❌ / ⚠️ / 问题1: ...
    // - **问题N**: ...
    const issuePatterns = [
      /(?:❌|⚠️|🔴|🟡)\s*(.+)/g,
      /(?:问题|issue)\s*\d*[：:]\s*(.+)/gi,
      /\*\*(?:问题|改进建议)\s*\d*\*\*[：:]\s*(.+)/gi
    ]

    for (const pattern of issuePatterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(text)) !== null) {
        const description = match[1].trim()
        if (description.length > 5) { // 过滤太短的噪声
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
    const criticalKeywords = ['严重', '缺失', '遗漏', '错误', '违规', '红线', 'critical']
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
        if (val >= 3 && val <= 15) { // 合理的单条时长范围
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
    const promptRegex = /(?:^|\n)(?:###?\s*)?(?:P|提示词)\s*(\d+)/g
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
