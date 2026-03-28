// ============================================================
// Feicai Adapt Orchestrator — 编剧管线 Orchestrator
// ============================================================
//
// 职责：
// - 针对单个拆解批次 / 单个剧本批次，编排：初稿生成 → 自检 →（可选）自修
// - 对外只暴露：finalText + review + revisionCount + status
// - 不负责文件 IO、项目级状态、水位，这些仍由 AdaptStateMachine 处理
//
import type {
  AdaptStage,
  AssembledPrompt,
  ReviewResult,
  VolumePlan,
  PlotPoint,
} from '@shared/types'
import { AdaptPromptAssembler } from './adapt-prompt-assembler'
import type { SkillLoader } from './skill-loader'
import { ADAPT_SKILL_MAP, ADAPT_BREAKDOWN_ANTIBIAS, ADAPT_SCRIPT_ANTIBIAS, ADAPT_ROLE_DECLARATIONS } from '@shared/constants'

// -------------------- 类型定义 --------------------

export type OrchestratorStatus =
  | 'ok'               // 自检整体通过，可直接进入下一步
  | 'needs_attention'  // 存在 FAIL / 低分，但仍有可用价值，建议人工复核
  | 'failed'           // 明显不可用（结构崩坏/输出缺失等），需要人工介入或重新执行

export interface OrchestratorReview {
  rawText: string
  parsed: ReviewResult | null
}

export interface OrchestratorResult {
  finalText: string
  review?: OrchestratorReview
  revisionCount: number
  status: OrchestratorStatus
  note?: string
}

export interface BreakdownBatchContext {
  stage: 'breakdown'

  projectId: string
  projectPath: string

  novelTitle: string
  novelGenre: string
  totalChapters: number

  startChapter: number
  chaptersPerBatch: number
  currentBatch: number
  activeVolume?: VolumePlan | null

  novelChapters: Array<{ chapter: number; content: string }>
  existingPlotBreakdown?: string

  lastReviewFeedback?: string
  userNotes?: string
  /** 本批允许自动修正+重检的最大轮数（0 表示不启用自动修正） */
  autoRepairRounds?: number
}

export interface ScriptBatchContext {
  stage: 'script'

  projectId: string
  projectPath: string

  novelTitle: string
  novelGenre: string
  totalChapters: number
  chaptersPerBatch: number

  currentScriptBatch: number

  targetEpisodes: number[]
  targetPlots: PlotPoint[]

  breakdownContent: string
  previousScript?: string
  novelChapters: Array<{ chapter: number; content: string }>

  activeVolume?: VolumePlan | null
  lastReviewFeedback?: string
  userNotes?: string
  /** 本批允许自动修正+重检的最大轮数（0 表示不启用自动修正） */
  autoRepairRounds?: number
}

export type ReviewParser = (stage: AdaptStage, output: string) => ReviewResult

export type CallLLMFn = (
  stage: AdaptStage,
  prompt: AssembledPrompt
) => Promise<string | null>

export interface FeicaiAdaptOrchestratorDeps {
  promptAssembler: AdaptPromptAssembler
  skillLoader: SkillLoader
  callLLM: CallLLMFn
  parseReviewResult: ReviewParser
}

// -------------------- Orchestrator 实现 --------------------

export class FeicaiAdaptOrchestrator {
  private readonly promptAssembler: AdaptPromptAssembler
  private readonly skillLoader: SkillLoader
  private readonly callLLM: CallLLMFn
  private readonly parseReviewResult: ReviewParser

  constructor(deps: FeicaiAdaptOrchestratorDeps) {
    this.promptAssembler = deps.promptAssembler
    this.skillLoader = deps.skillLoader
    this.callLLM = deps.callLLM
    this.parseReviewResult = deps.parseReviewResult
  }

  /**
   * 对现有拆解输出进行单次 8 维度质检（不重算拆解）
   * 调用方负责根据结果决定是否触发重拆解。
   */
  async reviewBreakdownOnly(params: {
    breakdownOutput: string
    novelChaptersText: string
    adaptMethodContent: string
    plotBreakdown?: string
  }): Promise<OrchestratorReview> {
    let globalPlan = ''
    if (params.plotBreakdown) {
      const planMatch = params.plotBreakdown.match(/(?:##\s*改编规划|##\s*改编方向|##\s*改编策略|##\s*Adaptation Plan)[\s\S]*?(?=\n##\s*第|\n#\s*第|\n---\n|$)/i)
      if (planMatch) globalPlan = planMatch[0].trim()
    }

    const reviewPrompt = this.promptAssembler.assembleBreakdownReview(
      ADAPT_BREAKDOWN_ANTIBIAS,
      params.breakdownOutput,
      params.novelChaptersText,
      params.adaptMethodContent,
      globalPlan
    )

    const reviewOutput = await this.callLLM('breakdown', reviewPrompt)

    if (!reviewOutput) {
      return {
        rawText: '',
        parsed: null,
      }
    }

    const parsed = this.parseReviewResult('breakdown', reviewOutput)
    return {
      rawText: reviewOutput,
      parsed,
    }
  }

  /**
   * 对现有剧本输出进行单次 11 维度质检（不重算剧本）
   * 调用方负责根据结果决定是否触发重写/修订。
   */
  async reviewScriptOnly(params: {
    scriptOutput: string
    plotBreakdown: string
    novelChaptersText: string
    adaptMethodContent?: string
    previousScript?: string
    targetEpisodes?: number[]
  }): Promise<OrchestratorReview> {
    let globalPlan = ''
    if (params.plotBreakdown) {
      const planMatch = params.plotBreakdown.match(/(?:##\s*改编规划|##\s*改编方向|##\s*改编策略|##\s*Adaptation Plan)[\s\S]*?(?=\n##\s*第|\n#\s*第|\n---\n|$)/i)
      if (planMatch) globalPlan = planMatch[0].trim()
    }

    const reviewPrompt = this.promptAssembler.assembleScriptReview(
      ADAPT_SCRIPT_ANTIBIAS,
      params.scriptOutput,
      params.plotBreakdown,
      params.novelChaptersText,
      params.adaptMethodContent,
      params.previousScript,
      params.targetEpisodes,
      globalPlan
    )

    const reviewOutput = await this.callLLM('script', reviewPrompt)

    if (!reviewOutput) {
      return {
        rawText: '',
        parsed: null,
      }
    }

    const parsed = this.parseReviewResult('script', reviewOutput)
    return {
      rawText: reviewOutput,
      parsed,
    }
  }

  /**
   * 执行一个拆解批次：初稿 → 质检 →（可选）自修
   * Phase 2：先实现“单轮生成+质检”，暂不做多轮自修
   */
  async runBreakdownBatch(ctx: BreakdownBatchContext): Promise<OrchestratorResult> {
    // 1. 加载技能
    const skill = await this.skillLoader.load(ADAPT_SKILL_MAP.breakdown)

    // 2. 预构造章节原文与方法论
    const chaptersText = ctx.novelChapters
      .map(ch => `## 第${ch.chapter}章\n\n${ch.content}`)
      .join('\n\n---\n\n')

    const adaptMethod = skill.methodology || ''
    const maxRepairs = ctx.autoRepairRounds ?? 0

    let attempt = 0
    let finalOutput = ''
    let review: OrchestratorReview | undefined
    let status: OrchestratorStatus = 'ok'
    let reviewFeedback = ctx.lastReviewFeedback
    const cumulativeErrors: string[] = [] // [BUG 修复] 记忆报错累加器

    while (true) {
      // 3. 组装拆解 Prompt（首轮或修正轮）
      const prompt = this.promptAssembler.assembleBreakdown(
        skill,
        ADAPT_ROLE_DECLARATIONS.breakdown,
        {
          novelChapters: ctx.novelChapters,
          plotBreakdown: ctx.existingPlotBreakdown,
        },
        {
          novelTitle: ctx.novelTitle,
          novelGenre: ctx.novelGenre,
          totalChapters: ctx.totalChapters,
          processedChapters: ctx.startChapter - 1,
          currentBatch: ctx.currentBatch,
        },
        reviewFeedback,
        ctx.activeVolume,
        ctx.userNotes,
      )

      const output = await this.callLLM('breakdown', prompt)
      attempt += 1

      if (!output) {
        return {
          finalText: '',
          revisionCount: attempt - 1,
          status: 'failed',
          note: 'LLM 输出为空，无法完成拆解',
        }
      }

      finalOutput = output

      // 4. 质检
      let globalPlan = ''
      if (ctx.existingPlotBreakdown) {
        const planMatch = ctx.existingPlotBreakdown.match(/(?:##\s*改编规划|##\s*改编方向|##\s*改编策略|##\s*Adaptation Plan)[\s\S]*?(?=\n##\s*第|\n#\s*第|\n---\n|$)/i)
        if (planMatch) globalPlan = planMatch[0].trim()
      }

      const reviewPrompt = this.promptAssembler.assembleBreakdownReview(
        ADAPT_BREAKDOWN_ANTIBIAS,
        finalOutput,
        chaptersText,
        adaptMethod,
        globalPlan
      )

      const reviewOutput = await this.callLLM('breakdown', reviewPrompt)

      if (!reviewOutput) {
        status = 'needs_attention'
        review = undefined
        break
      }

      const parsed = this.parseReviewResult('breakdown', reviewOutput)
      review = { rawText: reviewOutput, parsed }
      status = parsed.passed ? 'ok' : 'needs_attention'

      // 强结构化校验
      const hasPlots = /【剧情\s*\d+\s*】/.test(finalOutput)
      if (!hasPlots) {
        status = 'failed'
        parsed.passed = false
        parsed.feedback = (parsed.feedback || '') + '\n[系统校验] 致命错误：未检测到规范的【剧情X】格式，这可能是因为您忘记了输出拆解结果或格式完全错误。请务必严格按规范输出。'
      }

      if (parsed.passed) {
        break
      }

      // 未通过且已经用尽自动修正次数 → 退出，交由上层处理
      if (attempt > maxRepairs) {
        break
      }

      // [BUG 修复] 为下一轮修正准备带有“底本对比”与“累计报错字典”的反馈
      cumulativeErrors.push(`【第${attempt}次尝试报错总结】:\n${parsed.feedback}`)
      reviewFeedback = `⚠️ **强制修改指令（系统质检未通过）**\n\n请务必吸取以下所有历史教训，并直接基于你刚才写错的原稿进行对症下药的修改：\n\n` + 
                       cumulativeErrors.join('\n\n') + 
                       `\n\n👇 **这中间是你在上一轮次盲写出的【原版错稿记录】（请直接对照修改此处并输出一份全新的、完整的正确稿件！）**：\n---\n${finalOutput}\n---`
    }

    return {
      finalText: finalOutput,
      review,
      revisionCount: attempt,
      status,
      note:
        status === 'needs_attention' && maxRepairs > 0 && review && (!review.parsed || !review.parsed.passed)
          ? `已自动修正 ${Math.min(attempt - 1, maxRepairs)} 轮，但仍未通过质检`
          : undefined,
    }
  }

  /**
   * 执行一批剧本创作：初稿 → 质检 →（可选）自修
   * Phase 2：先实现“单轮生成+质检”，暂不做多轮自修
   */
  async runScriptBatch(ctx: ScriptBatchContext): Promise<OrchestratorResult> {
    const skill = await this.skillLoader.load(ADAPT_SKILL_MAP.script)

    // 1. 构造剧情点与章节原文文本
    const plotPointsText = ctx.targetPlots
      .map(p => `【剧情${p.id}】${p.scene}，${p.description}，${p.hookType}，第${p.episode}集，状态：未用`)
      .join('\n')

    const chaptersText = ctx.novelChapters
      .map(ch => `## 第${ch.chapter}章\n\n${ch.content}`)
      .join('\n\n---\n\n')

    const adaptMethod = skill.methodology || ''
    const maxRepairs = ctx.autoRepairRounds ?? 0

    let attempt = 0
    let finalText = ''
    let review: OrchestratorReview | undefined
    let status: OrchestratorStatus = 'ok'
    let reviewFeedback = ctx.lastReviewFeedback
    const cumulativeErrors: string[] = [] // [BUG 修复] 记忆报错累加器

    while (true) {
      // 2. 组装剧本 Prompt（首轮或修正轮）
      const prompt = this.promptAssembler.assembleScript(
        skill,
        ADAPT_ROLE_DECLARATIONS.script,
        {
          plotBreakdown: ctx.breakdownContent,
          previousScript: ctx.previousScript,
          plotPointsForBatch: plotPointsText,
          novelChapters: ctx.novelChapters,
        },
        {
          novelTitle: ctx.novelTitle,
          novelGenre: ctx.novelGenre,
          totalChapters: ctx.totalChapters,
          processedChapters: 0, // 剧本阶段这里暂不依赖
          currentBatch: ctx.currentScriptBatch,
        },
        ctx.targetEpisodes,
        reviewFeedback,
        ctx.activeVolume,
        ctx.userNotes,
      )

      const output = await this.callLLM('script', prompt)
      attempt += 1

      if (!output) {
        return {
          finalText: '',
          revisionCount: attempt - 1,
          status: 'failed',
          note: 'LLM 输出为空，无法完成剧本创作',
        }
      }

      finalText = output

      // 3. 质检
      let globalPlan = ''
      if (ctx.breakdownContent) {
        const planMatch = ctx.breakdownContent.match(/(?:##\s*改编规划|##\s*改编方向|##\s*改编策略|##\s*Adaptation Plan)[\s\S]*?(?=\n##\s*第|\n#\s*第|\n---\n|$)/i)
        if (planMatch) globalPlan = planMatch[0].trim()
      }

      const reviewPrompt = this.promptAssembler.assembleScriptReview(
        ADAPT_SCRIPT_ANTIBIAS,
        finalText,
        ctx.breakdownContent,
        chaptersText,
        adaptMethod,
        ctx.previousScript,
        ctx.targetEpisodes,
        globalPlan
      )

      const reviewOutput = await this.callLLM('script', reviewPrompt)

      if (!reviewOutput) {
        status = 'needs_attention'
        review = undefined
        break
      }

      const parsed = this.parseReviewResult('script', reviewOutput)
      review = { rawText: reviewOutput, parsed }
      status = parsed.passed ? 'ok' : 'needs_attention'

      if (parsed.passed) {
        break
      }

      if (attempt > maxRepairs) {
        break
      }

      // [BUG 修复] 为下一轮修正准备带有“底本对比”与“累计报错字典”的反馈
      cumulativeErrors.push(`【第${attempt}次尝试报错总结】:\n${parsed.feedback}`)
      reviewFeedback = `⚠️ **强制修改指令（系统质检未通过）**\n\n请务必吸取以下所有历史教训，并直接基于你刚才写错的原稿进行对症下药的修改：\n\n` +
                       cumulativeErrors.join('\n\n') +
                       `\n\n👇 **这中间是你在上一轮次盲写出的【原版错稿记录】（请直接对照修改此处并输出一份全新的、完整的正确剧本！）**：\n---\n${finalText}\n---`
    }

    return {
      finalText,
      review,
      revisionCount: attempt,
      status,
      note:
        status === 'needs_attention' && maxRepairs > 0 && review && (!review.parsed || !review.parsed.passed)
          ? `已自动修正 ${Math.min(attempt - 1, maxRepairs)} 轮，但仍未通过质检`
          : undefined,
    }
  }
}
