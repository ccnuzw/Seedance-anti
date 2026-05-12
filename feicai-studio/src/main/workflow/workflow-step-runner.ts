import type { ReviewResult, ProjectConfig } from '@shared/types'
import type { ILLMProvider } from '../llm/types'
import { type ProjectContext } from '../engine/prompt-assembler'
import { WorkflowEngine } from './workflow-engine'

export type WorkflowStepId =
  | 'story'
  | 'story_review'
  | 'script'
  | 'script_review'
  | 'character'
  | 'storyboard_review'

export interface WorkflowStepParams {
  projectPath: string
  episodeNum: number
  projectContext: ProjectContext
  projectConfig?: Partial<ProjectConfig> | null
  reviewFeedback?: string
}

export interface WorkflowStepRunResult {
  stage: WorkflowStepId
  success: boolean
  outputPath?: string
  review?: ReviewResult
  error?: string
}

export class WorkflowStepRunner {
  private engine: WorkflowEngine

  constructor(skillsDir: string) {
    this.engine = new WorkflowEngine(skillsDir)
  }

  setProvider(provider: ILLMProvider): void {
    this.engine.setProvider(provider)
  }

  async runScriptReview(
    params: WorkflowStepParams
  ): Promise<WorkflowStepRunResult> {
    try {
      const result = await this.engine.reviewStage('script_review', params)
      return {
        stage: 'script_review',
        success: result.review.passed,
        outputPath: result.outputPath,
        review: result.review
      }
    } catch (error) {
      return {
        stage: 'script_review',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async runStoryReview(
    params: WorkflowStepParams
  ): Promise<WorkflowStepRunResult> {
    try {
      const result = await this.engine.reviewStage('story_review', params)
      return {
        stage: 'story_review',
        success: result.review.passed,
        outputPath: result.outputPath,
        review: result.review
      }
    } catch (error) {
      return {
        stage: 'story_review',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async runStoryGeneration(
    params: WorkflowStepParams
  ): Promise<WorkflowStepRunResult> {
    return this.runGenerateStage('story', params)
  }

  async runScriptGeneration(
    params: WorkflowStepParams
  ): Promise<WorkflowStepRunResult> {
    return this.runGenerateStage('script', params)
  }

  async runCharacterDesign(
    params: WorkflowStepParams
  ): Promise<WorkflowStepRunResult> {
    return this.runGenerateStage('character', params)
  }

  async runStoryboardReview(
    params: WorkflowStepParams
  ): Promise<WorkflowStepRunResult> {
    try {
      const result = await this.engine.reviewStage('storyboard_review', params)
      return {
        stage: 'storyboard_review',
        success: result.review.passed,
        outputPath: result.outputPath,
        review: result.review
      }
    } catch (error) {
      return {
        stage: 'storyboard_review',
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async runGenerateStage(
    stage: 'story' | 'script' | 'character',
    params: WorkflowStepParams
  ): Promise<WorkflowStepRunResult> {
    try {
      const result = await this.engine.generateStage(stage, params, {
        reviewFeedback: params.reviewFeedback
      })
      return {
        stage,
        success: true,
        outputPath: result.outputPath
      }
    } catch (error) {
      return {
        stage,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
