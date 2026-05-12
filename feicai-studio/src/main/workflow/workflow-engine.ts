import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { listSourceChapters } from '../project/novel-importer'
import {
  appendGeneratedStoryToProjectPlotBreakdown,
  getProjectPlotBreakdownMarkdownForEpisode,
  markProjectPlotBreakdownEpisodeStatus
} from '../project/plot-breakdown-store'
import { SkillLoader } from '../engine/skill-loader'
import {
  PromptAssembler,
  type ProjectContext,
  type UpstreamInputs
} from '../engine/prompt-assembler'
import { ReviewEngine } from '../engine/review-engine'
import type { ILLMProvider } from '../llm/types'
import {
  DEFAULT_PIPELINE_SETTINGS,
  type AutomatedPipelineStage,
  type ReviewResult,
  type ReviewStage,
  type ProjectConfig
} from '@shared/types'
import { ArtOutputMerger } from '../engine/art-output-merger'
import { parseAssetMarkdown, serializeAssets } from '../asset/markdown-parser'
import { formatReviewMarkdown } from '@shared/review-artifacts'
import {
  extractPlotBreakdownEntries,
  formatPlotBreakdownEntriesMarkdown
} from '@shared/plot-breakdown'
import { validateScriptHardRules } from '@shared/script-quality'
import {
  describeEpisodeArtifact,
  describeProjectArtifact,
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath
} from '@shared/path-resolver'
import { ROLE_DECLARATIONS, STAGE_SKILL_MAP } from '@shared/constants'

export type WorkflowGenerateStage =
  | AutomatedPipelineStage
  | 'story'
  | 'script'
  | 'character'
export type WorkflowEngineReviewStage = ReviewStage

export interface WorkflowEngineContext {
  projectPath: string
  episodeNum: number
  projectContext: ProjectContext
  projectConfig?: Partial<ProjectConfig> | null
}

export interface WorkflowGenerateOptions {
  reviewFeedback?: string
  timeoutMs?: number
  onChunk?: (chunk: string, totalLength: number) => void
}

export interface WorkflowGenerateResult {
  stage: WorkflowGenerateStage
  outputPath: string
  content: string
  promptMetrics: {
    systemChars: number
    userChars: number
  }
}

export interface WorkflowReviewResult {
  stage: WorkflowEngineReviewStage
  review: ReviewResult
  outputPath?: string
}

const GENERATION_SKILL_MAP: Record<WorkflowGenerateStage, string> = {
  story: 'story-breakdown-skill',
  script: 'script-generation-skill',
  character: 'character-design-skill',
  director: STAGE_SKILL_MAP.director,
  art: STAGE_SKILL_MAP.art,
  storyboard: STAGE_SKILL_MAP.storyboard
}

const GENERATION_ROLE_MAP: Record<WorkflowGenerateStage, string> = {
  story: `🧩 **切换到剧情策划角色**
我现在是一名短剧剧情策划。我负责把上游小说或故事设定，拆成适合单集剧本生成的剧情 beat 文档。我的输出必须强调冲突、转折、节奏、钩子和短剧化改编。`,
  script: `📖 **切换到编剧角色**
我现在是一名短剧编剧。我负责把单集剧情拆解，转化为可直接进入导演分析的完整剧本。我的输出必须包含明确场景、动作、对白、情绪推进和结尾钩子。`,
  character: `🎭 **切换到角色设计师角色**
我现在是一名专业的影视角色设计师。我的核心任务是把剧本与导演讲戏中的角色，沉淀为可复用的角色视觉资产。我的输出必须直接可进入资产库，强调外观识别点、服装层次、材质、妆发、年龄感与镜头识别度。`,
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

const STORY_BREAKDOWN_CHAPTERS_PER_BATCH = 6

export class WorkflowEngine {
  private skillLoader: SkillLoader
  private promptAssembler: PromptAssembler
  private reviewEngine: ReviewEngine
  private llmProvider: ILLMProvider | null = null

  constructor(skillsDir: string) {
    this.skillLoader = new SkillLoader(skillsDir)
    this.promptAssembler = new PromptAssembler()
    this.reviewEngine = new ReviewEngine(this.skillLoader, this.promptAssembler)
  }

  setProvider(provider: ILLMProvider): void {
    this.llmProvider = provider
    this.reviewEngine.setProvider(provider)
  }

  setPassScore(score: number): void {
    this.reviewEngine.setPassScore(score)
  }

  async generateStage(
    stage: WorkflowGenerateStage,
    ctx: WorkflowEngineContext,
    options: WorkflowGenerateOptions = {}
  ): Promise<WorkflowGenerateResult> {
    if (!this.llmProvider) {
      throw new Error('请先配置 LLM Provider')
    }

    const skill = await this.skillLoader.load(GENERATION_SKILL_MAP[stage])
    const inputs = await this.gatherInputs(
      ctx.projectPath,
      ctx.episodeNum,
      ctx.projectConfig,
      stage
    )
    this.assertGenerationPrerequisites(stage, inputs)

    const prompt = this.promptAssembler.assemble(
      skill,
      GENERATION_ROLE_MAP[stage],
      inputs,
      ctx.projectContext,
      PROMPT_STAGE_MAP[stage],
      options.reviewFeedback
    )

    const content = options.onChunk
      ? await this.generateWithStream(prompt, options)
      : await this.llmProvider.generate(prompt)

    const outputPath = await this.writeGenerationOutput(stage, ctx, content)

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
    ctx: Omit<WorkflowEngineContext, 'projectContext'> & { scriptPath?: string }
  ): Promise<WorkflowReviewResult> {
    if (stage === 'story_review') {
      const storyBeat = await this.readRequiredFile(
        resolveEpisodeArtifactPath(
          ctx.projectPath,
          'storyBeat',
          ctx.episodeNum,
          ctx.projectConfig
        )
      )
      const sourceNovel = await this.readEpisodeSourceNovel(
        ctx.projectPath,
        ctx.episodeNum,
        ctx.projectConfig,
        'breakdownBatch'
      )
      const plotBreakdown = formatPlotBreakdownEntriesMarkdown(
        extractPlotBreakdownEntries(storyBeat),
        { heading: '# 当前批次新增剧情点' }
      )
      const review = await this.reviewEngine.reviewContent({
        stage,
        reviewSkillName: 'story-breakdown-review-skill',
        outputToReview: storyBeat,
        originalScript: [plotBreakdown, sourceNovel].filter(Boolean).join('\n\n---\n\n'),
        plotBreakdown
      })
      const outputPath = await this.persistReviewFile(
        '剧情拆解审核',
        review,
        resolveEpisodeArtifactPath(
          ctx.projectPath,
          'storyReview',
          ctx.episodeNum,
          ctx.projectConfig
        )
      )
      if (review.passed && ctx.projectConfig) {
        appendGeneratedStoryToProjectPlotBreakdown({
          projectPath: ctx.projectPath,
          config: ctx.projectConfig as ProjectConfig,
          generatedContent: storyBeat,
          episodeNum: ctx.episodeNum,
          chaptersPerEpisode: STORY_BREAKDOWN_CHAPTERS_PER_BATCH
        })
      }
      return { stage, review, outputPath }
    }

    if (stage === 'script_review') {
      const script = await this.readRequiredFile(
        resolveEpisodeArtifactPath(
          ctx.projectPath,
          'script',
          ctx.episodeNum,
          ctx.projectConfig
        )
      )
      const storyBeat = await this.readOptionalFile(
        resolveEpisodeArtifactPath(
          ctx.projectPath,
          'storyBeat',
          ctx.episodeNum,
          ctx.projectConfig
        )
      )
      const sourceNovel = await this.readEpisodeSourceNovel(
        ctx.projectPath,
        ctx.episodeNum,
        ctx.projectConfig
      )
      const previousScript = await this.readPreviousEpisodeScript(
        ctx.projectPath,
        ctx.episodeNum,
        ctx.projectConfig
      )
      const plotBreakdown =
        ctx.projectConfig && ctx.episodeNum > 0
          ? getProjectPlotBreakdownMarkdownForEpisode({
              projectPath: ctx.projectPath,
              config: ctx.projectConfig as ProjectConfig,
              episodeNum: ctx.episodeNum,
              heading: '# 当前集剧情点'
            })
          : undefined
      const review = await this.reviewEngine.reviewContent({
        stage,
        reviewSkillName: 'script-review-skill',
        outputToReview: script,
        originalScript: [plotBreakdown, storyBeat, sourceNovel, previousScript]
          .filter(Boolean)
          .join('\n\n---\n\n'),
        plotBreakdown
      })
      const hardValidation = validateScriptHardRules(script, {
        ...DEFAULT_PIPELINE_SETTINGS,
        ...(ctx.projectConfig?.pipelineSettings || {})
      })
      if (!hardValidation.passed) {
        review.passed = false
        review.result = 'FAIL'
        review.score = Math.min(review.score, 6)
        review.issues = [...hardValidation.issues, ...review.issues]
        review.feedback = [
          '本地硬校验未通过：',
          ...hardValidation.issues.map((issue) => `- ${issue.description}`),
          '',
          review.feedback
        ].join('\n')
      }
      const outputPath = await this.persistReviewFile(
        '剧本审核',
        review,
        resolveEpisodeArtifactPath(
          ctx.projectPath,
          'scriptReview',
          ctx.episodeNum,
          ctx.projectConfig
        )
      )
      if (review.passed && ctx.projectConfig) {
        markProjectPlotBreakdownEpisodeStatus({
          projectPath: ctx.projectPath,
          config: ctx.projectConfig as ProjectConfig,
          episodeNum: ctx.episodeNum,
          fromStatus: '未用',
          toStatus: '已用'
        })
      }
      return { stage, review, outputPath }
    }

    if (stage === 'storyboard_review') {
      const prompts = await this.readRequiredFile(
        resolveEpisodeArtifactPath(
          ctx.projectPath,
          'seedancePrompts',
          ctx.episodeNum,
          ctx.projectConfig
        )
      )
      const script = await this.readOptionalFile(
        resolveEpisodeArtifactPath(
          ctx.projectPath,
          'script',
          ctx.episodeNum,
          ctx.projectConfig
        )
      )
      const directorAnalysis = await this.readOptionalFile(
        resolveEpisodeArtifactPath(
          ctx.projectPath,
          'directorAnalysis',
          ctx.episodeNum,
          ctx.projectConfig
        )
      )
      const review = await this.reviewEngine.reviewContent({
        stage,
        reviewSkillName: 'seedance-prompt-review-skill',
        outputToReview: prompts,
        originalScript: script,
        directorAnalysis
      })
      const outputPath = await this.persistReviewFile(
        '分镜审核',
        review,
        resolveEpisodeArtifactPath(
          ctx.projectPath,
          'storyboardReview',
          ctx.episodeNum,
          ctx.projectConfig
        )
      )
      return { stage, review, outputPath }
    }

    const review = await this.reviewEngine.review(stage, {
      projectPath: ctx.projectPath,
      episodeNum: ctx.episodeNum,
      scriptPath: ctx.scriptPath,
      projectConfig: ctx.projectConfig
    })
    return { stage, review }
  }

  async gatherInputs(
    projectPath: string,
    episodeNum: number,
    projectConfig?: Partial<ProjectConfig> | null,
    stage?: WorkflowGenerateStage
  ): Promise<UpstreamInputs> {
    const sourceNovel = await this.readEpisodeSourceNovel(
      projectPath,
      episodeNum,
      projectConfig,
      stage === 'story' ? 'breakdownBatch' : 'episode'
    )

    return {
      sourceNovel,
      plotBreakdown:
        projectConfig && episodeNum > 0
          ? getProjectPlotBreakdownMarkdownForEpisode({
              projectPath,
              config: projectConfig as ProjectConfig,
              episodeNum,
              status: '未用',
              heading: '# 当前集未用剧情点'
            })
          : undefined,
      storyBeat: await this.readOptionalFile(
        resolveEpisodeArtifactPath(
          projectPath,
          'storyBeat',
          episodeNum,
          projectConfig
        )
      ),
      previousScript:
        stage === 'script'
          ? await this.readPreviousEpisodeScript(
              projectPath,
              episodeNum,
              projectConfig
            )
          : undefined,
      nextScript:
        stage === 'script'
          ? await this.readNextEpisodeScript(projectPath, episodeNum, projectConfig)
          : undefined,
      script: await this.readOptionalFile(
        resolveEpisodeArtifactPath(
          projectPath,
          'script',
          episodeNum,
          projectConfig
        )
      ),
      directorAnalysis: await this.readOptionalFile(
        resolveEpisodeArtifactPath(
          projectPath,
          'directorAnalysis',
          episodeNum,
          projectConfig
        )
      ),
      characterPrompts: await this.readOptionalFile(
        resolveProjectArtifactPath(
          projectPath,
          'characterPrompts',
          projectConfig
        )
      ),
      scenePrompts: await this.readOptionalFile(
        resolveProjectArtifactPath(projectPath, 'scenePrompts', projectConfig)
      ),
      fullPlotBreakdown: await this.readOptionalFile(
        resolveProjectArtifactPath(projectPath, 'plotBreakdown', projectConfig)
      )
    }
  }

  private assertGenerationPrerequisites(
    stage: WorkflowGenerateStage,
    inputs: UpstreamInputs
  ): void {
    if (stage === 'story' && !inputs.sourceNovel) {
      throw new Error(
        `缺少 ${describeProjectArtifact('sourceNovel')}，请先补齐小说原文或项目设定`
      )
    }
    if (stage === 'script' && !inputs.plotBreakdown) {
      throw new Error('缺少当前集未用剧情点，请先完成剧情库存拆解')
    }
    if (stage === 'character') {
      if (!inputs.script) {
        throw new Error(
          `缺少剧本文件，请先补齐 ${describeEpisodeArtifact('script')}`
        )
      }
      if (!inputs.directorAnalysis) {
        throw new Error(
          `缺少导演分析，请先生成 ${describeEpisodeArtifact('directorAnalysis')}`
        )
      }
    }
  }

  private async writeGenerationOutput(
    stage: WorkflowGenerateStage,
    ctx: WorkflowEngineContext,
    content: string
  ): Promise<string> {
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

    const outputPath = resolveEpisodeArtifactPath(
      ctx.projectPath,
      artifactId,
      ctx.episodeNum,
      ctx.projectConfig
    )
    await this.writeTextFile(outputPath, content)

    if (stage === 'character') {
      await this.mergeCharacterAssets(
        ctx.projectPath,
        content,
        ctx.projectConfig
      )
    }

    if (stage === 'art') {
      await ArtOutputMerger.parseAndMerge(
        content,
        ctx.projectPath,
        ctx.episodeNum
      )
    }

    return outputPath
  }

  private async generateWithStream(
    prompt: { system: string; user: string },
    options: WorkflowGenerateOptions
  ): Promise<string> {
    let output = ''
    let lastChunkTime = Date.now()
    const timeoutMs = options.timeoutMs ?? 90_000

    const stream = this.llmProvider!.generateStream(prompt, {
      onChunk: (chunk) => {
        output += chunk
        lastChunkTime = Date.now()
        options.onChunk?.(chunk, output.length)
      }
    })

    for await (const _chunk of stream) {
      if (Date.now() - lastChunkTime > timeoutMs) {
        throw new Error(
          `LLM 生成超时 (${Math.round(timeoutMs / 1000)}s 无响应)`
        )
      }
    }

    return output
  }

  private async mergeCharacterAssets(
    projectPath: string,
    generatedContent: string,
    projectConfig?: Partial<ProjectConfig> | null
  ): Promise<void> {
    const incoming = parseAssetMarkdown(generatedContent)
    if (incoming.length === 0) {
      throw new Error('角色设计输出缺少标准角色分节，请检查模板格式')
    }

    const assetPath = resolveProjectArtifactPath(
      projectPath,
      'characterPrompts',
      projectConfig
    )
    const existingRaw = await this.readOptionalFile(assetPath)
    const existing = existingRaw ? parseAssetMarkdown(existingRaw) : []
    const merged = [...existing]

    for (const asset of incoming) {
      const index = merged.findIndex((item) => item.name === asset.name)
      if (index >= 0) {
        merged[index] = asset
      } else {
        merged.push(asset)
      }
    }

    await this.writeTextFile(assetPath, serializeAssets(merged))
  }

  private async persistReviewFile(
    title: string,
    review: ReviewResult,
    filePath: string
  ): Promise<string> {
    await this.writeTextFile(filePath, formatReviewMarkdown(title, review))
    return filePath
  }

  private async readRequiredFile(filePath: string): Promise<string> {
    return readFile(filePath, 'utf-8')
  }

  private async readOptionalFile(
    filePath: string
  ): Promise<string | undefined> {
    try {
      return await readFile(filePath, 'utf-8')
    } catch {
      return undefined
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
    const totalEpisodes = Math.max(
      0,
      Number(projectConfig?.totalEpisodes) || 0
    )
    if (chapterWindowSize <= 0) {
      return await this.readOptionalFile(
        resolveProjectArtifactPath(projectPath, 'sourceNovel', projectConfig)
      )
    }

    if (
      windowMode === 'episode' &&
      totalEpisodes > 0 &&
      episodeNum > totalEpisodes
    ) {
      return undefined
    }

    const chapters = listSourceChapters({
      projectPath,
      config: projectConfig as ProjectConfig
    })
    const maxChapterIndex =
      totalEpisodes > 0 && configuredChaptersPerEpisode > 0
        ? totalEpisodes * configuredChaptersPerEpisode
        : 0
    const scopedChapters =
      maxChapterIndex > 0
        ? chapters.filter((chapter) => chapter.index <= maxChapterIndex)
        : chapters
    const startChapterIndex = (Math.max(episodeNum, 1) - 1) * chapterWindowSize + 1
    const endChapterIndex = startChapterIndex + chapterWindowSize - 1
    const selectedChapters = scopedChapters.filter(
      (chapter) =>
        chapter.index >= startChapterIndex && chapter.index <= endChapterIndex
    )
    if (selectedChapters.length === 0) {
      if (chapters.length === 0) {
        return await this.readOptionalFile(
          resolveProjectArtifactPath(projectPath, 'sourceNovel', projectConfig)
        )
      }
      return undefined
    }

    const contents = await Promise.all(
      selectedChapters.map(async (chapter) => {
        const content = await this.readOptionalFile(chapter.filePath)
        return content?.trim() || `# ${chapter.title}\n\n（空章节）`
      })
    )
    const firstChapter = selectedChapters[0]
    const lastChapter = selectedChapters[selectedChapters.length - 1]
    return [
      windowMode === 'breakdownBatch' ? '# 当前批次小说章节' : '# 当前集小说章节',
      '',
      windowMode === 'breakdownBatch'
        ? `> 当前批次：第${episodeNum}批`
        : `> 当前集：EP${String(episodeNum).padStart(2, '0')}`,
      windowMode === 'breakdownBatch'
        ? `> 每批章节数：${chapterWindowSize}`
        : `> 每集章节数：${chapterWindowSize}`,
      totalEpisodes > 0
        ? `> 目标总集数：${totalEpisodes}，小说处理上限：第1-${maxChapterIndex}章`
        : undefined,
      `> 章节范围：${firstChapter.index}-${lastChapter.index}`,
      `> 已选章节数：${selectedChapters.length}`,
      '',
      '---',
      '',
      contents.join('\n\n---\n\n')
    ].join('\n')
  }

  private async readPreviousEpisodeScript(
    projectPath: string,
    episodeNum: number,
    projectConfig?: Partial<ProjectConfig> | null
  ): Promise<string | undefined> {
    if (episodeNum <= 1) return undefined
    const previousEpisodeNum = episodeNum - 1
    const content = await this.readOptionalFile(
      resolveEpisodeArtifactPath(
        projectPath,
        'script',
        previousEpisodeNum,
        projectConfig
      )
    )
    if (!content) return undefined
    return [
      `# EP${String(previousEpisodeNum).padStart(2, '0')} 上一集剧本`,
      '',
      content
    ].join('\n')
  }

  private async readNextEpisodeScript(
    projectPath: string,
    episodeNum: number,
    projectConfig?: Partial<ProjectConfig> | null
  ): Promise<string | undefined> {
    const totalEpisodes = Math.max(0, Number(projectConfig?.totalEpisodes) || 0)
    if (totalEpisodes > 0 && episodeNum >= totalEpisodes) return undefined
    const nextEpisodeNum = episodeNum + 1
    const content = await this.readOptionalFile(
      resolveEpisodeArtifactPath(
        projectPath,
        'script',
        nextEpisodeNum,
        projectConfig
      )
    )
    if (!content) return undefined
    return [
      `# EP${String(nextEpisodeNum).padStart(2, '0')} 下一集剧本`,
      '',
      content
    ].join('\n')
  }

  private async writeTextFile(
    filePath: string,
    content: string
  ): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, 'utf-8')
  }
}
