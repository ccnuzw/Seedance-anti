// ============================================================
// Review Engine — 审核引擎（三层防偏 + 两步审核）
// ============================================================
//
// 实现 FEICAI 的审核机制:
//   第一层: 断点清洗 — 从文件系统重新读取产出
//   第二层: 对抗性立场 — 注入"假设存在问题"的审核 prompt
//   第三层: 评分锚定 — 起点 7 分，只有逐项验证后才上调
//
//   两步审核:
//     Step 1: 业务审核（叙事/造型/分镜 专项）
//     Step 2: 合规审核（平台内容红线）
//

import { readFile } from 'fs/promises'
import { join } from 'path'
import { SkillLoader } from './skill-loader'
import { PromptAssembler } from './prompt-assembler'
import { OutputParser } from './output-parser'
import { REVIEW_SKILL_MAP, ANTIBIAS_PROMPT, STAGE_OUTPUT_FILES } from '@shared/constants'
import type { PipelineStage, ReviewResult, ReviewIssue } from '@shared/types'
import type { ILLMProvider } from '../llm/types'

interface ReviewContext {
  projectPath: string
  episodeNum: number
  scriptPath?: string
}

export class ReviewEngine {
  private skillLoader: SkillLoader
  private promptAssembler: PromptAssembler
  private llmProvider: ILLMProvider | null = null
  private passScore = 7

  constructor(skillLoader: SkillLoader, promptAssembler: PromptAssembler) {
    this.skillLoader = skillLoader
    this.promptAssembler = promptAssembler
  }

  setProvider(provider: ILLMProvider): void {
    this.llmProvider = provider
  }

  setPassScore(score: number): void {
    this.passScore = score
  }

  /**
   * 执行完整的两步审核
   */
  async review(stage: PipelineStage, ctx: ReviewContext): Promise<ReviewResult> {
    if (!this.llmProvider) throw new Error('LLM Provider 未设置')

    // ===== 第一层：断点清洗 =====
    // 从文件系统重新读取产出，不依赖上下文缓存
    const freshOutput = await this.readFreshOutput(stage, ctx)
    const freshScript = ctx.scriptPath ? await readFile(ctx.scriptPath, 'utf-8') : undefined

    // 读取导演分析（art 和 storyboard 审核时作为对照）
    let directorAnalysis: string | undefined
    if (stage === 'art' || stage === 'storyboard') {
      const epStr = String(ctx.episodeNum).padStart(3, '0')
      const analysisPath = join(ctx.projectPath, 'outputs', `ep${epStr}`, '01-director-analysis.md')
      try { directorAnalysis = await readFile(analysisPath, 'utf-8') } catch { /* */ }
    }

    // ===== Step 1: 业务审核 =====
    const businessResult = await this.executeBusinessReview(
      stage, freshOutput, freshScript, directorAnalysis
    )

    // ===== Step 2: 合规审核 =====
    const complianceResult = await this.executeComplianceReview(freshOutput)

    // ===== 汇总 =====
    const allIssues = [
      ...businessResult.issues,
      ...complianceResult.issues
    ]

    const passed = businessResult.passed && complianceResult.passed
    const score = businessResult.score // 业务审核的评分为主

    return {
      stage,
      reviewType: 'business', // 综合审核
      result: passed ? 'PASS' : 'FAIL',
      passed,
      score,
      feedback: this.formatFeedback(businessResult, complianceResult),
      issues: allIssues,
      createdAt: new Date().toISOString()
    }
  }

  /**
   * 业务审核
   */
  private async executeBusinessReview(
    stage: PipelineStage,
    output: string,
    script?: string,
    directorAnalysis?: string
  ): Promise<{ passed: boolean; score: number; issues: ReviewIssue[]; feedback: string }> {
    // 加载审核 Skill
    const reviewSkillName = REVIEW_SKILL_MAP[stage]
    const reviewSkill = await this.skillLoader.load(reviewSkillName)

    // ===== 第二层 + 第三层：对抗性立场 + 评分锚定 =====
    const prompt = this.promptAssembler.assembleReview(
      reviewSkill,
      ANTIBIAS_PROMPT,
      output,
      script,
      directorAnalysis
    )

    const response = await this.llmProvider!.generate(prompt)
    return OutputParser.parseReview(response, this.passScore)
  }

  /**
   * 合规审核
   */
  private async executeComplianceReview(
    output: string
  ): Promise<{ passed: boolean; score: number; issues: ReviewIssue[]; feedback: string }> {
    const complianceSkill = await this.skillLoader.load('compliance-review-skill')

    const prompt = this.promptAssembler.assembleReview(
      complianceSkill,
      '你是合规审核员，严格检查以下内容是否触碰 Seedance 2.0 和 Gemini 的平台内容红线。',
      output
    )

    const response = await this.llmProvider!.generate(prompt)
    return OutputParser.parseReview(response, this.passScore)
  }

  /**
   * 从文件系统重新读取产出（断点清洗）
   */
  private async readFreshOutput(stage: PipelineStage, ctx: ReviewContext): Promise<string> {
    const epStr = String(ctx.episodeNum).padStart(3, '0')
    const outputDir = join(ctx.projectPath, 'outputs', `ep${epStr}`)

    if (stage === 'art') {
      // 服化道的产出在临时文件
      return readFile(join(outputDir, '01.5-art-design-output.md'), 'utf-8')
    }

    const fileName = STAGE_OUTPUT_FILES[stage]
    if (!fileName) throw new Error(`未知阶段: ${stage}`)
    return readFile(join(outputDir, fileName), 'utf-8')
  }

  /**
   * 格式化综合反馈
   */
  private formatFeedback(
    business: { passed: boolean; score: number; feedback: string },
    compliance: { passed: boolean; feedback: string }
  ): string {
    const lines: string[] = []
    lines.push(`## 业务审核: ${business.passed ? '✅ PASS' : '❌ FAIL'} (${business.score}分)`)
    lines.push(business.feedback)
    lines.push('')
    lines.push(`## 合规审核: ${compliance.passed ? '✅ PASS' : '❌ FAIL'}`)
    lines.push(compliance.feedback)
    return lines.join('\n')
  }
}
