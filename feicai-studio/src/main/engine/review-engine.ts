// 两步审核：明确协议、逐调用上下文、取消/超时与正文来源绑定。
import { readFile } from 'fs/promises'
import { SkillLoader } from './skill-loader'
import { PromptAssembler } from './prompt-assembler'
import { OutputParser, type ParsedReview } from './output-parser'
import { REVIEW_SKILL_MAP, ANTIBIAS_PROMPT } from '@shared/constants'
import type {
  AutomatedPipelineStage,
  ReviewResult,
  ReviewStage,
  ProjectConfig
} from '@shared/types'
import type { ILLMProvider } from '../llm/types'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath
} from '@shared/path-resolver'
import {
  parsePlotBreakdownMarkdown,
  formatPlotBreakdownEntriesMarkdown,
  getPlotBreakdownEntriesForEpisode
} from '@shared/plot-breakdown'
import { assertPathWithinProject } from '../security/access-control'
import {
  captureReviewProvenance,
  hashReviewContent,
  type ReviewProvenance
} from './artifact-provenance'

interface ReviewOptions {
  signal?: AbortSignal
  timeoutMs?: number
  passScore?: number
  provider?: ILLMProvider
  waitUntilResumed?: () => Promise<void>
}

interface ReviewContext extends ReviewOptions {
  projectPath: string
  episodeNum: number
  scriptPath?: string
  projectConfig?: Partial<ProjectConfig> | null
}

interface ReviewContentParams extends ReviewOptions {
  stage: ReviewStage
  reviewSkillName: string
  outputToReview: string
  originalScript?: string
  directorAnalysis?: string
  plotBreakdown?: string
  artDesign?: string
  projectPath?: string
  episodeNum?: number
  projectConfig?: Partial<ProjectConfig> | null
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('审核已取消')
}

function assertUnchanged(
  provenance: ReviewProvenance,
  projectPath: string,
  stage: ReviewStage,
  episodeNum: number,
  config?: Partial<ProjectConfig> | null
): void {
  const current = captureReviewProvenance(
    projectPath,
    stage,
    episodeNum,
    config
  )
  const keys = Object.keys(current.inputHashes)
  if (
    current.artifactHash !== provenance.artifactHash ||
    keys.length !== Object.keys(provenance.inputHashes).length ||
    keys.some((key) => current.inputHashes[key] !== provenance.inputHashes[key])
  ) {
    throw new Error('审核期间正文或上游材料已变化，请重新审核')
  }
}

export class ReviewEngine {
  private llmProvider: ILLMProvider | null = null
  private passScore = 7

  constructor(
    private skillLoader: SkillLoader,
    private promptAssembler: PromptAssembler
  ) {}

  setProvider(provider: ILLMProvider): void {
    this.llmProvider = provider
  }
  setPassScore(score: number): void {
    this.passScore = score
  }

  async review(
    stage: AutomatedPipelineStage,
    ctx: ReviewContext
  ): Promise<ReviewResult> {
    const passScore = ctx.passScore ?? this.passScore
    const provider = ctx.provider ?? this.llmProvider
    if (!provider) throw new Error('LLM Provider 未设置')
    assertActive(ctx.signal)
    const reviewStage = stage === 'storyboard' ? 'storyboard_review' : stage
    const provenance = captureReviewProvenance(
      ctx.projectPath,
      reviewStage,
      ctx.episodeNum,
      ctx.projectConfig
    )
    const artifact =
      stage === 'art'
        ? 'artDesign'
        : stage === 'director'
          ? 'directorAnalysis'
          : 'seedancePrompts'
    const readEpisode = async (id: typeof artifact | 'script') =>
      readFile(
        assertPathWithinProject(
          ctx.projectPath,
          resolveEpisodeArtifactPath(
            ctx.projectPath,
            id,
            ctx.episodeNum,
            ctx.projectConfig
          )
        ),
        'utf8'
      )
    const output = await readEpisode(artifact)
    const canonicalScript = assertPathWithinProject(
      ctx.projectPath,
      resolveEpisodeArtifactPath(
        ctx.projectPath,
        'script',
        ctx.episodeNum,
        ctx.projectConfig
      )
    )
    if (
      ctx.scriptPath &&
      assertPathWithinProject(ctx.projectPath, ctx.scriptPath) !==
        canonicalScript
    ) {
      throw new Error('审核剧本路径与本集产物不匹配')
    }
    const script = await readEpisode('script')
    const directorAnalysis =
      stage === 'art' || stage === 'storyboard'
        ? await readEpisode('directorAnalysis')
        : undefined
    const artDesign =
      stage === 'storyboard' ? await readEpisode('artDesign') : undefined
    const plotBreakdown = await this.readPlotBreakdownForReview(ctx)
    assertActive(ctx.signal)
    assertUnchanged(
      provenance,
      ctx.projectPath,
      reviewStage,
      ctx.episodeNum,
      ctx.projectConfig
    )
    const result = await this.reviewContent({
      stage: reviewStage,
      reviewSkillName: REVIEW_SKILL_MAP[stage],
      outputToReview: output,
      originalScript: script,
      directorAnalysis,
      artDesign,
      plotBreakdown,
      projectPath: ctx.projectPath,
      episodeNum: ctx.episodeNum,
      projectConfig: ctx.projectConfig,
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs,
      passScore,
      waitUntilResumed: ctx.waitUntilResumed,
      provider
    })
    assertActive(ctx.signal)
    assertUnchanged(
      provenance,
      ctx.projectPath,
      reviewStage,
      ctx.episodeNum,
      ctx.projectConfig
    )
    return { ...result, ...provenance }
  }

  async reviewContent(params: ReviewContentParams): Promise<ReviewResult> {
    // 在首次 await 前固定 provider、阈值与来源，避免其他执行改变共享 setter。
    const provider = params.provider ?? this.llmProvider
    const passScore = params.passScore ?? this.passScore
    if (!provider) throw new Error('LLM Provider 未设置')
    assertActive(params.signal)
    if (!params.outputToReview.trim()) throw new Error('待审核内容为空')
    const timeoutMs = params.timeoutMs ?? 90_000
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new Error('审核超时必须为正数')
    if (!Number.isFinite(passScore) || passScore < 0 || passScore > 10)
      throw new Error('审核阈值必须在 0..10 范围内')
    if (
      (params.projectPath === undefined) !==
      (params.episodeNum === undefined)
    ) {
      throw new Error('审核来源必须同时提供项目路径和集数')
    }
    const provenance =
      params.projectPath !== undefined
        ? captureReviewProvenance(
            params.projectPath,
            params.stage,
            params.episodeNum!,
            params.projectConfig
          )
        : undefined
    if (
      provenance &&
      provenance.artifactHash !== hashReviewContent(params.outputToReview)
    ) {
      throw new Error('待审正文与当前文件不一致，请重新读取')
    }
    const controller = new AbortController()
    const forwardAbort = () =>
      controller.abort(params.signal?.reason ?? new Error('审核已取消'))
    params.signal?.addEventListener('abort', forwardAbort, { once: true })
    const timer = setTimeout(
      () => controller.abort(new Error('审核超时')),
      timeoutMs
    )
    const signal = controller.signal
    const deadline = Date.now() + timeoutMs
    try {
      assertActive(params.signal)
      const business = await this.executeReview(
        provider,
        params.reviewSkillName,
        ANTIBIAS_PROMPT,
        params,
        passScore,
        signal,
        deadline
      )
      // INVALID 仍执行合规以收齐修改意见；异常/取消则直接抛出，绝不启动第二步。
      assertActive(signal)
      const compliance = await this.executeReview(
        provider,
        'compliance-review-skill',
        '你是合规审核员，严格检查内容是否触碰 Seedance 2.0 和 Gemini 平台红线。',
        params,
        passScore,
        signal,
        deadline
      )
      assertActive(signal)
      if (provenance)
        assertUnchanged(
          provenance,
          params.projectPath!,
          params.stage,
          params.episodeNum!,
          params.projectConfig
        )
      const result =
        business.result === 'INVALID' || compliance.result === 'INVALID'
          ? 'INVALID'
          : business.passed && compliance.passed
            ? 'PASS'
            : 'FAIL'
      return {
        stage: params.stage,
        reviewType: 'business',
        result,
        passed: result === 'PASS',
        score: business.score,
        feedback: [
          `## 业务审核: ${business.result === 'PASS' ? '✅' : '❌'} ${business.result} (${business.score}分)`,
          business.feedback,
          '',
          `## 合规审核: ${compliance.result === 'PASS' ? '✅' : '❌'} ${compliance.result}`,
          compliance.feedback
        ].join('\n'),
        issues: [...business.issues, ...compliance.issues],
        createdAt: new Date().toISOString(),
        ...provenance
      }
    } finally {
      clearTimeout(timer)
      params.signal?.removeEventListener('abort', forwardAbort)
    }
  }

  private async executeReview(
    provider: ILLMProvider,
    skillName: string,
    stance: string,
    params: ReviewContentParams,
    passScore: number,
    signal: AbortSignal,
    deadline: number
  ): Promise<ParsedReview> {
    assertActive(signal)
    const skill = await this.skillLoader.load(skillName)
    assertActive(signal)
    const prompt = this.promptAssembler.assembleReview(
      skill,
      stance,
      params.outputToReview,
      params.originalScript,
      params.directorAnalysis,
      params.plotBreakdown,
      params.artDesign
    )
    const aborted = Promise.withResolvers<never>()
    const rejectAbort = () =>
      aborted.reject(signal.reason ?? new Error('审核已取消'))
    signal.addEventListener('abort', rejectAbort, { once: true })
    try {
      assertActive(signal)
      if (params.waitUntilResumed) {
        await Promise.race([params.waitUntilResumed(), aborted.promise])
        assertActive(signal)
      }
      const response = await Promise.race([
        provider.generate(prompt, {
          signal,
          timeoutMs: Math.max(1, deadline - Date.now())
        }),
        aborted.promise
      ])
      assertActive(signal)
      return OutputParser.parseReview(response, passScore)
    } finally {
      signal.removeEventListener('abort', rejectAbort)
    }
  }

  private async readPlotBreakdownForReview(
    ctx: ReviewContext
  ): Promise<string | undefined> {
    const filePath = assertPathWithinProject(
      ctx.projectPath,
      resolveProjectArtifactPath(
        ctx.projectPath,
        'plotBreakdown',
        ctx.projectConfig
      )
    )
    try {
      const raw = await readFile(filePath, 'utf8')
      return formatPlotBreakdownEntriesMarkdown(
        getPlotBreakdownEntriesForEpisode(
          parsePlotBreakdownMarkdown(raw),
          ctx.episodeNum
        )
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
}
