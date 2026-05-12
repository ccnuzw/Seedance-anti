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
import { SkillLoader } from './skill-loader'
import { PromptAssembler } from './prompt-assembler'
import { OutputParser } from './output-parser'
import { REVIEW_SKILL_MAP, ANTIBIAS_PROMPT } from '@shared/constants'
import type {
  AutomatedPipelineStage,
  ReviewResult,
  ReviewIssue,
  ReviewStage,
  ProjectConfig
} from '@shared/types'
import type { ILLMProvider } from '../llm/types'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath
} from '@shared/path-resolver'
import { parsePlotBreakdownMarkdown } from '@shared/plot-breakdown'
import { formatPlotBreakdownEntriesMarkdown } from '@shared/plot-breakdown'
import { getPlotBreakdownEntriesForEpisode } from '@shared/plot-breakdown'

interface ReviewContext {
  projectPath: string
  episodeNum: number
  scriptPath?: string
  projectConfig?: Partial<ProjectConfig> | null
}

interface ReviewContentParams {
  stage: ReviewStage
  reviewSkillName: string
  outputToReview: string
  originalScript?: string
  directorAnalysis?: string
  plotBreakdown?: string
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
  async review(
    stage: AutomatedPipelineStage,
    ctx: ReviewContext
  ): Promise<ReviewResult> {
    if (!this.llmProvider) throw new Error('LLM Provider 未设置')

    // ===== 第一层：断点清洗 =====
    // 从文件系统重新读取产出，不依赖上下文缓存
    const freshOutput = await this.readFreshOutput(stage, ctx)
    const freshScript = ctx.scriptPath
      ? await readFile(ctx.scriptPath, 'utf-8')
      : undefined

    // 读取导演分析（art 和 storyboard 审核时作为对照）
    let directorAnalysis: string | undefined
    if (stage === 'art' || stage === 'storyboard') {
      const analysisPath = resolveEpisodeArtifactPath(
        ctx.projectPath,
        'directorAnalysis',
        ctx.episodeNum,
        ctx.projectConfig
      )
      try {
        directorAnalysis = await readFile(analysisPath, 'utf-8')
      } catch {
        /* */
      }
    }

    // ===== Step 1: 业务审核 =====
    return this.reviewContent({
      stage: stage === 'storyboard' ? 'storyboard_review' : stage,
      reviewSkillName: REVIEW_SKILL_MAP[stage],
      outputToReview: freshOutput,
      originalScript: freshScript,
      directorAnalysis,
      plotBreakdown:
        stage === 'director' || stage === 'storyboard'
          ? undefined
          : await this.readPlotBreakdownForReview(ctx)
    })
  }

  /**
   * 对任意内容执行两步审核
   */
  async reviewContent(params: ReviewContentParams): Promise<ReviewResult> {
    if (!this.llmProvider) throw new Error('LLM Provider 未设置')

    const businessResult = await this.executeBusinessReview(
      params.reviewSkillName,
      params.outputToReview,
      params.originalScript,
      params.directorAnalysis,
      params.plotBreakdown
    )

    const complianceResult = await this.executeComplianceReview(
      params.outputToReview
    )

    const allIssues = [...businessResult.issues, ...complianceResult.issues]

    const passed = businessResult.passed && complianceResult.passed
    const score = businessResult.score

    return {
      stage: params.stage,
      reviewType: 'business',
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
    reviewSkillName: string,
    output: string,
    script?: string,
    directorAnalysis?: string,
    plotBreakdown?: string
  ): Promise<{
    passed: boolean
    score: number
    issues: ReviewIssue[]
    feedback: string
  }> {
    // 加载审核 Skill
    const reviewSkill = await this.skillLoader.load(reviewSkillName)

    // ===== 第二层 + 第三层：对抗性立场 + 评分锚定 =====
    const prompt = this.promptAssembler.assembleReview(
      reviewSkill,
      ANTIBIAS_PROMPT,
      output,
      script,
      directorAnalysis,
      plotBreakdown
    )

    const response = await this.llmProvider!.generate(prompt)
    return OutputParser.parseReview(response, this.passScore)
  }

  /**
   * 合规审核
   */
  private async executeComplianceReview(output: string): Promise<{
    passed: boolean
    score: number
    issues: ReviewIssue[]
    feedback: string
  }> {
    const complianceSkill = await this.skillLoader.load(
      'compliance-review-skill'
    )

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
  private async readFreshOutput(
    stage: AutomatedPipelineStage,
    ctx: ReviewContext
  ): Promise<string> {
    if (stage === 'art') {
      // 服化道的产出在临时文件
      return readFile(
        resolveEpisodeArtifactPath(
          ctx.projectPath,
          'artDesign',
          ctx.episodeNum,
          ctx.projectConfig
        ),
        'utf-8'
      )
    }

    if (stage === 'director') {
      return readFile(
        resolveEpisodeArtifactPath(
          ctx.projectPath,
          'directorAnalysis',
          ctx.episodeNum,
          ctx.projectConfig
        ),
        'utf-8'
      )
    }
    if (stage === 'storyboard') {
      return readFile(
        resolveEpisodeArtifactPath(
          ctx.projectPath,
          'seedancePrompts',
          ctx.episodeNum,
          ctx.projectConfig
        ),
        'utf-8'
      )
    }
    throw new Error(`未知阶段: ${stage}`)
  }

  private async readPlotBreakdownForReview(
    ctx: ReviewContext
  ): Promise<string | undefined> {
    const filePath = resolveProjectArtifactPath(
      ctx.projectPath,
      'plotBreakdown',
      ctx.projectConfig
    )
    try {
      const raw = await readFile(filePath, 'utf-8')
      const entries = getPlotBreakdownEntriesForEpisode(
        parsePlotBreakdownMarkdown(raw),
        ctx.episodeNum
      )
      return formatPlotBreakdownEntriesMarkdown(entries)
    } catch {
      return undefined
    }
  }

  /**
   * 格式化综合反馈
   */
  private formatFeedback(
    business: { passed: boolean; score: number; feedback: string },
    compliance: { passed: boolean; feedback: string }
  ): string {
    const lines: string[] = []
    lines.push(
      `## 业务审核: ${business.passed ? '✅ PASS' : '❌ FAIL'} (${business.score}分)`
    )
    lines.push(business.feedback)
    lines.push('')
    lines.push(`## 合规审核: ${compliance.passed ? '✅ PASS' : '❌ FAIL'}`)
    lines.push(compliance.feedback)
    return lines.join('\n')
  }
}
