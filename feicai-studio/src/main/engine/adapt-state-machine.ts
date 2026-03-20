// ============================================================
// Adapt State Machine — 编剧管线状态机引擎
// ============================================================
//
// 状态图:
//   adapt_idle → novel_loaded → breakdown_executing → breakdown_reviewing
//     → (PASS) breakdown_done → [可继续拆解或转创作]
//     → script_executing → script_reviewing
//     → (PASS) script_done
//
//   任何 reviewing 状态:
//     → (FAIL) 回退到对应 executing 状态（自动重试）
//
//   adapt_idle / adapt_error / adapt_paused 为终止状态
//

import { EventEmitter } from 'events'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { v4 as uuid } from 'uuid'
import type {
  AdaptState,
  AdaptStage,
  AdaptContext,
  AdaptSettings,
  WaterLevel,
  ReviewResult,
  LogEntry,
  LLMConfig,
  AssembledPrompt,
  AdaptPlan,
  VolumePlan
} from '@shared/types'
import { DEFAULT_ADAPT_SETTINGS, createDefaultVolumePlan } from '@shared/types'
import { ADAPT_SKILL_MAP, ADAPT_ROLE_DECLARATIONS, ADAPT_BREAKDOWN_ANTIBIAS, ADAPT_SCRIPT_ANTIBIAS } from '@shared/constants'
import { SkillLoader } from './skill-loader'
import { AdaptPromptAssembler, type AdaptUpstreamInputs, type AdaptProjectContext } from './adapt-prompt-assembler'
import { PlotBreakdownParser } from './plot-breakdown-parser'
import { NovelManager } from './novel-manager'
import { createProvider } from '../llm/provider-factory'
import type { ILLMProvider } from '../llm/types'
import { OutputParser } from './output-parser'

const ADAPT_STAGE_STATES: Record<AdaptStage, {
  executing: AdaptState
  reviewing: AdaptState
  done: AdaptState
}> = {
  breakdown: {
    executing: 'breakdown_executing',
    reviewing: 'breakdown_reviewing',
    done: 'breakdown_done'
  },
  script: {
    executing: 'script_executing',
    reviewing: 'script_reviewing',
    done: 'script_done'
  }
}

export class AdaptStateMachine extends EventEmitter {
  private context: AdaptContext
  private skillLoader: SkillLoader
  private promptAssembler: AdaptPromptAssembler
  private breakdownParser: PlotBreakdownParser
  private novelManager: NovelManager
  private llmProvider: ILLMProvider | null = null
  private settings: AdaptSettings = { ...DEFAULT_ADAPT_SETTINGS }
  private _aborted = false
  private _reviewSkipped = false

  constructor(skillsDir: string) {
    super()
    this.skillLoader = new SkillLoader(skillsDir)
    this.promptAssembler = new AdaptPromptAssembler()
    this.breakdownParser = new PlotBreakdownParser()
    this.novelManager = new NovelManager()

    this.context = this.createEmptyContext()
  }

  private createEmptyContext(): AdaptContext {
    return {
      projectId: '',
      projectPath: '',
      currentStage: 'breakdown',
      state: 'adapt_idle',
      retryCount: 0,
      currentBatch: 0,
      chaptersPerBatch: 6,
      totalChapters: 0,
      processedChapters: 0,
      currentScriptBatch: 0,
      waterLevel: {
        unusedPlots: 0,
        unprocessedChapters: 0,
        completedEpisodes: 0,
        totalPlots: 0,
        totalChapters: 0,
        processedChapters: 0
      },
      reviews: [],
      logs: []
    }
  }

  // ==================== Getters ====================

  getState(): AdaptState { return this.context.state }
  getContext(): AdaptContext { return { ...this.context } }
  getWaterLevel(): WaterLevel { return { ...this.context.waterLevel } }

  // ==================== 配置 ====================

  setProvider(config: LLMConfig): void {
    this.llmProvider = createProvider(config)
  }

  setSettings(settings: Partial<AdaptSettings>): void {
    this.settings = { ...DEFAULT_ADAPT_SETTINGS, ...settings }
  }

  // ==================== 状态管理 ====================

  private setState(newState: AdaptState): void {
    const oldState = this.context.state
    this.context.state = newState
    this.log('info', 'state_changed', `状态: ${oldState} → ${newState}`)
    this.emit('stateChanged', { oldState, newState, context: this.getContext() })
  }

  private shouldStop(): boolean {
    return this._aborted ||
      this.context.state === 'adapt_paused' ||
      this.context.state === 'adapt_error' ||
      this.context.state === 'adapt_idle'
  }

  // ==================== 初始化 ====================

  async start(params: {
    projectId: string
    projectPath: string
  }): Promise<void> {
    if (!this.llmProvider) {
      throw new Error('请先配置 LLM Provider')
    }

    this._aborted = false
    this._reviewSkipped = false

    this.context = this.createEmptyContext()
    this.context.projectId = params.projectId
    this.context.projectPath = params.projectPath
    this.context.chaptersPerBatch = this.settings.chaptersPerBatch

    // 扫描小说
    const novelDir = join(params.projectPath, 'novel')
    const scan = await this.novelManager.scanNovelDir(novelDir)
    this.context.totalChapters = scan.totalChapters

    // 加载改编规划（如果存在）
    const plan = await this.loadPlan(params.projectPath)
    if (plan) {
      this.context.adaptPlan = plan
      const activeVol = plan.volumes[plan.activeVolumeIndex]
      if (activeVol) {
        // 用当前卷的章节范围限制 totalChapters
        this.context.totalChapters = Math.min(scan.totalChapters, activeVol.chapterRange[1])
        this.log('info', 'plan_loaded',
          `📋 已加载改编规划: ${activeVol.volumeLabel}（第${activeVol.chapterRange[0]}-${activeVol.chapterRange[1]}章，目标${activeVol.targetEpisodes}集）`)
      }
    }

    // 读取已拆解进度
    this.context.processedChapters = await this.novelManager.getProcessedChapterCount(params.projectPath)

    // 更新水位
    await this.refreshWaterLevel()

    this.setState('novel_loaded')
    this.log('info', 'novel_loaded',
      `📖 小说已加载: ${scan.totalChapters} 章, 已拆解 ${this.context.processedChapters} 章`)
  }

  // ==================== 拆解流程 ====================

  /**
   * 执行剧情拆解（支持批量）
   */
  async executeBreakdown(batchCount: number = 1): Promise<void> {
    if (!this.llmProvider) throw new Error('请先配置 LLM Provider')

    // 获取当前卷的章节范围限制
    const activeVol = this.getActiveVolume()
    const maxChapter = activeVol ? activeVol.chapterRange[1] : this.context.totalChapters

    for (let i = 0; i < batchCount; i++) {
      if (this.shouldStop()) break
      if (this.context.processedChapters >= maxChapter) {
        this.log('info', 'all_chapters_done',
          activeVol
            ? `📚 当前卷（${activeVol.volumeLabel}）章节已全部拆解`
            : '📚 所有章节已拆解完毕')
        break
      }
      await this.executeSingleBreakdown()
    }
  }

  private async executeSingleBreakdown(): Promise<void> {
    this.context.currentStage = 'breakdown'
    this.context.retryCount = 0
    this._reviewSkipped = false

    const startChapter = this.context.processedChapters + 1
    const batchNum = Math.ceil(startChapter / this.context.chaptersPerBatch)
    this.context.currentBatch = batchNum

    // [R3-2] 首批拆解前自动生成改编规划
    if (batchNum === 1) {
      await this.ensureAdaptPlan()
    }

    let passed = false
    while (!passed && this.context.retryCount <= this.settings.breakdownMaxRetries) {
      if (this.shouldStop()) return

      // 1. 执行拆解
      const output = await this.executeBreakdownGeneration(startChapter)
      if (this.shouldStop() || !output) return

      // 2. 质检
      const reviewResult = await this.executeBreakdownReview(output, startChapter)
      if (this.shouldStop()) return

      if (this._reviewSkipped) {
        this._reviewSkipped = false
        passed = true
        break
      }

      if (reviewResult && reviewResult.passed) {
        passed = true
        this.context.lastReviewFeedback = undefined

        // 追加到 plot-breakdown.md
        await this.appendBreakdownOutput(output)

        // 更新已拆解章节数
        this.context.processedChapters = Math.min(
          startChapter + this.context.chaptersPerBatch - 1,
          this.context.totalChapters
        )

        await this.refreshWaterLevel()
        this.setState('breakdown_done')

        // [BUG-1 修复] 从文件读取最新批次的统计（不用 LLM 原始输出）
        const updatedContent = await readFile(
          join(this.context.projectPath, 'plot-breakdown.md'), 'utf-8'
        )
        const fullParsed = this.breakdownParser.parse(updatedContent)
        const lastBatch = fullParsed.batches.find(b => b.batchNumber === batchNum)
        const extractedPlots = lastBatch ? lastBatch.plots.length : 0
        const episodeNums = lastBatch
          ? [...new Set(lastBatch.plots.map(p => p.episode))].sort((a, b) => a - b)
          : []
        const episodeRange = episodeNums.length > 0
          ? `第${episodeNums[0]}-${episodeNums[episodeNums.length - 1]}集`
          : ''

        this.log('info', 'breakdown_complete',
          `✅ 第${batchNum}批拆解完成 (第${startChapter}-${this.context.processedChapters}章) | 提取${extractedPlots}个剧情点 → ${episodeRange}`)
        this.emit('stageComplete', {
          stage: 'breakdown',
          result: reviewResult,
          batchNum,
          chapterRange: [startChapter, this.context.processedChapters],
          extractedPlots,
          episodeRange,
          waterLevel: { ...this.context.waterLevel }
        })
      } else {
        this.context.retryCount++
        this.context.lastReviewFeedback = reviewResult?.feedback || undefined
        if (this.context.retryCount > this.settings.breakdownMaxRetries) {
          this.handleError(`拆解质检失败超过最大重试次数`, null)
          return
        }
        this.log('warn', 'review_fail',
          `❌ 拆解质检未通过 (${reviewResult?.score || 0}分), 重试 ${this.context.retryCount}/${this.settings.breakdownMaxRetries}`)
      }
    }
  }

  private async executeBreakdownGeneration(startChapter: number): Promise<string | null> {
    this.setState('breakdown_executing')
    this.log('info', 'breakdown_start', `📊 开始拆解第${startChapter}-${startChapter + this.context.chaptersPerBatch - 1}章`)

    try {
      // 加载技能
      const skillName = ADAPT_SKILL_MAP.breakdown
      const skill = await this.skillLoader.load(skillName)

      // 读取章节
      const novelDir = join(this.context.projectPath, 'novel')
      const chapters = await this.novelManager.readChapters(
        novelDir, startChapter, this.context.chaptersPerBatch
      )

      // 读取已有拆解
      let plotBreakdown: string | undefined
      try {
        plotBreakdown = await readFile(
          join(this.context.projectPath, 'plot-breakdown.md'), 'utf-8'
        )
      } catch { /* 不存在 */ }

      // 获取小说信息
      const novelInfo = await this.novelManager.getNovelInfo(this.context.projectPath)

      // 组装 Prompt
      const prompt = this.promptAssembler.assembleBreakdown(
        skill,
        ADAPT_ROLE_DECLARATIONS.breakdown,
        {
          novelChapters: chapters,
          plotBreakdown
        },
        {
          novelTitle: novelInfo?.title || '',
          novelGenre: novelInfo?.genre || '',
          totalChapters: this.context.totalChapters,
          processedChapters: this.context.processedChapters,
          currentBatch: this.context.currentBatch
        },
        this.context.lastReviewFeedback,
        this.getActiveVolume()
      )

      // 调用 LLM
      return await this.callLLM('breakdown', prompt)
    } catch (error) {
      this.handleError('拆解执行失败', error)
      return null
    }
  }

  private async executeBreakdownReview(output: string, startChapter: number): Promise<ReviewResult | null> {
    this.setState('breakdown_reviewing')
    this.log('info', 'review_start', '⚠️ 开始拆解质检 (8维度)')

    try {
      // 读取原文用于对比
      const novelDir = join(this.context.projectPath, 'novel')
      const chapters = await this.novelManager.readChapters(
        novelDir, startChapter, this.context.chaptersPerBatch
      )
      const chaptersText = chapters.map(ch => `## 第${ch.chapter}章\n\n${ch.content}`).join('\n\n---\n\n')

      // 加载改编方法论
      const skill = await this.skillLoader.load(ADAPT_SKILL_MAP.breakdown)
      const adaptMethod = skill.methodology || ''

      // 组装审核 Prompt
      const prompt = this.promptAssembler.assembleBreakdownReview(
        ADAPT_BREAKDOWN_ANTIBIAS,
        output,
        chaptersText,
        adaptMethod
      )

      // 调用 LLM 审核
      const reviewOutput = await this.callLLM('breakdown', prompt)
      if (!reviewOutput) return null

      // 解析审核结果
      return this.parseReviewResult('breakdown', reviewOutput)
    } catch (error) {
      this.handleError('拆解质检执行失败', error)
      return null
    }
  }

  // ==================== 剧本创作流程 ====================

  /**
   * 执行剧本创作（支持批量）
   */
  async executeScript(batchCount: number = 1): Promise<void> {
    if (!this.llmProvider) throw new Error('请先配置 LLM Provider')

    for (let i = 0; i < batchCount; i++) {
      if (this.shouldStop()) break

      // 检查是否有未用剧情
      await this.refreshWaterLevel()
      if (this.context.waterLevel.unusedPlots === 0) {
        this.log('info', 'no_unused_plots', '📝 无未用剧情点，请先执行拆解')
        break
      }

      await this.executeSingleScript()
    }
  }

  private async executeSingleScript(): Promise<void> {
    this.context.currentStage = 'script'
    this.context.retryCount = 0
    this._reviewSkipped = false
    // [BUG-5 修复] 不在此处递增，等成功后再增

    let passed = false
    while (!passed && this.context.retryCount <= this.settings.scriptMaxRetries) {
      if (this.shouldStop()) return

      // 1. 生成
      const output = await this.executeScriptGeneration()
      if (this.shouldStop() || !output) return

      // 2. 质检
      const reviewResult = await this.executeScriptReview(output)
      if (this.shouldStop()) return

      if (this._reviewSkipped) {
        this._reviewSkipped = false
        passed = true
        break
      }

      if (reviewResult && reviewResult.passed) {
        passed = true
        this.context.lastReviewFeedback = undefined

        // 写入剧本文件 + 更新状态
        await this.writeScriptOutput(output)
        await this.refreshWaterLevel()
        this.setState('script_done')
        this.context.currentScriptBatch++ // [BUG-5] 成功后才递增

        // [R3-3] 结构化通知
        const epRange = this._lastTargetEpisodes.length > 0
          ? `第${Math.min(...this._lastTargetEpisodes)}-${Math.max(...this._lastTargetEpisodes)}集`
          : ''
        this.log('info', 'script_complete',
          `✅ ${epRange}创作完成 | ${this._lastTargetEpisodes.length}集 | 水位：未用${this.context.waterLevel.unusedPlots}个`)
        this.emit('stageComplete', {
          stage: 'script',
          result: reviewResult,
          episodeRange: epRange,
          episodeCount: this._lastTargetEpisodes.length,
          waterLevel: { ...this.context.waterLevel }
        })

        // 阶段自动升级：剧本产出后通知项目进入制作阶段
        this.emit('phaseUpgrade', {
          projectId: this.context.projectId,
          projectPath: this.context.projectPath
        })
      } else {
        this.context.retryCount++
        this.context.lastReviewFeedback = reviewResult?.feedback || undefined
        if (this.context.retryCount > this.settings.scriptMaxRetries) {
          this.handleError('剧本质检失败超过最大重试次数', null)
          return
        }
      }
    }
  }

  private _lastTargetEpisodes: number[] = []
  private _lastTargetPlotIds: number[] = []

  private async executeScriptGeneration(): Promise<string | null> {
    this.setState('script_executing')
    this.log('info', 'script_start', '✍️ 开始剧本创作')

    try {
      const skill = await this.skillLoader.load(ADAPT_SKILL_MAP.script)

      // 读取拆解文件，获取未用剧情点
      const breakdownContent = await readFile(
        join(this.context.projectPath, 'plot-breakdown.md'), 'utf-8'
      )
      const plotsByEp = this.breakdownParser.getUnusedPlotsByEpisode(breakdownContent)
      const targetEpisodes = Object.keys(plotsByEp)
        .map(Number).sort((a, b) => a - b)
        .slice(0, this.settings.maxEpisodesPerBatch)

      if (targetEpisodes.length === 0) {
        this.log('info', 'no_more_plots', '无更多未用剧情点')
        return null
      }

      // 记录本批次目标集数和剧情点ID（用于后续状态更新）
      this._lastTargetEpisodes = targetEpisodes
      const targetPlots = targetEpisodes.flatMap(ep => plotsByEp[ep] || [])
      this._lastTargetPlotIds = targetPlots.map(p => p.id)

      // 获取对应剧情点文本
      const plotPointsText = targetPlots
        .map(p => `【剧情${p.id}】${p.scene}，${p.description}，${p.hookType}，第${p.episode}集，状态：未用`)
        .join('\n')

      // 读取上一集剧本
      let previousScript: string | undefined
      if (targetEpisodes[0] > 1) {
        const prevEp = String(targetEpisodes[0] - 1).padStart(3, '0')
        try {
          previousScript = await readFile(
            join(this.context.projectPath, 'script', `ep${prevEp}.md`), 'utf-8'
          )
        } catch { /* 不存在 */ }
      }

      // [P2-13 修复] 读取对应章节原文（根据目标剧情点所属批次反查章节范围）
      const novelDir = join(this.context.projectPath, 'novel')
      const novelInfo = await this.novelManager.getNovelInfo(this.context.projectPath)
      const batchNums = [...new Set(targetPlots.map(p => p.batch))]
      let novelChapters: Array<{ chapter: number; content: string }> = []
      for (const batchNum of batchNums) {
        const startCh = (batchNum - 1) * this.context.chaptersPerBatch + 1
        const chs = await this.novelManager.readChapters(novelDir, startCh, this.context.chaptersPerBatch)
        novelChapters = novelChapters.concat(chs)
      }

      const prompt = this.promptAssembler.assembleScript(
        skill,
        ADAPT_ROLE_DECLARATIONS.script,
        {
          plotBreakdown: breakdownContent,
          previousScript,
          plotPointsForBatch: plotPointsText,
          novelChapters
        },
        {
          novelTitle: novelInfo?.title || '',
          novelGenre: novelInfo?.genre || '',
          totalChapters: this.context.totalChapters,
          processedChapters: this.context.processedChapters,
          currentBatch: this.context.currentScriptBatch
        },
        targetEpisodes,
        this.context.lastReviewFeedback,
        this.getActiveVolume()
      )

      return await this.callLLM('script', prompt)
    } catch (error) {
      this.handleError('剧本创作执行失败', error)
      return null
    }
  }

  private async executeScriptReview(output: string): Promise<ReviewResult | null> {
    this.setState('script_reviewing')
    this.log('info', 'review_start', '⚠️ 开始剧本质检 (11维度)')

    try {
      const breakdownContent = await readFile(
        join(this.context.projectPath, 'plot-breakdown.md'), 'utf-8'
      )

      // 读取对应章节小说原文
      const novelDir = join(this.context.projectPath, 'novel')
      const { allPlots } = this.breakdownParser.parse(breakdownContent)
      const targetPlots = allPlots.filter(p => this._lastTargetEpisodes.includes(p.episode))
      const batchNums = [...new Set(targetPlots.map(p => p.batch))]
      let chaptersText = ''
      for (const batchNum of batchNums) {
        const startCh = (batchNum - 1) * this.context.chaptersPerBatch + 1
        const chs = await this.novelManager.readChapters(novelDir, startCh, this.context.chaptersPerBatch)
        chaptersText += chs.map(ch => `## 第${ch.chapter}章\n\n${ch.content}`).join('\n\n---\n\n')
      }

      // [DA-2] 加载 adapt-method.md
      const skill = await this.skillLoader.load(ADAPT_SKILL_MAP.script)
      const adaptMethod = skill.methodology || ''

      // [DA-3] 读取上一集剧本（跨集连贯性）
      let previousScript: string | undefined
      const minEp = Math.min(...this._lastTargetEpisodes)
      if (minEp > 1) {
        const prevEp = String(minEp - 1).padStart(3, '0')
        try {
          previousScript = await readFile(
            join(this.context.projectPath, 'script', `ep${prevEp}.md`), 'utf-8'
          )
        } catch { /* 不存在 */ }
      }

      const prompt = this.promptAssembler.assembleScriptReview(
        ADAPT_SCRIPT_ANTIBIAS,
        output,
        breakdownContent,
        chaptersText,
        adaptMethod,
        previousScript,
        this._lastTargetEpisodes
      )

      const reviewOutput = await this.callLLM('script', prompt)
      if (!reviewOutput) return null

      return this.parseReviewResult('script', reviewOutput)
    } catch (error) {
      this.handleError('剧本质检执行失败', error)
      return null
    }
  }

  // ==================== 全自动模式 ====================

  async executeAuto(): Promise<void> {
    this.log('info', 'auto_start', '🚀 全自动模式启动')

    // [R4-3] 水位驱动交替策略：剧情≥ ⇒创作，<6⇒拆解，循环
    while (!this.shouldStop()) {
      await this.refreshWaterLevel()
      const wl = this.context.waterLevel

      if (wl.unusedPlots === 0 && wl.unprocessedChapters === 0) {
        this.log('info', 'auto_complete', '🎉 全自动模式完成，所有章节已拆解并创作为剧本')
        this.emit('stageComplete', {
          stage: 'auto',
          summary: `全自动完成：${wl.totalPlots}个剧情点，${wl.completedEpisodes}集剧本`,
          waterLevel: { ...this.context.waterLevel }
        })
        break
      }

      if (wl.unusedPlots >= 6) {
        // 剧情充足，优先创作消耗剧情
        await this.executeSingleScript()
      } else if (wl.unprocessedChapters > 0) {
        // 剧情不足，拆解补充
        await this.executeSingleBreakdown()
      } else if (wl.unusedPlots > 0) {
        // 无新章可拆，消耗剩余剧情
        await this.executeSingleScript()
      } else {
        break
      }
    }
  }

  // [DA-7] 独立自动模式
  async executeBreakdownAuto(): Promise<void> {
    this.log('info', 'breakdown_auto_start', '📊 独立拆解自动模式启动')
    let batchCount = 0

    while (!this.shouldStop()) {
      await this.refreshWaterLevel()
      if (this.context.waterLevel.unprocessedChapters <= 0) {
        this.log('info', 'breakdown_auto_done',
          `📊 拆解自动完成，共拆解 ${batchCount} 批`)
        this.emit('stageComplete', {
          stage: 'breakdown',
          summary: `独立拆解完成：${batchCount}批`,
          waterLevel: { ...this.context.waterLevel }
        })
        break
      }
      await this.executeSingleBreakdown()
      batchCount++
    }
  }

  async executeScriptAuto(): Promise<void> {
    this.log('info', 'script_auto_start', '✍️ 独立创作自动模式启动')
    let batchCount = 0

    while (!this.shouldStop()) {
      await this.refreshWaterLevel()
      if (this.context.waterLevel.unusedPlots <= 0) {
        this.log('info', 'script_auto_done',
          `✍️ 创作自动完成，共创作 ${batchCount} 批`)
        this.emit('stageComplete', {
          stage: 'script',
          summary: `独立创作完成：${batchCount}批`,
          waterLevel: { ...this.context.waterLevel }
        })
        break
      }
      await this.executeSingleScript()
      batchCount++
    }
  }

  // [DA-4] 改编规划自动生成
  async ensureAdaptPlan(): Promise<void> {
    // [BUG-4 修复] 检查 llmProvider
    if (!this.llmProvider) {
      this.log('warn', 'no_provider', '请先配置 LLM Provider')
      return
    }
    const breakdownPath = join(this.context.projectPath, 'plot-breakdown.md')
    let content: string
    try {
      content = await readFile(breakdownPath, 'utf-8')
    } catch {
      this.log('warn', 'no_breakdown', 'plot-breakdown.md 不存在，请先初始化项目')
      return
    }

    // [BUG-12 修复] 宽松检查已有规划（与前端 BUG-8 保持一致）
    if (
      content.includes('## 改编规划') ||
      content.includes('## 改编方向') ||
      content.includes('## 改编计划') ||
      content.toLowerCase().includes('## adaptation plan')
    ) {
      return // 已有规划
    }

    this.log('info', 'adapt_plan_start', '📋 生成改编规划...')

    const skill = await this.skillLoader.load(ADAPT_SKILL_MAP.breakdown)
    const novelInfo = await this.novelManager.getNovelInfo(this.context.projectPath)
    const novelDir = join(this.context.projectPath, 'novel')

    // 取前3章作为样本分析
    const sampleChapters = await this.novelManager.readChapters(novelDir, 1, 3)
    const sampleText = sampleChapters
      .map(ch => `## 第${ch.chapter}章\n\n${ch.content.substring(0, 2000)}...`)
      .join('\n\n---\n\n')

    const prompt: AssembledPrompt = {
      system: [
        ADAPT_ROLE_DECLARATIONS.breakdown,
        skill.methodology ? `\n---\n\n# 改编方法论\n\n${skill.methodology}` : ''
      ].join('\n\n'),
      user: [
        `# 任务：生成改编规划`,
        `\n小说名称：《${novelInfo?.title || ''}》`,
        `小说类型：${novelInfo?.genre || ''}`,
        `总章节数：${this.context.totalChapters}`,
        `\n---\n\n# 小说开头样本（前3章摘要）\n\n${sampleText}`,
        `\n---\n\n请基于以上信息，生成一份简洁的改编规划，包含：`,
        `1. **改编方向**：整体改编风格和侧重点`,
        `2. **核心卖点**：小说最吸引人的元素（用于漫剧放大）`,
        `3. **改编策略**：针对该类型的特殊处理方式`,
        `4. **预估规模**：预估可拆解的总集数范围`,
        `\n输出格式：## 改编规划\n然后4个小节`
      ].join('\n\n')
    }

    const planOutput = await this.callLLM('breakdown', prompt)
    if (planOutput) {
      const updatedContent = content + '\n\n' + planOutput.trim() + '\n\n---\n'
      await writeFile(breakdownPath, updatedContent, 'utf-8')
      this.log('info', 'adapt_plan_done', '📋 改编规划已生成并写入 plot-breakdown.md')
    }
  }

  // ==================== 改编规划管理 ====================

  /** 获取当前活跃卷规划 */
  getActiveVolume(): VolumePlan | null {
    const plan = this.context.adaptPlan
    if (!plan || plan.volumes.length === 0) return null
    return plan.volumes[plan.activeVolumeIndex] || null
  }

  /** 从 adapt-plan.json 加载改编规划 */
  async loadPlan(projectPath: string): Promise<AdaptPlan | null> {
    try {
      const planPath = join(projectPath, 'adapt-plan.json')
      const raw = await readFile(planPath, 'utf-8')
      return JSON.parse(raw) as AdaptPlan
    } catch {
      return null // 文件不存在
    }
  }

  /** 保存改编规划到 adapt-plan.json */
  async savePlan(projectPath: string, plan: AdaptPlan): Promise<void> {
    const planPath = join(projectPath, 'adapt-plan.json')
    plan.updatedAt = new Date().toISOString()
    await writeFile(planPath, JSON.stringify(plan, null, 2), 'utf-8')

    // 同步写入 plot-breakdown.md 头部
    await this.syncPlanToBreakdown(projectPath, plan)
  }

  /** 将规划摘要同步到 plot-breakdown.md */
  private async syncPlanToBreakdown(projectPath: string, plan: AdaptPlan): Promise<void> {
    const breakdownPath = join(projectPath, 'plot-breakdown.md')
    try {
      let content = ''
      try { content = await readFile(breakdownPath, 'utf-8') } catch { /* */ }

      // 构建规划摘要文本
      const activeVol = plan.volumes[plan.activeVolumeIndex]
      if (!activeVol) return

      const planSection = [
        `## 改编规划`,
        ``,
        `**改编范围**：第${activeVol.chapterRange[0]}-${activeVol.chapterRange[1]}章（${activeVol.volumeLabel}）`,
        `**目标集数**：${activeVol.targetEpisodes}集`,
        `**单集规格**：${activeVol.episodeWordCount[0]}-${activeVol.episodeWordCount[1]}字，${activeVol.plotsPerEpisode[0]}-${activeVol.plotsPerEpisode[1]}个剧情点，${activeVol.scenesPerEpisode[0]}-${activeVol.scenesPerEpisode[1]}个场景，${activeVol.seedancePerEpisode[0]}-${activeVol.seedancePerEpisode[1]}个Seedance段`,
        `**章集分配**：${activeVol.chapterAllocation}`,
        activeVol.additionalNotes ? `**附加要求**：${activeVol.additionalNotes}` : '',
        ``,
        activeVol.llmPlan || '',
      ].filter(Boolean).join('\n')

      // 替换或插入改编规划段落
      const planRegex = /## (?:改编规划|改编方向|改编计划|Adaptation Plan)\s*\n[\s\S]*?(?=\n## |\n---\s*$|$)/im
      if (planRegex.test(content)) {
        content = content.replace(planRegex, planSection)
      } else if (content.includes('---')) {
        // 插入到第一个 --- 之后
        const firstSep = content.indexOf('---')
        const insertPos = content.indexOf('\n', firstSep) + 1
        content = content.substring(0, insertPos) + '\n' + planSection + '\n\n---\n' + content.substring(insertPos)
      } else {
        content += '\n\n' + planSection + '\n\n---\n'
      }

      await writeFile(breakdownPath, content, 'utf-8')
    } catch (err) {
      console.error('[syncPlanToBreakdown] 写入失败:', err)
    }
  }

  /** LLM 辅助生成单卷规划 */
  async generateVolumePlan(projectPath: string, volumePlan: VolumePlan): Promise<string> {
    if (!this.llmProvider) throw new Error('请先配置 LLM Provider')

    const novelDir = join(projectPath, 'novel')
    const novelInfo = await this.novelManager.getNovelInfo(projectPath)

    // 读取卷范围内的前3章作为样本
    const sampleStart = volumePlan.chapterRange[0]
    const sampleChapters = await this.novelManager.readChapters(novelDir, sampleStart, 3)
    const sampleText = sampleChapters
      .map(ch => `## 第${ch.chapter}章\n\n${ch.content.substring(0, 2000)}...`)
      .join('\n\n---\n\n')

    const skill = await this.skillLoader.load(ADAPT_SKILL_MAP.breakdown)

    const prompt: AssembledPrompt = {
      system: [
        ADAPT_ROLE_DECLARATIONS.breakdown,
        skill.methodology ? `\n---\n\n# 改编方法论\n\n${skill.methodology}` : ''
      ].join('\n\n'),
      user: [
        `# 任务：基于用户参数生成改编规划`,
        `\n## 小说信息`,
        `- 小说名称：《${novelInfo?.title || ''}》`,
        `- 小说类型：${novelInfo?.genre || ''}`,
        `- 总章节数：${novelInfo?.totalChapters || 0}`,
        `\n## 用户设定的改编参数`,
        `- 改编范围：第${volumePlan.chapterRange[0]}-${volumePlan.chapterRange[1]}章（${volumePlan.volumeLabel}）`,
        `- 目标集数：${volumePlan.targetEpisodes}集`,
        `- 单集字数：${volumePlan.episodeWordCount[0]}-${volumePlan.episodeWordCount[1]}字`,
        `- 每集剧情点：${volumePlan.plotsPerEpisode[0]}-${volumePlan.plotsPerEpisode[1]}个`,
        `- 每集场景：${volumePlan.scenesPerEpisode[0]}-${volumePlan.scenesPerEpisode[1]}个`,
        `- 每集 Seedance 段：${volumePlan.seedancePerEpisode[0]}-${volumePlan.seedancePerEpisode[1]}个`,
        `- 章集分配原则：${volumePlan.chapterAllocation}`,
        volumePlan.additionalNotes ? `- 附加要求：${volumePlan.additionalNotes}` : '',
        `\n---\n\n# 小说样本（改编范围开头3章摘要）\n\n${sampleText}`,
        `\n---\n\n请基于以上用户参数和小说内容，生成一份详细的改编规划，包含：`,
        `1. **改编方向**：整体改编风格和侧重点（结合小说类型和用户设定）`,
        `2. **核心卖点**：小说最吸引人的元素（用于漫剧放大）`,
        `3. **改编策略**：针对该类型和用户指定规格的特殊处理方式`,
        `4. **章节分组建议**：基于目标${volumePlan.targetEpisodes}集，粗略划分章节组（每组对应大约几集）`,
        `5. **节奏规划**：前期、中期、后期的节奏建议`,
        `\n输出纯 Markdown，不需要标题前缀。`
      ].filter(Boolean).join('\n')
    }

    const output = await this.callLLM('breakdown', prompt)
    return output || ''
  }

  // [DA-6] 内容修订流程
  async reviseEpisode(episodeNum: number, revisionNotes: string): Promise<void> {
    if (!this.llmProvider) throw new Error('请先配置 LLM Provider')

    this.log('info', 'revise_start', `📝 修订第${episodeNum}集：${revisionNotes.substring(0, 50)}...`)

    try {
      const epStr = String(episodeNum).padStart(3, '0')
      const scriptPath = join(this.context.projectPath, 'script', `ep${epStr}.md`)
      const originalScript = await readFile(scriptPath, 'utf-8')

      const breakdownContent = await readFile(
        join(this.context.projectPath, 'plot-breakdown.md'), 'utf-8'
      )

      const skill = await this.skillLoader.load(ADAPT_SKILL_MAP.script)

      const prompt: AssembledPrompt = {
        system: [
          ADAPT_ROLE_DECLARATIONS.script,
          skill.methodology ? `\n---\n\n# 改编方法论\n\n${skill.methodology}` : '',
          skill.guides?.['output-style'] ? `\n---\n\n# 写作风格\n\n${skill.guides['output-style']}` : ''
        ].join('\n\n'),
        user: [
          `# 任务：修订第${episodeNum}集剧本`,
          `\n## 修改意见\n\n${revisionNotes}`,
          `\n---\n\n## 当前剧本\n\n${originalScript}`,
          `\n---\n\n## 剧情拆解（参考）\n\n${breakdownContent}`,
          `\n---\n\n请根据修改意见对剧本进行精准修改，保持其他部分不变。输出完整的修改后剧本。`
        ].join('\n\n')
      }

      this.setState('script_executing')
      const revisedOutput = await this.callLLM('script', prompt)
      if (!revisedOutput || this.shouldStop()) return

      // 质检修订后的内容
      this._lastTargetEpisodes = [episodeNum]
      const reviewResult = await this.executeScriptReview(revisedOutput)

      if (reviewResult && reviewResult.passed) {
        await writeFile(scriptPath, revisedOutput.trim(), 'utf-8')
        this.setState('script_done')
        this.log('info', 'revise_done', `✅ 第${episodeNum}集修订完成并通过质检`)

        // 检查是否影响拆解
        if (revisionNotes.includes('剧情') || revisionNotes.includes('拆解') || revisionNotes.includes('改设定')) {
          this.log('warn', 'revise_impact', `⚠️ 修改可能影响剧情拆解，建议检查 plot-breakdown.md 一致性`)
        }

        this.emit('stageComplete', {
          stage: 'revision',
          summary: `第${episodeNum}集修订完成`,
          result: reviewResult,
          waterLevel: { ...this.context.waterLevel }
        })
      } else {
        this.log('warn', 'revise_fail', `❌ 第${episodeNum}集修订未通过质检`)
      }
    } catch (error) {
      this.handleError(`修订第${episodeNum}集失败`, error)
    }
  }

  // ==================== LLM 调用 ====================

  private async callLLM(stage: AdaptStage, prompt: AssembledPrompt): Promise<string | null> {
    this.log('info', 'llm_calling', `调用 LLM 生成中...`)
    let output = ''
    let lastChunkTime = Date.now()
    const TIMEOUT_MS = 90_000

    try {
      const stream = this.llmProvider!.generateStream(prompt, {
        onChunk: (chunk) => {
          output += chunk
          lastChunkTime = Date.now()
          this.emit('stream', { stage, chunk, totalLength: output.length })
        }
      })

      // [BUG-3 修复] 用 Promise.race 实现超时主动终止
      const consumeStream = async () => {
        for await (const _chunk of stream) {
          if (this.shouldStop()) return 'stopped'
        }
        return 'done'
      }

      const timeoutPromise = new Promise<string>((_, reject) => {
        const checker = setInterval(() => {
          if (Date.now() - lastChunkTime > TIMEOUT_MS) {
            clearInterval(checker)
            reject(new Error(`LLM 超时 (${TIMEOUT_MS / 1000}s 无响应)`))
          }
        }, 5000)
        // 如果 stream 正常结束，也清理 checker
        consumeStream().then(() => clearInterval(checker)).catch(() => clearInterval(checker))
      })

      const result = await Promise.race([
        consumeStream(),
        timeoutPromise
      ])

      if (result === 'stopped') return null

      this.log('info', 'llm_complete', `LLM 完成 (${output.length} chars)`)
      return output
    } catch (error) {
      this.handleError('LLM 调用失败', error)
      return null
    }
  }

  // ==================== 文件操作 ====================

  private async appendBreakdownOutput(output: string): Promise<void> {
    const breakdownPath = join(this.context.projectPath, 'plot-breakdown.md')
    try {
      let existing = ''
      try { existing = await readFile(breakdownPath, 'utf-8') } catch { /* */ }
      const updated = this.breakdownParser.appendBatch(existing, output)
      await writeFile(breakdownPath, updated, 'utf-8')
      this.log('info', 'file_written', `拆解已追加到 plot-breakdown.md`)
    } catch (error) {
      this.handleError('写入拆解文件失败', error)
    }
  }

  private async writeScriptOutput(output: string): Promise<void> {
    const scriptDir = join(this.context.projectPath, 'script')
    await mkdir(scriptDir, { recursive: true })

    // [R3-5] 加强多集分割逻辑
    // 优先匹配 `# 第N集：` 或 `# 第N集:`
    const episodePattern = /^# 第(\d+)集[：:]/gm
    let match: RegExpExecArray | null
    const positions: Array<{ episode: number; start: number }> = []

    while ((match = episodePattern.exec(output)) !== null) {
      positions.push({ episode: parseInt(match[1]), start: match.index })
    }

    // 备用：尝试 `## 第N集` 格式
    if (positions.length === 0) {
      const altPattern = /^## 第(\d+)集[：:]/gm
      while ((match = altPattern.exec(output)) !== null) {
        positions.push({ episode: parseInt(match[1]), start: match.index })
      }
    }

    // 单集 fallback：如果完全没有分割标记，用 _lastTargetEpisodes 的第一集
    if (positions.length === 0 && this._lastTargetEpisodes.length > 0) {
      positions.push({ episode: this._lastTargetEpisodes[0], start: 0 })
    }

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i]
      const end = i + 1 < positions.length ? positions[i + 1].start : output.length
      const scriptContent = output.substring(pos.start, end).trim()

      const epStr = String(pos.episode).padStart(3, '0')
      const scriptPath = join(scriptDir, `ep${epStr}.md`)
      await writeFile(scriptPath, scriptContent, 'utf-8')
      this.log('info', 'file_written', `剧本已写入: script/ep${epStr}.md`)
    }

    // 更新剧情点状态为已用
    if (this._lastTargetPlotIds.length > 0) {
      const breakdownPath = join(this.context.projectPath, 'plot-breakdown.md')
      try {
        const content = await readFile(breakdownPath, 'utf-8')
        const updated = this.breakdownParser.markPlotsAsUsed(content, this._lastTargetPlotIds)
        await writeFile(breakdownPath, updated, 'utf-8')
        this.log('info', 'status_updated',
          `已更新 ${this._lastTargetPlotIds.length} 个剧情点状态为"已用"`)
        this._lastTargetPlotIds = []
      } catch { /* */ }
    }
  }

  // ==================== 水位更新 ====================

  private async refreshWaterLevel(): Promise<void> {
    this.context.waterLevel = await this.breakdownParser.getWaterLevelFromFile(
      this.context.projectPath,
      this.context.totalChapters
    )
  }

  // ==================== 审核结果解析 ====================

  private parseReviewResult(stage: AdaptStage, output: string): ReviewResult {
    // 解析 PASS/FAIL
    const passMatch = output.match(/(?:结论|判定)[：:]\s*(PASS|FAIL)/i)
    const scoreMatch = output.match(/(?:总评分|评分|得分)[：:]\s*(\d+(?:\.\d+)?)/i)

    const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0

    // [BUG-6 修复] 如果没匹配到 PASS/FAIL 关键词，用 score 兆底判断
    const passScore = stage === 'breakdown'
      ? this.settings.breakdownPassScore
      : this.settings.scriptPassScore
    let passed: boolean
    if (passMatch) {
      passed = passMatch[1].toUpperCase() === 'PASS'
    } else {
      // 兆底：score >= 阈值 则通过
      passed = score >= passScore
    }
    if (score === 0 && passed) {
      // 有 PASS 但无评分，默认 8 分
    }
    const finalScore = score > 0 ? score : (passed ? 8 : 5)

    const result: ReviewResult = {
      stage: stage as any,
      reviewType: 'business',
      result: passed ? 'PASS' : 'FAIL',
      passed,
      score: finalScore,
      feedback: output,
      issues: [],
      createdAt: new Date().toISOString()
    }

    this.context.reviews.push(result)
    this.emit('reviewResult', { stage, result })
    return result
  }

  // ==================== P1 新增功能 ====================

  /**
   * [P1-4] 类型确定阶段：创建 plot-breakdown.md 头部
   */
  async initProject(params: {
    novelTitle: string
    novelGenre: string
    projectPath: string
  }): Promise<void> {
    const breakdownPath = join(params.projectPath, 'plot-breakdown.md')

    // 检查是否已存在
    try {
      await readFile(breakdownPath, 'utf-8')
      this.log('info', 'init_exists', 'plot-breakdown.md 已存在，跳过初始化')
      return
    } catch { /* 不存在，继续创建 */ }

    const header = [
      `# 剧情拆解 + 分集标注`,
      ``,
      `**小说名称**：《${params.novelTitle}》`,
      `**小说类型**：${params.novelGenre}`,
      ``,
      `---`,
      ``
    ].join('\n')

    await writeFile(breakdownPath, header, 'utf-8')
    this.log('info', 'init_done', `✅ 已创建 plot-breakdown.md（${params.novelTitle} · ${params.novelGenre}）`)
  }

  /**
   * [P1-6] 重新创作指定集
   */
  async reCreateEpisode(episodeNum: number): Promise<void> {
    if (!this.llmProvider) throw new Error('请先配置 LLM Provider')
    this.context.currentStage = 'script'
    this.context.retryCount = 0
    this._reviewSkipped = false

    this.log('info', 're_script_start', `🔄 重新创作第${episodeNum}集`)

    try {
      const skill = await this.skillLoader.load(ADAPT_SKILL_MAP.script)

      // 读取拆解文件
      const breakdownContent = await readFile(
        join(this.context.projectPath, 'plot-breakdown.md'), 'utf-8'
      )
      const { allPlots } = this.breakdownParser.parse(breakdownContent)
      const episodePlots = allPlots.filter(p => p.episode === episodeNum)

      if (episodePlots.length === 0) {
        this.log('warn', 're_no_plots', `第${episodeNum}集没有对应剧情点`)
        return
      }

      this._lastTargetEpisodes = [episodeNum]
      this._lastTargetPlotIds = episodePlots.map(p => p.id)

      const plotPointsText = episodePlots
        .map(p => `【剧情${p.id}】${p.scene}，${p.description}，${p.hookType}，第${p.episode}集`)
        .join('\n')

      // [R3-1] 读取上一集和下一集确保连贯
      let previousScript: string | undefined
      let nextScript: string | undefined
      if (episodeNum > 1) {
        const prevEp = String(episodeNum - 1).padStart(3, '0')
        try {
          previousScript = await readFile(
            join(this.context.projectPath, 'script', `ep${prevEp}.md`), 'utf-8'
          )
        } catch { /* */ }
      }
      // 下一集
      const nextEpStr = String(episodeNum + 1).padStart(3, '0')
      try {
        nextScript = await readFile(
          join(this.context.projectPath, 'script', `ep${nextEpStr}.md`), 'utf-8'
        )
      } catch { /* */ }

      // 读取对应章节原文
      const novelDir = join(this.context.projectPath, 'novel')
      const novelInfo = await this.novelManager.getNovelInfo(this.context.projectPath)
      const batchNums = [...new Set(episodePlots.map(p => p.batch))]
      let novelChapters: Array<{ chapter: number; content: string }> = []
      for (const bn of batchNums) {
        const startCh = (bn - 1) * this.context.chaptersPerBatch + 1
        const chs = await this.novelManager.readChapters(novelDir, startCh, this.context.chaptersPerBatch)
        novelChapters = novelChapters.concat(chs)
      }

      // 将下一集摘要注入 prompt（如果存在）
      const upstreamInputs: any = {
        plotBreakdown: breakdownContent,
        previousScript,
        plotPointsForBatch: plotPointsText,
        novelChapters
      }

      const prompt = this.promptAssembler.assembleScript(
        skill,
        ADAPT_ROLE_DECLARATIONS.script,
        upstreamInputs,
        {
          novelTitle: novelInfo?.title || '',
          novelGenre: novelInfo?.genre || '',
          totalChapters: this.context.totalChapters,
          processedChapters: this.context.processedChapters,
          currentBatch: 0
        },
        [episodeNum],
        undefined,
        this.getActiveVolume()
      )

      // [BUG-14 修复] 重创不需要改变剧情点状态（已是"已用"）
      this._lastTargetPlotIds = []

      // [R3-1] 如有下一集，在 user prompt 末尾追加
      if (nextScript) {
        prompt.user += `\n\n---\n\n# 下一集剧本（确保连贯衔接）\n\n${nextScript}`
      }

      this.setState('script_executing')
      const output = await this.callLLM('script', prompt)
      if (!output || this.shouldStop()) return

      // 质检
      const reviewResult = await this.executeScriptReview(output)
      if (reviewResult && reviewResult.passed) {
        await this.writeScriptOutput(output)
        this.setState('script_done')
        this.log('info', 're_complete', `✅ 第${episodeNum}集重新创作完成`)
        this.emit('stageComplete', { stage: 'script', result: reviewResult })
      } else {
        this.log('warn', 're_fail', `❌ 第${episodeNum}集重创质检未通过`)
      }
    } catch (error) {
      this.handleError(`重新创作第${episodeNum}集失败`, error)
    }
  }

  /**
   * [P1-7] 修正上批次质检问题
   */
  async fixLastBatch(): Promise<void> {
    const lastReview = this.context.reviews[this.context.reviews.length - 1]
    if (!lastReview || lastReview.passed) {
      this.log('info', 'fix_no_need', '上批次无质检问题需要修正')
      return
    }

    this.log('info', 'fix_start', '🔧 修正上批次质检问题')
    this.context.lastReviewFeedback = lastReview.feedback
    this.context.retryCount = 0

    if (this.context.currentStage === 'breakdown') {
      // [BUG-13 修复] 回退 processedChapters 并删除旧批次
      const rollbackChapters = Math.max(0, this.context.processedChapters - this.context.chaptersPerBatch)
      const rollbackBatch = this.context.currentBatch

      // 删除旧批次内容
      const breakdownPath = join(this.context.projectPath, 'plot-breakdown.md')
      try {
        const content = await readFile(breakdownPath, 'utf-8')
        const cleaned = this.breakdownParser.removeBatch(content, rollbackBatch)
        await writeFile(breakdownPath, cleaned, 'utf-8')
        this.log('info', 'batch_removed', `已移除第${rollbackBatch}批旧内容`)
      } catch { /* 忽略 */ }

      this.context.processedChapters = rollbackChapters
      await this.executeSingleBreakdown()
    } else {
      await this.executeSingleScript()
    }
  }

  /**
   * [P1-8] 手动触发拆解质检
   * [R4-1] FAIL 后自动修正重检
   */
  async checkBreakdown(batchNumber?: number): Promise<ReviewResult | null> {
    if (!this.llmProvider) throw new Error('请先配置 LLM Provider')

    this.log('info', 'check_start', `🔍 手动质检${batchNumber ? `第${batchNumber}批` : '最新批次'}`)

    try {
      const breakdownContent = await readFile(
        join(this.context.projectPath, 'plot-breakdown.md'), 'utf-8'
      )
      const parsed = this.breakdownParser.parse(breakdownContent)
      const batch = batchNumber
        ? parsed.batches.find(b => b.batchNumber === batchNumber)
        : parsed.batches[parsed.batches.length - 1]

      if (!batch) {
        this.log('warn', 'check_no_batch', '找不到指定批次')
        return null
      }

      // 读取对应章节原文
      const novelDir = join(this.context.projectPath, 'novel')
      const chapters = await this.novelManager.readChapters(
        novelDir, batch.chapterStart, batch.chapterEnd - batch.chapterStart + 1
      )
      const chaptersText = chapters.map(ch => `## 第${ch.chapter}章\n\n${ch.content}`).join('\n\n---\n\n')

      const batchPlots = batch.plots
        .map(p => `【剧情${p.id}】${p.scene}，${p.description}，${p.hookType}，第${p.episode}集，状态：${p.status === 'used' ? '已用' : '未用'}`)
        .join('\n')

      const skill = await this.skillLoader.load(ADAPT_SKILL_MAP.breakdown)
      const adaptMethod = skill.methodology || ''

      const prompt = this.promptAssembler.assembleBreakdownReview(
        ADAPT_BREAKDOWN_ANTIBIAS,
        batchPlots,
        chaptersText,
        adaptMethod
      )

      this.setState('breakdown_reviewing')
      const reviewOutput = await this.callLLM('breakdown', prompt)
      if (!reviewOutput) return null

      const result = this.parseReviewResult('breakdown', reviewOutput)
      this.log('info', 'check_done', `🔍 质检完成: ${result.passed ? 'PASS' : 'FAIL'} (${result.score}分)`)

      // [R4-1] FAIL → 自动修正重检
      if (!result.passed) {
        this.log('info', 'check_auto_fix', '🔧 质检未通过，自动修正该批次...')

        // [BUG-2 修复] 先删除旧批次内容，避免重复
        const breakdownPath2 = join(this.context.projectPath, 'plot-breakdown.md')
        try {
          const currentContent = await readFile(breakdownPath2, 'utf-8')
          const cleaned = this.breakdownParser.removeBatch(currentContent, batch.batchNumber)
          await writeFile(breakdownPath2, cleaned, 'utf-8')
          this.log('info', 'batch_removed', `已移除第${batch.batchNumber}批旧内容`)
        } catch { /* 忽略 */ }

        this.context.currentStage = 'breakdown'
        this.context.lastReviewFeedback = result.feedback
        this.context.currentBatch = batch.batchNumber
        this.context.retryCount = 0

        // 设置已拆解章节为该批次之前的值，让 executeSingleBreakdown 重做该批次
        this.context.processedChapters = batch.chapterStart - 1
        await this.executeSingleBreakdown()
      }

      return result
    } catch (error) {
      this.handleError('手动质检失败', error)
      return null
    }
  }

  /**
   * [P1-9] 智能下一步
   */
  async smartNext(): Promise<{ action: string; description: string }> {
    await this.refreshWaterLevel()
    const wl = this.context.waterLevel

    // 无 plot-breakdown → 提示初始化
    try {
      await readFile(join(this.context.projectPath, 'plot-breakdown.md'), 'utf-8')
    } catch {
      return { action: 'init', description: '全新项目，请先设置小说名称和类型' }
    }

    if (wl.unusedPlots === 0 && wl.unprocessedChapters === 0) {
      return { action: 'done', description: '🎉 所有工作已完成！所有章节已拆解、所有剧情已创作为剧本' }
    }
    if (wl.unusedPlots >= 6 && wl.unprocessedChapters > 0) {
      // 剧情充足，建议创作
      await this.executeSingleScript()
      return { action: 'script', description: `未用剧情充足(${wl.unusedPlots}个)，已自动执行 /script` }
    }
    if (wl.unusedPlots >= 6 && wl.unprocessedChapters === 0) {
      await this.executeSingleScript()
      return { action: 'script', description: `最后的剧情储备(${wl.unusedPlots}个)，已自动执行 /script` }
    }
    if (wl.unusedPlots < 6 && wl.unprocessedChapters > 0) {
      await this.executeSingleBreakdown()
      return { action: 'breakdown', description: `剧情储备不足(${wl.unusedPlots}个)，已自动执行 /breakdown` }
    }
    if (wl.unusedPlots === 0 && wl.unprocessedChapters > 0) {
      await this.executeSingleBreakdown()
      return { action: 'breakdown', description: `无可用剧情，已自动执行 /breakdown` }
    }

    // 有少量未用剧情
    await this.executeSingleScript()
    return { action: 'script', description: `剩余${wl.unusedPlots}个未用剧情，已自动执行 /script` }
  }

  // ==================== 控制 ====================

  pause(): void {
    if (this.context.state === 'adapt_paused' || this.context.state === 'adapt_idle') return
    this.setState('adapt_paused')
    this.log('info', 'paused', '⏸ 编剧管线已暂停')
  }

  abort(): void {
    this._aborted = true
    this.log('warn', 'aborted', '⏹ 编剧管线已中止')
    this.setState('adapt_idle')
  }

  skipReview(): void {
    if (!this.context.state.endsWith('_reviewing')) return
    this._reviewSkipped = true
    this.log('warn', 'review_skipped', '⏭ 已跳过审核')
    this.setState(ADAPT_STAGE_STATES[this.context.currentStage].done)
  }

  reset(): void {
    this.context = this.createEmptyContext()
    this._aborted = false
    this._reviewSkipped = false
    this.setState('adapt_idle')
  }

  // ==================== 辅助 ====================

  private log(level: LogEntry['level'], eventType: string, message: string): void {
    const entry: LogEntry = {
      id: uuid(),
      episodeId: `batch-${this.context.currentBatch}`,
      stage: this.context.currentStage,
      level,
      eventType,
      message,
      timestamp: new Date().toISOString()
    }
    this.context.logs.push(entry)
    this.emit('log', entry)
  }

  private handleError(message: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error || '')
    this.log('error', 'error', `❌ ${message}${detail ? ': ' + detail : ''}`)
    this.context.error = `${message}${detail ? ': ' + detail : ''}`
    this.setState('adapt_error')
    this.emit('error', { message, error: detail })
  }
}
