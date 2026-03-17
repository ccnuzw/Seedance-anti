// ============================================================
// Pipeline State Machine — FEICAI 工作流状态机引擎
// ============================================================
//
// 状态图:
//   idle → script_loaded → director_analyzing → director_reviewing
//     → (PASS) director_done → art_designing → art_reviewing
//     → (PASS) art_done → storyboard_writing → storyboard_reviewing
//     → (PASS) episode_complete
//

import { ArtOutputMerger } from './art-output-merger'
import { ProjectStatePersistence } from './project-state'
//   任何 reviewing 状态:
//     → (FAIL) 回退到对应的 executing 状态（自动重试）
//
//   任何执行中状态:
//     → 可 PAUSE → paused → RESUME 回到之前状态
//     → 出错 → error
//

import { EventEmitter } from 'events'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import type {
  PipelineState,
  PipelineStage,
  PipelineContext,
  PipelineEvent,
  ReviewResult,
  LogEntry,
  LLMConfig,
  PipelineSettings
} from '@shared/types'
import { DEFAULT_PIPELINE_SETTINGS } from '@shared/types'
import {
  STAGE_SKILL_MAP,
  ROLE_DECLARATIONS,
  STAGE_OUTPUT_FILES
} from '@shared/constants'
import { SkillLoader } from './skill-loader'
import { PromptAssembler, type UpstreamInputs, type ProjectContext } from './prompt-assembler'
import { ReviewEngine } from './review-engine'
import { createProvider } from '../llm/provider-factory'
import type { ILLMProvider } from '../llm/types'
import { v4 as uuid } from 'uuid'

// 状态转换表
const STAGE_STATES: Record<PipelineStage, {
  executing: PipelineState
  reviewing: PipelineState
  done: PipelineState
}> = {
  director: {
    executing: 'director_analyzing',
    reviewing: 'director_reviewing',
    done: 'director_done'
  },
  art: {
    executing: 'art_designing',
    reviewing: 'art_reviewing',
    done: 'art_done'
  },
  storyboard: {
    executing: 'storyboard_writing',
    reviewing: 'storyboard_reviewing',
    done: 'episode_complete'
  }
}

const STAGE_ORDER: PipelineStage[] = ['director', 'art', 'storyboard']

export class PipelineStateMachine extends EventEmitter {
  private context: PipelineContext
  private skillLoader: SkillLoader
  private promptAssembler: PromptAssembler
  private reviewEngine: ReviewEngine
  private llmProvider: ILLMProvider | null = null
  private pausedState: PipelineState | null = null
  private projectContext: ProjectContext | null = null
  private statePersistence: ProjectStatePersistence | null = null
  private pipelineSettings: PipelineSettings = { ...DEFAULT_PIPELINE_SETTINGS }
  private _aborted = false
  private _reviewSkipped = false

  constructor(skillsDir: string) {
    super()
    this.skillLoader = new SkillLoader(skillsDir)
    this.promptAssembler = new PromptAssembler()
    this.reviewEngine = new ReviewEngine(this.skillLoader, this.promptAssembler)

    this.context = {
      projectId: '',
      projectPath: '',
      episodeNum: 0,
      currentStage: 'director',
      state: 'idle',
      retryCount: 0,
      reviews: [],
      logs: []
    }
  }

  /** 获取当前状态 */
  getState(): PipelineState {
    return this.context.state
  }

  /** 获取完整上下文 */
  getContext(): PipelineContext {
    return { ...this.context }
  }

  /** 设置 LLM Provider */
  setProvider(config: LLMConfig): void {
    this.llmProvider = createProvider(config)
    this.reviewEngine.setProvider(this.llmProvider)
  }

  /** 设置项目级流水线参数 */
  setPipelineSettings(settings: Partial<PipelineSettings>): void {
    this.pipelineSettings = { ...DEFAULT_PIPELINE_SETTINGS, ...settings }
    this.reviewEngine.setPassScore(this.pipelineSettings.passScore)
  }

  // ==================== 状态转换 ====================

  private setState(newState: PipelineState): void {
    const oldState = this.context.state
    this.context.state = newState
    this.log('info', 'state_changed', `状态: ${oldState} → ${newState}`)
    this.emit('stateChanged', { oldState, newState, context: this.getContext() })
  }

  // ==================== 核心流程 ====================

  /**
   * 启动流水线 — 加载剧本并开始第一个阶段
   */
  async start(params: {
    projectId: string
    projectPath: string
    episodeNum: number
    projectContext: ProjectContext
    startStage?: PipelineStage
    singleStage?: boolean
  }): Promise<void> {
    if (!this.llmProvider) {
      throw new Error('请先配置 LLM Provider')
    }

    // 状态断言：引擎必须处于终止状态才能启动
    const currentState = this.context.state
    const terminalStates: PipelineState[] = ['idle', 'episode_complete', 'error', 'paused']
    if (!terminalStates.includes(currentState)) {
      throw new Error(`无法在 ${currentState} 状态下启动流水线`)
    }

    // 重置中止/跳过标志
    this._aborted = false
    this._reviewSkipped = false
    this.pausedState = null
    this.context = {
      projectId: params.projectId,
      projectPath: params.projectPath,
      episodeNum: params.episodeNum,
      currentStage: params.startStage || 'director',
      state: 'idle',
      retryCount: 0,
      reviews: [],
      logs: []
    }
    this.projectContext = params.projectContext

    // 初始化状态持久化
    this.statePersistence = new ProjectStatePersistence(
      params.projectPath, params.projectId
    )
    await this.statePersistence.load()

    // 加载剧本
    const epStr = String(params.episodeNum).padStart(2, '0')
    const scriptPath = join(params.projectPath, 'script', `ep${epStr}.md`)
    try {
      this.context.scriptPath = scriptPath
      this.log('info', 'script_loaded', `剧本已加载: ep${epStr}.md`)
      this.setState('script_loaded')
    } catch (error) {
      this.handleError('加载剧本失败', error)
      return
    }

    // 从指定阶段开始执行
    const startIdx = STAGE_ORDER.indexOf(params.startStage || 'director')
    // singleStage 模式：只跑一个阶段
    const endIdx = params.singleStage ? startIdx + 1 : STAGE_ORDER.length
    
    for (let i = startIdx; i < endIdx; i++) {
      if (this.shouldStop()) break
      await this.executeFullStage(STAGE_ORDER[i])
    }
    
    // 单阶段模式完成后，切换到终止状态让前端停止计时
    if (params.singleStage && !this.shouldStop()) {
      this.log('info', 'single_stage_done', `✅ 单阶段模式完成: ${this.getStageName(params.startStage || 'director')}`)
      this.setState('episode_complete')
    }
  }

  /** 检查是否应该中止执行（暂停、出错、abort、或 idle） */
  private shouldStop(): boolean {
    return this._aborted ||
      this.context.state === 'paused' ||
      this.context.state === 'error' ||
      this.context.state === 'idle'  // abort() 后状态为 idle
  }

  /**
   * 执行完整的单个阶段（执行 + 审核 + 可能的重试）
   */
  private async executeFullStage(stage: PipelineStage): Promise<void> {
    this.context.currentStage = stage
    this.context.retryCount = 0
    this.context.lastReviewFeedback = undefined
    this._reviewSkipped = false

    let passed = false
    while (!passed && this.context.retryCount <= this.pipelineSettings.maxRetries) {
      if (this.shouldStop()) return

      // 1. 执行阶段
      await this.executeStage(stage)
      if (this.shouldStop()) return

      // 2. 审核阶段
      const reviewResult = await this.executeReview(stage)
      if (this.shouldStop()) return

      // 3. 如果审核被用户跳过（skipReview 设置了 _reviewSkipped），直接跳出
      if (this._reviewSkipped) {
        this._reviewSkipped = false
        passed = true
        break
      }

      if (reviewResult && reviewResult.passed) {
        passed = true
        this.context.lastReviewFeedback = undefined
        this.setState(STAGE_STATES[stage].done)
        this.log('info', 'stage_complete', `✅ ${stage} 阶段通过审核 (${reviewResult.score}分)`)
        this.emit('stageComplete', { stage, result: reviewResult })

        // 持久化阶段完成状态
        if (this.statePersistence) {
          this.statePersistence.markStageComplete(
            this.context.episodeNum, stage,
            [reviewResult]
          ).catch(console.error)
        }
      } else {
        this.context.retryCount++
        const reviewScore = reviewResult ? reviewResult.score : 0
        // 保存审核反馈，传入下次重试
        this.context.lastReviewFeedback = reviewResult?.feedback || undefined
        if (this.context.retryCount > this.pipelineSettings.maxRetries) {
          this.handleError(`${stage} 阶段审核失败超过最大重试次数 (最后得分: ${reviewScore})`, null)
          return
        }
        this.log('warn', 'review_fail',
          `❌ ${stage} 审核未通过 (得分: ${reviewScore}/10)，将带审核反馈重试 (${this.context.retryCount}/${this.pipelineSettings.maxRetries})`)
      }
    }
  }

  /**
   * 执行单个阶段的生成任务
   */
  private async executeStage(stage: PipelineStage): Promise<void> {
    this.setState(STAGE_STATES[stage].executing)
    const stageEmoji = { director: '🎬', art: '🎨', storyboard: '📐' }[stage]
    this.log('info', 'stage_start', `${stageEmoji} 开始${this.getStageName(stage)}`)

    try {
      // 1. 加载 Skill
      const skillName = STAGE_SKILL_MAP[stage]
      this.log('info', 'skill_loading', `加载技能: ${skillName}`)
      const skill = await this.skillLoader.load(skillName)

      // 2. 收集上游输入
      const inputs = await this.gatherInputs(stage)

      // 3. 组装 Prompt
      const roleDeclaration = ROLE_DECLARATIONS[stage]
      const prompt = this.promptAssembler.assemble(
        skill,
        roleDeclaration,
        inputs,
        this.projectContext!,
        stage,
        this.context.lastReviewFeedback
      )
      const retryNote = this.context.retryCount > 0 ? ` [重试#${this.context.retryCount}, 带审核反馈]` : ''
      this.log('info', 'prompt_assembled', `Prompt 已组装 (system: ${prompt.system.length} chars, user: ${prompt.user.length} chars)${retryNote}`)

      // 4. 调用 LLM（带超时保护）
      this.log('info', 'llm_calling', `调用 LLM 生成中...`)
      let output = ''
      let lastChunkTime = Date.now()
      const LLM_TIMEOUT_MS = this.pipelineSettings.llmTimeoutSec * 1000

      const stream = this.llmProvider!.generateStream(prompt, {
        onChunk: (chunk) => {
          output += chunk
          lastChunkTime = Date.now()
          this.emit('stream', { stage, chunk, totalLength: output.length })
        }
      })

      // 超时检测定时器
      const timeoutChecker = setInterval(() => {
        if (Date.now() - lastChunkTime > LLM_TIMEOUT_MS) {
          clearInterval(timeoutChecker)
          this.log('warn', 'llm_timeout', `⏱ LLM 超时 (${LLM_TIMEOUT_MS / 1000}s 无新数据)`)
        }
      }, 5000)

      try {
        for await (const _chunk of stream) {
          // 每个 chunk 后立即检查中止标志
          if (this.shouldStop()) {
            this.log('info', 'aborted_during_gen', '⚓ LLM 生成已中断')
            clearInterval(timeoutChecker)
            return
          }
          // 检查是否已超时
          if (Date.now() - lastChunkTime > LLM_TIMEOUT_MS) {
            clearInterval(timeoutChecker)
            throw new Error(`LLM 生成超时 (${LLM_TIMEOUT_MS / 1000}s 无响应)`)
          }
        }
      } finally {
        clearInterval(timeoutChecker)
      }

      this.log('info', 'llm_complete', `LLM 生成完成 (${output.length} chars)`)

      // 5. 写入文件
      await this.writeStageOutput(stage, output)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      const isTimeout = errMsg.includes('超时')
      const isNetwork = errMsg.includes('fetch') || errMsg.includes('ECONNREFUSED') || errMsg.includes('ETIMEDOUT')
      const hint = isTimeout ? '（将自动重试）' : isNetwork ? '（网络错误，请检查连接）' : ''
      this.handleError(`${this.getStageName(stage)}执行失败${hint}`, error)
    }
  }

  /**
   * 执行审核
   */
  private async executeReview(stage: PipelineStage): Promise<ReviewResult | null> {
    this.setState(STAGE_STATES[stage].reviewing)
    this.log('info', 'review_start', `⚠️ 开始审核 (对抗性立场 + 评分锚定 7 分)`)

    try {
      const result = await this.reviewEngine.review(stage, {
        projectPath: this.context.projectPath,
        episodeNum: this.context.episodeNum,
        scriptPath: this.context.scriptPath
      })

      this.context.reviews.push(result)
      this.emit('reviewResult', { stage, result })
      return result
    } catch (error) {
      this.handleError('审核执行失败', error)
      return null
    }
  }

  // ==================== 输入收集 ====================

  private async gatherInputs(stage: PipelineStage): Promise<UpstreamInputs> {
    const inputs: UpstreamInputs = {}
    const epStr = String(this.context.episodeNum).padStart(2, '0')

    // 剧本（所有阶段都可能需要）
    if (this.context.scriptPath) {
      inputs.script = await readFile(this.context.scriptPath, 'utf-8')
    }

    // 已有素材（ep02+ 和 art/storyboard 阶段需要）
    const charPath = join(this.context.projectPath, 'assets', 'character-prompts.md')
    const scenePath = join(this.context.projectPath, 'assets', 'scene-prompts.md')
    try { inputs.characterPrompts = await readFile(charPath, 'utf-8') } catch { /* 文件不存在 */ }
    try { inputs.scenePrompts = await readFile(scenePath, 'utf-8') } catch { /* 文件不存在 */ }

    // 导演分析（art 和 storyboard 阶段需要）
    if (stage === 'art' || stage === 'storyboard') {
      const analysisPath = join(
        this.context.projectPath, 'outputs', `ep${epStr}`, '01-director-analysis.md'
      )
      try { inputs.directorAnalysis = await readFile(analysisPath, 'utf-8') } catch { /* */ }
    }

    return inputs
  }

  // ==================== 文件写入 ====================

  private async writeStageOutput(stage: PipelineStage, content: string): Promise<void> {
    const epStr = String(this.context.episodeNum).padStart(2, '0')

    if (stage === 'art') {
      // 1. 写入临时文件（便于调试/审核断点清洗）
      const outputDir = join(this.context.projectPath, 'outputs', `ep${epStr}`)
      await mkdir(outputDir, { recursive: true })
      const outputPath = join(outputDir, '01.5-art-design-output.md')
      await writeFile(outputPath, content, 'utf-8')
      this.log('info', 'file_written', `产出已写入: ${outputPath}`)

      // 2. 解析并追加到 assets/ 目录
      try {
        const result = await ArtOutputMerger.parseAndMerge(
          content, this.context.projectPath, this.context.episodeNum
        )
        this.log('info', 'assets_merged',
          `素材已合并到 assets/ (角色: ${result.characters}, 场景: ${result.scenes})`)
      } catch (err) {
        this.log('warn', 'assets_merge_fail',
          `素材合并失败: ${err instanceof Error ? err.message : String(err)}`)
      }
    } else {
      const fileName = STAGE_OUTPUT_FILES[stage]
      if (!fileName) return

      const outputDir = join(this.context.projectPath, 'outputs', `ep${epStr}`)
      await mkdir(outputDir, { recursive: true })
      const outputPath = join(outputDir, fileName)
      await writeFile(outputPath, content, 'utf-8')

      if (stage === 'director') {
        this.context.directorAnalysisPath = outputPath
      } else if (stage === 'storyboard') {
        this.context.seedancePromptsPath = outputPath
      }
      this.log('info', 'file_written', `产出已写入: ${outputPath}`)
    }
  }

  // ==================== 暂停/恢复/重试 ====================

  pause(): void {
    if (this.context.state === 'paused' || this.context.state === 'idle') return
    this.pausedState = this.context.state
    this.setState('paused')
    this.log('info', 'paused', '⏸ 流水线已暂停')
  }

  /** 强制中止（用于停止执行）—— 状态回到 idle 而非 error */
  abort(): void {
    this._aborted = true  // 立即设置标志，阻止 LLM 流继续消费
    this.log('warn', 'aborted', '⏹ 流水线已中止')
    this.pausedState = null
    this.context.error = undefined
    this.setState('idle')
  }

  resume(): void {
    if (this.context.state !== 'paused' || !this.pausedState) return
    this.log('info', 'resumed', '▶ 流水线已恢复')
    this.setState(this.pausedState)
    this.pausedState = null
    // 自动继续当前阶段需要由调用方处理
  }

  /**
   * 从指定阶段重试
   */
  async retry(stage?: PipelineStage): Promise<void> {
    const targetStage = stage || this.context.currentStage
    this.context.retryCount = 0
    this._aborted = false
    this._reviewSkipped = false
    this.context.state = 'script_loaded' // 重置到可以开始的状态

    const startIdx = STAGE_ORDER.indexOf(targetStage)
    for (let i = startIdx; i < STAGE_ORDER.length; i++) {
      if (this.shouldStop()) break
      await this.executeFullStage(STAGE_ORDER[i])
    }
  }

  /**
   * 跳过当前阶段审核，直接标记通过
   */
  skipReview(stage: PipelineStage): void {
    if (!this.context.state.endsWith('_reviewing')) return
    this._reviewSkipped = true  // 设置标志，阻止 executeFullStage 重试
    this.log('warn', 'review_skipped', `⏭ 已跳过 ${this.getStageName(stage)} 审核`)
    this.setState(STAGE_STATES[stage].done)
  }

  /**
   * 等待流水线执行完成（episode_complete 或 error）
   * 用于批量模式的串行等待
   */
  waitForCompletion(): Promise<{ state: PipelineState; stage: PipelineStage }> {
    // 如果已经是终止状态，立即返回
    const terminalStates: PipelineState[] = ['idle', 'episode_complete', 'error', 'paused']
    if (terminalStates.includes(this.context.state)) {
      return Promise.resolve({ state: this.context.state, stage: this.context.currentStage })
    }

    return new Promise((resolve) => {
      const onStateChange = (data: { newState: PipelineState }) => {
        if (terminalStates.includes(data.newState)) {
          this.removeListener('stateChanged', onStateChange)
          resolve({ state: data.newState, stage: this.context.currentStage })
        }
      }
      this.on('stateChanged', onStateChange)
    })
  }

  /** 重置到初始状态 */
  reset(): void {
    this.context = {
      projectId: '',
      projectPath: '',
      episodeNum: 0,
      currentStage: 'director',
      state: 'idle',
      retryCount: 0,
      reviews: [],
      logs: []
    }
    this.pausedState = null
    this._aborted = false
    this._reviewSkipped = false
    this.setState('idle')
  }

  // ==================== 辅助 ====================

  private log(level: LogEntry['level'], eventType: string, message: string): void {
    const entry: LogEntry = {
      id: uuid(),
      episodeId: `ep${String(this.context.episodeNum).padStart(2, '0')}`,
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
    this.setState('error')
    this.emit('error', { message, error: detail })
  }

  private getStageName(stage: PipelineStage): string {
    return { director: '导演分析', art: '服化道设计', storyboard: '分镜编写' }[stage]
  }
}
