import { randomUUID } from 'crypto'
import {
  ProductionCommitStore,
  commitHash,
  readCommitText,
  type CommitWrite
} from '../io/production-commit-store'
import type { ProjectStatePersistence } from '../engine/project-state'
import { readFile } from 'fs/promises'
import { listSourceChapters } from '../project/novel-importer'
import {
  appendGeneratedStoryToProjectPlotBreakdown,
  getProjectPlotBreakdownMarkdownForEpisode,
  markProjectPlotBreakdownEpisodeStatus,
  summarizeProjectPlotBreakdown
} from '../project/plot-breakdown-store'
import { SkillLoader } from '../engine/skill-loader'
import {
  PromptAssembler,
  type ProjectContext,
  type UpstreamInputs
} from '../engine/prompt-assembler'
import { ReviewEngine } from '../engine/review-engine'
import {
  captureReviewProvenance,
  isReviewCurrent
} from '../engine/artifact-provenance'
import type { ILLMProvider } from '../llm/types'
import { parsePipelineSettings } from '@shared/pipeline-settings'
import {
  type AutomatedPipelineStage,
  type ReviewResult,
  type ReviewStage,
  type ProjectConfig,
  type ProjectPipelineState
} from '@shared/types'
import { ArtOutputMerger, readArtReference } from '../engine/art-output-merger'
import { normalizeProjectConfig } from '@shared/project-config'
import { getEntryRequirements } from '@shared/workflow'
import {
  formatReviewMarkdown,
  parseReviewMarkdown
} from '@shared/review-artifacts'
import {
  formatPlotBreakdownEntriesMarkdown,
  validateGeneratedPlotBreakdown
} from '@shared/plot-breakdown'
import { validateScriptHardRules } from '@shared/script-quality'
import {
  describeEpisodeArtifact,
  describeProjectArtifact,
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath
} from '@shared/path-resolver'
import { ROLE_DECLARATIONS, STAGE_SKILL_MAP } from '@shared/constants'
import { atomicWriteFile, readJsonWithRecovery } from '../io/atomic-file'
import {
  assertEpisodeNumber,
  assertPathWithinProject
} from '../security/access-control'

export type WorkflowGenerateStage =
  AutomatedPipelineStage | 'story' | 'script' | 'character'
export type WorkflowEngineReviewStage = ReviewStage

export interface WorkflowEngineContext {
  projectPath: string
  episodeNum: number
  projectContext: ProjectContext
  projectConfig?: Partial<ProjectConfig> | null
  signal?: AbortSignal
  batchNumber?: number
  timeoutMs?: number
  idleTimeoutMs?: number
  firstChunkTimeoutMs?: number
  waitUntilResumed?: () => Promise<void>
  operationId?: string
}

export interface WorkflowGenerateOptions {
  reviewFeedback?: string
  signal?: AbortSignal
  timeoutMs?: number
  idleTimeoutMs?: number
  firstChunkTimeoutMs?: number
  onChunk?: (chunk: string, totalLength: number) => void
}

export interface WorkflowGenerateResult {
  stage: WorkflowGenerateStage
  outputPath: string
  content: string
  promptMetrics: { systemChars: number; userChars: number }
}

export interface WorkflowReviewResult {
  stage: WorkflowEngineReviewStage
  review: ReviewResult
  outputPath?: string
}

type ReviewContext = Omit<WorkflowEngineContext, 'projectContext'> & {
  scriptPath?: string
}
const STORY_BREAKDOWN_CHAPTERS_PER_BATCH = 6
const STORY_BATCH_MARKER = /<!--\s*feicai-story-batch:(\d+)\s*-->/u
const GENERATION_SKILL_MAP: Record<WorkflowGenerateStage, string> = {
  story: 'story-breakdown-skill',
  script: 'script-generation-skill',
  character: 'character-design-skill',
  director: STAGE_SKILL_MAP.director,
  art: STAGE_SKILL_MAP.art,
  storyboard: STAGE_SKILL_MAP.storyboard
}
const GENERATION_ROLE_MAP: Record<WorkflowGenerateStage, string> = {
  story:
    '我是一名短剧剧情策划，负责将小说拆为强调冲突、转折、节奏和钩子的单集剧情点。',
  script:
    '我是一名短剧编剧，负责将本集剧情点改编为包含场景、动作、对白和结尾钩子的完整剧本。',
  character:
    '我是一名影视角色设计师，负责根据剧本与导演分析设计具有稳定视觉识别点的角色素材。',
  director: ROLE_DECLARATIONS.director,
  art: ROLE_DECLARATIONS.art,
  storyboard: ROLE_DECLARATIONS.storyboard
}
const PROMPT_STAGE_MAP: Record<WorkflowGenerateStage, string> = {
  story: 'story',
  script: 'script_generation',
  character: 'character',
  director: 'director',
  art: 'art',
  storyboard: 'storyboard'
}

export class WorkflowEngine {
  private skillLoader: SkillLoader
  private promptAssembler: PromptAssembler
  private llmProvider: ILLMProvider | null = null
  private publicationState?: {
    persistence: ProjectStatePersistence
    operationId?: string
  }

  setPublicationState(
    persistence: ProjectStatePersistence | null,
    operationId?: string
  ): void {
    this.publicationState = persistence
      ? { persistence, operationId }
      : undefined
  }

  constructor(skillsDir: string) {
    this.skillLoader = new SkillLoader(skillsDir)
    this.promptAssembler = new PromptAssembler()
  }

  setProvider(provider: ILLMProvider): void {
    this.llmProvider = provider
  }

  async generateStage(
    stage: WorkflowGenerateStage,
    context: WorkflowEngineContext,
    options: WorkflowGenerateOptions = {}
  ): Promise<WorkflowGenerateResult> {
    // Capture execution-local settings/provider before the first await.
    const settings = parsePipelineSettings(
      context.projectConfig?.pipelineSettings
    )
    const ctx: WorkflowEngineContext = {
      ...context,
      projectConfig: context.projectConfig
        ? structuredClone(context.projectConfig)
        : context.projectConfig,
      projectContext: { ...context.projectContext, ...settings },
      signal: options.signal || context.signal
    }
    const provider = this.llmProvider
    if (!provider) throw new Error('请先配置 LLM Provider')
    this.assertContext(ctx)
    await this.checkpoint(ctx)
    await new ProductionCommitStore(
      ctx.projectPath,
      ctx.projectConfig
    ).recover()
    await this.assertCurrentPrerequisites(stage, ctx)
    const entry = getEntryRequirements(ctx.projectConfig?.entryStage)
    if (stage === 'story' && !entry.requiresNovel)
      throw new Error('当前入口请直接导入或编辑剧情/剧本，无需生成小说剧情批次')
    if (stage === 'story') {
      const existing = options.reviewFeedback
        ? await this.readOptionalFile(
            this.episodePath(ctx, 'storyBeat'),
            ctx.projectPath
          )
        : undefined
      const draftBatch = existing?.match(STORY_BATCH_MARKER)?.[1]
      ctx.batchNumber =
        ctx.batchNumber ??
        (draftBatch
          ? Number(draftBatch)
          : summarizeProjectPlotBreakdown({
              projectPath: ctx.projectPath,
              config: (ctx.projectConfig || {}) as ProjectConfig
            }).nextBatchNumber)
      assertEpisodeNumber(ctx.batchNumber)
      if (draftBatch && Number(draftBatch) !== ctx.batchNumber)
        throw new Error('修订草稿的剧情批次不匹配')
    }
    const inputs = await this.gatherInputs(
      ctx.projectPath,
      ctx.episodeNum,
      ctx.projectConfig,
      stage,
      ctx.batchNumber
    )
    this.assertGenerationPrerequisites(stage, inputs, ctx.projectConfig)
    const skill = await this.skillLoader.load(GENERATION_SKILL_MAP[stage])
    const prompt = this.promptAssembler.assemble(
      skill,
      GENERATION_ROLE_MAP[stage],
      inputs,
      ctx.projectContext,
      PROMPT_STAGE_MAP[stage],
      options.reviewFeedback,
      normalizeProjectConfig(ctx.projectConfig).entryStage
    )
    const timeoutMs =
      options.timeoutMs ?? ctx.timeoutMs ?? settings.llmTimeoutSec * 1000
    const generateOptions = {
      signal: ctx.signal,
      timeoutMs,
      idleTimeoutMs: options.idleTimeoutMs ?? ctx.idleTimeoutMs ?? timeoutMs,
      firstChunkTimeoutMs:
        options.firstChunkTimeoutMs ?? ctx.firstChunkTimeoutMs ?? timeoutMs
    }
    await this.checkpoint(ctx)
    let content = ''
    if (options.onChunk) {
      for await (const chunk of provider.generateStream(
        prompt,
        generateOptions
      )) {
        await this.checkpoint(ctx)
        content += chunk
        options.onChunk(chunk, content.length)
      }
    } else {
      content = await provider.generate(prompt, generateOptions)
    }
    await this.checkpoint(ctx)
    if (!content.trim()) throw new Error('模型返回空白内容，未覆盖现有产物')
    if (stage === 'story') {
      validateGeneratedPlotBreakdown(content, ctx.projectConfig?.totalEpisodes)
      content = `<!-- feicai-story-batch:${ctx.batchNumber} -->\n${content.replace(STORY_BATCH_MARKER, '').trim()}\n`
    }
    if (ctx.operationId) {
      content = `<!-- feicai-operation:${ctx.operationId} -->\n${content.replace(/^<!--\s*feicai-operation:[^\r\n]*-->\s*\n?/gm, '')}`
    }
    if (stage === 'art') ArtOutputMerger.validateOutput(content)
    const artifactId =
      stage === 'story'
        ? 'storyBeat'
        : stage === 'script'
          ? 'script'
          : stage === 'character'
            ? 'characterDesign'
            : stage === 'director'
              ? 'directorAnalysis'
              : stage === 'art'
                ? 'artDesign'
                : 'seedancePrompts'
    const outputPath = this.episodePath(ctx, artifactId)
    // Recheck prerequisites after generation: external edits must not authorize stale work.
    await this.checkpoint(ctx)
    await this.assertCurrentPrerequisites(stage, ctx)
    ctx.signal?.throwIfAborted()
    await atomicWriteFile(
      assertPathWithinProject(ctx.projectPath, outputPath),
      content
    )
    return {
      stage,
      outputPath,
      content,
      promptMetrics: {
        systemChars: prompt.system.length,
        userChars: prompt.user.length
      }
    }
  }

  async reviewStage(
    stage: WorkflowEngineReviewStage,
    context: ReviewContext
  ): Promise<WorkflowReviewResult> {
    const settings = parsePipelineSettings(
      context.projectConfig?.pipelineSettings
    )
    const ctx: ReviewContext = {
      ...context,
      projectConfig: context.projectConfig
        ? structuredClone(context.projectConfig)
        : context.projectConfig
    }
    const provider = this.llmProvider
    this.assertContext(ctx)
    const store = new ProductionCommitStore(ctx.projectPath, ctx.projectConfig)
    await this.checkpoint(ctx)
    await store.recover()
    await this.assertCurrentPrerequisites(stage, ctx)
    if (stage === 'story_review') {
      const story = readCommitText(this.episodePath(ctx, 'storyBeat'))
      const batch = story?.match(STORY_BATCH_MARKER)?.[1]
      if (batch) {
        if (ctx.batchNumber !== undefined && ctx.batchNumber !== Number(batch))
          throw new Error('审核批次与草稿批次不匹配')
        ctx.batchNumber = Number(batch)
      }
    }
    const inputPaths = new Set<string>([
      resolveProjectArtifactPath(
        ctx.projectPath,
        'projectConfig',
        ctx.projectConfig
      )
    ])
    const provenance = captureReviewProvenance(
      ctx.projectPath,
      stage,
      ctx.episodeNum,
      ctx.projectConfig,
      inputPaths
    )
    const outputArtifact =
      stage === 'story_review'
        ? 'storyReview'
        : stage === 'script_review'
          ? 'scriptReview'
          : stage === 'storyboard_review'
            ? 'storyboardReview'
            : undefined
    const receiptPath = outputArtifact
      ? this.episodePath(ctx, outputArtifact)
      : undefined
    const guards = [...inputPaths, ...(receiptPath ? [receiptPath] : [])]
    if (
      getEntryRequirements(ctx.projectConfig?.entryStage).requiresInventory &&
      (stage === 'story_review' || stage === 'script_review')
    )
      guards.push(
        resolveProjectArtifactPath(
          ctx.projectPath,
          'plotBreakdown',
          ctx.projectConfig
        )
      )
    if (stage === 'art')
      guards.push(
        resolveProjectArtifactPath(
          ctx.projectPath,
          'characterPrompts',
          ctx.projectConfig
        ),
        resolveProjectArtifactPath(
          ctx.projectPath,
          'scenePrompts',
          ctx.projectConfig
        ),
        `${this.episodePath(ctx, 'artDesign')}.references.json`
      )
    const intent = await store.intent(
      ctx.operationId ?? randomUUID(),
      `review:${stage}:${ctx.episodeNum}`,
      commitHash(
        JSON.stringify({
          stage,
          episodeNum: ctx.episodeNum,
          batchNumber: ctx.batchNumber ?? null,
          provenance
        })
      ),
      [ctx.episodeNum],
      guards
    )
    if (intent.phase === 'committed') {
      const saved = intent.result as WorkflowReviewResult | undefined
      if (!saved || saved.stage !== stage || saved.review?.stage !== stage)
        throw new Error('已提交审核收据损坏')
      if (saved.review.passed) this.assertReviewUnchanged(saved.review, ctx)
      return saved
    }
    store.assertGuards(intent)
    if (!provider) throw new Error('请先配置 LLM Provider')
    const engine = new ReviewEngine(this.skillLoader, this.promptAssembler)
    engine.setProvider(provider)
    const callOptions = {
      projectConfig: ctx.projectConfig,
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs ?? settings.llmTimeoutSec * 1000,
      passScore: settings.passScore,
      provider,
      waitUntilResumed: ctx.waitUntilResumed
    }
    let review: ReviewResult
    let outputPath: string | undefined
    let storyBeat: string | undefined
    if (stage === 'story_review' && ctx.projectConfig?.entryStage === 'script')
      throw new Error('剧本入口无需剧情审核，请直接审核本集剧本')
    if (stage === 'story_review' && ctx.projectConfig?.entryStage === 'story') {
      storyBeat = await this.readRequiredFile(
        this.episodePath(ctx, 'storyBeat'),
        ctx.projectPath
      )
      review = await engine.reviewContent({
        stage,
        reviewSkillName: 'story-breakdown-review-skill',
        outputToReview: storyBeat,
        ...callOptions
      })
      outputPath = this.episodePath(ctx, 'storyReview')
    } else if (stage === 'story_review') {
      storyBeat = await this.readRequiredFile(
        this.episodePath(ctx, 'storyBeat'),
        ctx.projectPath
      )
      const storedBatch = storyBeat.match(STORY_BATCH_MARKER)?.[1]
      if (!storedBatch)
        throw new Error('剧情草稿缺少批次身份，请重新生成草稿后审核')
      const batchNumber = Number(storedBatch)
      assertEpisodeNumber(batchNumber)
      if (ctx.batchNumber !== undefined && ctx.batchNumber !== batchNumber)
        throw new Error('审核批次与草稿批次不匹配')
      ctx.batchNumber = batchNumber
      const entries = validateGeneratedPlotBreakdown(
        storyBeat,
        ctx.projectConfig?.totalEpisodes
      )
      const sourceNovel = await this.readEpisodeSourceNovel(
        ctx.projectPath,
        batchNumber,
        ctx.projectConfig,
        'breakdownBatch'
      )
      if (!sourceNovel?.trim()) throw new Error('缺少当前批次原文章节')
      const plotBreakdown = formatPlotBreakdownEntriesMarkdown(entries, {
        heading: '# 当前批次新增剧情点'
      })
      await this.checkpoint(ctx)
      review = await engine.reviewContent({
        stage,
        reviewSkillName: 'story-breakdown-review-skill',
        outputToReview: storyBeat,
        originalScript: [plotBreakdown, sourceNovel].join('\n\n---\n\n'),
        plotBreakdown,
        ...callOptions
      })
      outputPath = this.episodePath(ctx, 'storyReview')
    } else if (stage === 'script_review') {
      const script = await this.readRequiredFile(
        this.episodePath(ctx, 'script'),
        ctx.projectPath
      )
      const sourceNovel = getEntryRequirements(ctx.projectConfig?.entryStage)
        .requiresNovel
        ? await this.readEpisodeSourceNovel(
            ctx.projectPath,
            ctx.episodeNum,
            ctx.projectConfig
          )
        : undefined
      const previousScript = await this.readAdjacentEpisodeScript(ctx, -1)
      const nextScript = await this.readAdjacentEpisodeScript(ctx, 1)
      const storyBeat =
        ctx.projectConfig?.entryStage === 'story'
          ? await this.readRequiredFile(
              this.episodePath(ctx, 'storyBeat'),
              ctx.projectPath
            )
          : undefined
      const plotBreakdown = getEntryRequirements(ctx.projectConfig?.entryStage)
        .requiresInventory
        ? getProjectPlotBreakdownMarkdownForEpisode({
            projectPath: ctx.projectPath,
            config: (ctx.projectConfig || {}) as ProjectConfig,
            episodeNum: ctx.episodeNum,
            heading: '# 当前集剧情点'
          })
        : ''
      if (
        getEntryRequirements(ctx.projectConfig?.entryStage).requiresInventory &&
        !plotBreakdown.trim()
      )
        throw new Error('缺少本集绑定剧情点，无法审核剧本')
      await this.checkpoint(ctx)
      review = await engine.reviewContent({
        stage,
        reviewSkillName: 'script-review-skill',
        outputToReview: script,
        originalScript: [
          plotBreakdown,
          storyBeat,
          sourceNovel,
          previousScript,
          nextScript
        ]
          .filter(Boolean)
          .join('\n\n---\n\n'),
        plotBreakdown,
        ...callOptions
      })
      const validation = validateScriptHardRules(
        script.replace(/^<!--\s*feicai-operation:[^\r\n]*-->\s*\n?/gm, ''),
        settings
      )
      if (!validation.passed) {
        review = {
          ...review,
          passed: false,
          result: 'FAIL',
          score: Math.min(review.score, 6),
          issues: [...validation.issues, ...review.issues],
          feedback: [
            '本地硬校验未通过：',
            ...validation.issues.map((issue) => `- ${issue.description}`),
            '',
            review.feedback
          ].join('\n')
        }
      }
      outputPath = this.episodePath(ctx, 'scriptReview')
    } else if (stage === 'storyboard_review') {
      const prompts = await this.readRequiredFile(
        this.episodePath(ctx, 'seedancePrompts'),
        ctx.projectPath
      )
      const script = await this.readRequiredFile(
        this.episodePath(ctx, 'script'),
        ctx.projectPath
      )
      const artDesign = await this.readRequiredFile(
        this.episodePath(ctx, 'artDesign'),
        ctx.projectPath
      )
      const directorAnalysis = await this.readRequiredFile(
        this.episodePath(ctx, 'directorAnalysis'),
        ctx.projectPath
      )
      await this.checkpoint(ctx)
      review = await engine.reviewContent({
        stage,
        reviewSkillName: 'seedance-prompt-review-skill',
        outputToReview: prompts,
        originalScript: [script, await this.visualReviewInputs(ctx, false)]
          .filter(Boolean)
          .join('\n\n---\n\n'),
        directorAnalysis,
        artDesign,
        ...callOptions
      })
      outputPath = this.episodePath(ctx, 'storyboardReview')
    } else if (stage === 'art') {
      const inputs = await this.gatherInputs(
        ctx.projectPath,
        ctx.episodeNum,
        ctx.projectConfig,
        'art'
      )
      review = await engine.reviewContent({
        stage,
        reviewSkillName: 'art-direction-review-skill',
        outputToReview: await this.readRequiredFile(
          this.episodePath(ctx, 'artDesign'),
          ctx.projectPath
        ),
        originalScript: [
          inputs.script,
          await this.visualReviewInputs(ctx, true)
        ]
          .filter(Boolean)
          .join('\n\n---\n\n'),
        directorAnalysis: inputs.directorAnalysis,
        plotBreakdown: inputs.plotBreakdown,
        ...callOptions
      })
    } else {
      const scriptPath = this.episodePath(ctx, 'script')
      if (
        ctx.scriptPath &&
        assertPathWithinProject(ctx.projectPath, ctx.scriptPath) !== scriptPath
      )
        throw new Error('审核剧本路径与本集产物不匹配')
      const inputs = await this.gatherInputs(
        ctx.projectPath,
        ctx.episodeNum,
        ctx.projectConfig,
        'director'
      )
      await this.checkpoint(ctx)
      review = await engine.reviewContent({
        stage,
        reviewSkillName: 'script-analysis-review-skill',
        outputToReview: await this.readRequiredFile(
          this.episodePath(ctx, 'directorAnalysis'),
          ctx.projectPath
        ),
        originalScript: inputs.script,
        plotBreakdown: inputs.plotBreakdown,
        ...callOptions
      })
    }
    review = { ...review, ...provenance }
    if (
      review.passed &&
      (review.result !== 'PASS' ||
        !Number.isFinite(review.score) ||
        review.score < settings.passScore ||
        review.score > 10)
    ) {
      review = {
        ...review,
        result: 'FAIL',
        passed: false,
        feedback: `审核未达到项目通过阈值 ${settings.passScore}/10。\n${review.feedback}`
      }
    }
    await this.checkpoint(ctx)
    this.assertReviewUnchanged(review, ctx)
    await this.assertCurrentPrerequisites(stage, ctx)
    const writes: CommitWrite[] = []
    if (
      review.passed &&
      stage === 'story_review' &&
      getEntryRequirements(ctx.projectConfig?.entryStage).requiresInventory
    ) {
      await this.checkpoint(ctx)
      this.assertReviewUnchanged(review, ctx)
      const published = appendGeneratedStoryToProjectPlotBreakdown({
        projectPath: ctx.projectPath,
        config: (ctx.projectConfig || {}) as ProjectConfig,
        generatedContent: storyBeat!,
        batchNumber: ctx.batchNumber!,
        chaptersPerBatch: STORY_BREAKDOWN_CHAPTERS_PER_BATCH,
        prepareOnly: true
      })
      writes.push({
        path: published.path,
        content: published.content,
        expected: published.expected
      })
      if (published.appendedEntries === 0)
        throw new Error('剧情库存未写入任何剧情点')
    }
    if (
      review.passed &&
      stage === 'script_review' &&
      getEntryRequirements(ctx.projectConfig?.entryStage).requiresInventory
    ) {
      await this.checkpoint(ctx)
      this.assertReviewUnchanged(review, ctx)
      const consumed = markProjectPlotBreakdownEpisodeStatus({
        projectPath: ctx.projectPath,
        config: (ctx.projectConfig || {}) as ProjectConfig,
        episodeNum: ctx.episodeNum,
        fromStatus: '未用',
        toStatus: '已用',
        prepareOnly: true
      })
      writes.push({
        path: consumed.path,
        content: consumed.content,
        expected: consumed.expected
      })
    }
    if (review.passed && stage === 'art') {
      const art = await this.readRequiredFile(
        this.episodePath(ctx, 'artDesign'),
        ctx.projectPath
      )
      const preparedArt = await ArtOutputMerger.parseAndMerge(
        art,
        ctx.projectPath,
        ctx.episodeNum,
        ctx.projectConfig,
        async () => {
          await this.checkpoint(ctx)
          await this.assertCurrentPrerequisites(stage, ctx)
          ctx.signal?.throwIfAborted()
          this.assertReviewUnchanged(review, ctx)
        },
        true
      )
      writes.push(...preparedArt.writes)
    }
    if (outputPath) {
      const title =
        stage === 'story_review'
          ? '剧情拆解审核'
          : stage === 'script_review'
            ? '剧本审核'
            : '分镜审核'
      await this.checkpoint(ctx)
      await this.assertCurrentPrerequisites(stage, ctx)
      ctx.signal?.throwIfAborted()
      this.assertReviewUnchanged(review, ctx)
      const markdown = formatReviewMarkdown(title, review)
      writes.push({
        path: outputPath,
        expected: readCommitText(outputPath),
        content: ctx.operationId
          ? `${markdown}\n<!-- feicai-operation:${ctx.operationId} -->\n`
          : markdown
      })
    }
    if (
      this.publicationState &&
      (stage === 'director' || stage === 'art' || stage === 'storyboard_review')
    ) {
      writes.push(
        this.publicationState.persistence.prepareReviewCommit(
          ctx.episodeNum,
          stage === 'storyboard_review' ? 'storyboard' : stage,
          review,
          this.publicationState.operationId
        )
      )
    }
    await this.checkpoint(ctx)
    this.assertReviewUnchanged(review, ctx)
    const result = { stage, review, outputPath }
    await store.install(await store.prepare(intent, writes, result))
    return result
  }

  async gatherInputs(
    projectPath: string,
    episodeNum: number,
    projectConfig?: Partial<ProjectConfig> | null,
    stage?: WorkflowGenerateStage,
    batchNumber?: number
  ): Promise<UpstreamInputs> {
    const ctx = { projectPath, episodeNum, projectConfig }
    const sourceNumber =
      stage === 'story'
        ? (batchNumber ??
          summarizeProjectPlotBreakdown({
            projectPath,
            config: (projectConfig || {}) as ProjectConfig
          }).nextBatchNumber)
        : episodeNum
    const sourceNovel = getEntryRequirements(projectConfig?.entryStage)
      .requiresNovel
      ? await this.readEpisodeSourceNovel(
          projectPath,
          sourceNumber,
          projectConfig,
          stage === 'story' ? 'breakdownBatch' : 'episode'
        )
      : undefined
    const episodeRead = (
      artifact: Parameters<typeof resolveEpisodeArtifactPath>[1]
    ) => this.readOptionalFile(this.episodePath(ctx, artifact), projectPath)
    const projectRead = (
      artifact: Parameters<typeof resolveProjectArtifactPath>[1]
    ) =>
      this.readOptionalFile(
        assertPathWithinProject(
          projectPath,
          resolveProjectArtifactPath(projectPath, artifact, projectConfig)
        ),
        projectPath
      )
    return {
      sourceNovel,
      plotBreakdown:
        stage === 'story' ||
        !getEntryRequirements(projectConfig?.entryStage).requiresInventory
          ? undefined
          : getProjectPlotBreakdownMarkdownForEpisode({
              projectPath,
              config: (projectConfig || {}) as ProjectConfig,
              episodeNum,
              heading: '# 当前集绑定剧情点（含已用剧情，可用于本集修订）'
            }),
      storyBeat:
        projectConfig?.entryStage === 'story' && stage === 'script'
          ? await episodeRead('storyBeat')
          : undefined,
      previousScript:
        stage === 'script'
          ? await this.readAdjacentEpisodeScript(ctx, -1)
          : undefined,
      nextScript:
        stage === 'script'
          ? await this.readAdjacentEpisodeScript(ctx, 1)
          : undefined,
      script: stage === 'story' ? undefined : await episodeRead('script'),
      directorAnalysis: ['art', 'storyboard', 'character'].includes(stage || '')
        ? await episodeRead('directorAnalysis')
        : undefined,
      characterDesign:
        stage === 'art' || stage === 'storyboard'
          ? await episodeRead('characterDesign')
          : undefined,
      artDesign:
        stage === 'storyboard' ? await episodeRead('artDesign') : undefined,
      characterPrompts:
        stage === 'art' || stage === 'storyboard'
          ? readArtReference(
              projectPath,
              'characterPrompts',
              stage === 'art' ? episodeNum : undefined,
              projectConfig
            )
          : undefined,
      scenePrompts:
        stage === 'art' || stage === 'storyboard'
          ? readArtReference(
              projectPath,
              'scenePrompts',
              stage === 'art' ? episodeNum : undefined,
              projectConfig
            )
          : undefined,
      fullPlotBreakdown:
        stage === 'story' ? await projectRead('plotBreakdown') : undefined
    }
  }

  private assertGenerationPrerequisites(
    stage: WorkflowGenerateStage,
    inputs: UpstreamInputs,
    config?: Partial<ProjectConfig> | null
  ): void {
    if (stage === 'story' && !inputs.sourceNovel?.trim())
      throw new Error(
        `缺少 ${describeProjectArtifact('sourceNovel')}，请先补齐小说原文或项目设定`
      )
    if (
      stage === 'script' &&
      !(getEntryRequirements(config?.entryStage).requiresInventory
        ? inputs.plotBreakdown?.trim()
        : config?.entryStage === 'story'
          ? inputs.storyBeat?.trim()
          : inputs.script?.trim())
    )
      throw new Error('缺少当前集绑定剧情点，请先完成剧情库存拆解')
    if (
      ['director', 'art', 'storyboard', 'character'].includes(stage) &&
      !inputs.script?.trim()
    )
      throw new Error(
        `缺少剧本文件，请先补齐 ${describeEpisodeArtifact('script')}`
      )
    if (
      ['art', 'storyboard', 'character'].includes(stage) &&
      !inputs.directorAnalysis?.trim()
    )
      throw new Error(
        `缺少导演分析，请先生成 ${describeEpisodeArtifact('directorAnalysis')}`
      )
  }

  private async assertCurrentPrerequisites(
    stage: WorkflowGenerateStage | ReviewStage,
    ctx: ReviewContext
  ): Promise<void> {
    const required: ReviewStage[] = []
    if (
      ctx.projectConfig?.entryStage === 'story' &&
      ['script', 'script_review'].includes(stage)
    )
      required.push('story_review')
    if (
      [
        'director',
        'art',
        'storyboard',
        'character',
        'storyboard_review'
      ].includes(stage)
    )
      required.push('script_review')
    if (['art', 'storyboard', 'character', 'storyboard_review'].includes(stage))
      required.push('director')
    if (['storyboard', 'storyboard_review'].includes(stage))
      required.push('art')
    if (required.length === 0) return
    let state: ProjectPipelineState | null = null
    const threshold = parsePipelineSettings(
      ctx.projectConfig?.pipelineSettings
    ).passScore
    for (const upstream of required) {
      let review: ReviewResult | null | undefined
      if (upstream === 'script_review' || upstream === 'story_review') {
        const raw = await this.readOptionalFile(
          this.episodePath(
            ctx,
            upstream === 'story_review' ? 'storyReview' : 'scriptReview'
          ),
          ctx.projectPath
        )
        review = raw ? parseReviewMarkdown(raw, upstream) : null
      } else {
        if (!state)
          state = await readJsonWithRecovery<ProjectPipelineState>(
            assertPathWithinProject(
              ctx.projectPath,
              resolveProjectArtifactPath(
                ctx.projectPath,
                'pipelineState',
                ctx.projectConfig
              )
            )
          )
        review =
          state?.episodes[ctx.episodeNum]?.stageStates?.[
            upstream as 'director' | 'art'
          ]?.lastReview
      }
      if (
        !review?.passed ||
        review.result !== 'PASS' ||
        !Number.isFinite(review.score) ||
        review.score < threshold ||
        !isReviewCurrent(
          review,
          ctx.projectPath,
          ctx.episodeNum,
          ctx.projectConfig
        )
      ) {
        throw new Error(
          `缺少当前有效 ${upstream} PASS（阈值 ${threshold}/10），请先审核上游产物`
        )
      }
    }
  }

  private async visualReviewInputs(
    ctx: ReviewContext,
    art: boolean
  ): Promise<string> {
    const character = await this.readOptionalFile(
      this.episodePath(ctx, 'characterDesign'),
      ctx.projectPath
    )
    return [
      character ? `# 本集角色设计\n\n${character}` : '',
      ...(['characterPrompts', 'scenePrompts'] as const).map((artifact) => {
        const content = readArtReference(
          ctx.projectPath,
          artifact,
          art ? ctx.episodeNum : undefined,
          ctx.projectConfig
        )
        return content
          ? `# ${artifact === 'characterPrompts' ? '已有角色素材' : '已有场景素材'}\n\n${content}`
          : ''
      })
    ]
      .filter(Boolean)
      .join('\n\n---\n\n')
  }

  private assertReviewUnchanged(
    review: ReviewResult,
    ctx: ReviewContext
  ): void {
    const current = captureReviewProvenance(
      ctx.projectPath,
      review.stage,
      ctx.episodeNum,
      ctx.projectConfig
    )
    const keys = Object.keys(current.inputHashes)
    if (
      current.artifactHash !== review.artifactHash ||
      keys.length !== Object.keys(review.inputHashes || {}).length ||
      keys.some((key) => current.inputHashes[key] !== review.inputHashes?.[key])
    ) {
      throw new Error('审核期间产物或依赖已改变，请重新审核')
    }
  }

  private assertContext(ctx: ReviewContext): void {
    assertEpisodeNumber(ctx.episodeNum)
    if (ctx.batchNumber !== undefined) assertEpisodeNumber(ctx.batchNumber)
    if (
      ctx.projectConfig?.totalEpisodes &&
      ctx.episodeNum > ctx.projectConfig.totalEpisodes
    )
      throw new Error('目标集数超出项目范围')
  }

  private async checkpoint(
    ctx: Pick<WorkflowEngineContext, 'signal' | 'waitUntilResumed'>
  ): Promise<void> {
    ctx.signal?.throwIfAborted()
    if (ctx.waitUntilResumed && ctx.signal) {
      const { promise, reject } = Promise.withResolvers<never>()
      const onAbort = () =>
        reject(ctx.signal!.reason ?? new Error('任务已取消'))
      ctx.signal.addEventListener('abort', onAbort, { once: true })
      try {
        await Promise.race([ctx.waitUntilResumed(), promise])
      } finally {
        ctx.signal.removeEventListener('abort', onAbort)
      }
    } else {
      await ctx.waitUntilResumed?.()
    }
    ctx.signal?.throwIfAborted()
  }

  private episodePath(
    ctx: Pick<ReviewContext, 'projectPath' | 'episodeNum' | 'projectConfig'>,
    artifact: Parameters<typeof resolveEpisodeArtifactPath>[1]
  ): string {
    return assertPathWithinProject(
      ctx.projectPath,
      resolveEpisodeArtifactPath(
        ctx.projectPath,
        artifact,
        ctx.episodeNum,
        ctx.projectConfig
      )
    )
  }

  private async readRequiredFile(
    filePath: string,
    projectPath: string
  ): Promise<string> {
    const content = await readFile(
      assertPathWithinProject(projectPath, filePath),
      'utf-8'
    )
    if (!content.trim()) throw new Error('所需产物为空，无法生成或审核')
    return content
  }

  private async readOptionalFile(
    filePath: string,
    projectPath: string
  ): Promise<string | undefined> {
    const safePath = assertPathWithinProject(projectPath, filePath)
    try {
      return await readFile(safePath, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  private async readEpisodeSourceNovel(
    projectPath: string,
    episodeNum: number,
    projectConfig?: Partial<ProjectConfig> | null,
    windowMode: 'episode' | 'breakdownBatch' = 'episode'
  ): Promise<string | undefined> {
    const configuredChaptersPerEpisode = Math.max(
      0,
      Number(projectConfig?.chaptersPerEpisode) || 0
    )
    const chapterWindowSize =
      windowMode === 'breakdownBatch'
        ? STORY_BREAKDOWN_CHAPTERS_PER_BATCH
        : configuredChaptersPerEpisode
    const totalEpisodes = Math.max(0, Number(projectConfig?.totalEpisodes) || 0)
    if (chapterWindowSize <= 0)
      return this.readOptionalFile(
        resolveProjectArtifactPath(projectPath, 'sourceNovel', projectConfig),
        projectPath
      )
    if (
      windowMode === 'episode' &&
      totalEpisodes > 0 &&
      episodeNum > totalEpisodes
    )
      return undefined
    const chapters = listSourceChapters({
      projectPath,
      config: (projectConfig || {}) as ProjectConfig
    })
    const maxChapterIndex =
      totalEpisodes > 0 && configuredChaptersPerEpisode > 0
        ? totalEpisodes * configuredChaptersPerEpisode
        : 0
    const scopedChapters =
      maxChapterIndex > 0
        ? chapters.filter((chapter) => chapter.index <= maxChapterIndex)
        : chapters
    const startChapterIndex = (episodeNum - 1) * chapterWindowSize + 1
    const selectedChapters = scopedChapters.filter(
      (chapter) =>
        chapter.index >= startChapterIndex &&
        chapter.index < startChapterIndex + chapterWindowSize
    )
    if (selectedChapters.length === 0)
      return chapters.length === 0
        ? this.readOptionalFile(
            resolveProjectArtifactPath(
              projectPath,
              'sourceNovel',
              projectConfig
            ),
            projectPath
          )
        : undefined
    const contents = await Promise.all(
      selectedChapters.map((chapter) =>
        this.readRequiredFile(chapter.filePath, projectPath)
      )
    )
    return [
      windowMode === 'breakdownBatch'
        ? '# 当前批次小说章节'
        : '# 当前集小说章节',
      '',
      windowMode === 'breakdownBatch'
        ? `> 当前批次：第${episodeNum}批`
        : `> 当前集：EP${String(episodeNum).padStart(2, '0')}`,
      `> ${windowMode === 'breakdownBatch' ? '每批' : '每集'}章节数：${chapterWindowSize}`,
      totalEpisodes > 0
        ? `> 目标总集数：${totalEpisodes}，小说处理上限：第1-${maxChapterIndex}章`
        : '',
      `> 章节范围：${selectedChapters[0].index}-${selectedChapters[selectedChapters.length - 1].index}`,
      '',
      '---',
      '',
      contents.join('\n\n---\n\n')
    ].join('\n')
  }

  private async readAdjacentEpisodeScript(
    ctx: Pick<ReviewContext, 'projectPath' | 'episodeNum' | 'projectConfig'>,
    offset: -1 | 1
  ): Promise<string | undefined> {
    const adjacent = ctx.episodeNum + offset
    if (
      adjacent < 1 ||
      (ctx.projectConfig?.totalEpisodes &&
        adjacent > ctx.projectConfig.totalEpisodes)
    )
      return undefined
    const content = await this.readOptionalFile(
      this.episodePath({ ...ctx, episodeNum: adjacent }, 'script'),
      ctx.projectPath
    )
    return content?.trim()
      ? `# EP${String(adjacent).padStart(2, '0')} ${offset < 0 ? '上一集' : '下一集'}剧本\n\n${content}`
      : undefined
  }
}
