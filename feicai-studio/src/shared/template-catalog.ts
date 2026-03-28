import type {
  ExportProfilePreset,
  ProjectConfig,
  ProjectAutomationPreset,
  ProjectTaskDefaults,
  ProjectTaskTemplate
} from './types'

export const BUILTIN_TASK_TEMPLATES: ProjectTaskTemplate[] = [
  {
    id: 'builtin:full-daily',
    label: '内置 · 日常全流程',
    description: '适合日常批量推进，从导演分析一路执行到分镜，强调稳定吞吐。',
    source: 'builtin',
    priority: 'normal',
    maxAutoRetries: 1,
    batchMode: 'independent'
  },
  {
    id: 'builtin:director-repair',
    label: '内置 · 导演补跑',
    description: '仅补跑导演分析，适合脚本有改动后的快速回填。',
    source: 'builtin',
    startStage: 'director',
    singleStage: true,
    priority: 'high',
    maxAutoRetries: 2,
    batchMode: 'sequential_on_success'
  },
  {
    id: 'builtin:art-repair',
    label: '内置 · 服化道补跑',
    description: '仅重做服化道设计，适合角色/场景设定修订后的增量刷新。',
    source: 'builtin',
    startStage: 'art',
    singleStage: true,
    priority: 'high',
    maxAutoRetries: 2,
    batchMode: 'sequential_on_success'
  },
  {
    id: 'builtin:storyboard-final',
    label: '内置 · 分镜冲刺',
    description: '从分镜阶段开始继续执行，适合上线前集中补齐提示词。',
    source: 'builtin',
    startStage: 'storyboard',
    singleStage: false,
    priority: 'high',
    maxAutoRetries: 1,
    batchMode: 'sequential_always'
  }
]

export const BUILTIN_PROJECT_PRESETS: ProjectAutomationPreset[] = [
  {
    id: 'preset:novel-stable',
    label: '网文改编 · 稳定工厂',
    description: '强调质量门禁和稳定吞吐，适合长期连载项目。',
    pipelineSettings: {
      maxRetries: 3,
      passScore: 7,
      llmTimeoutSec: 90,
      durationMin: 90,
      durationMax: 120,
      singlePromptMax: 10
    },
    reviewPolicy: {
      qaMode: 'strict',
      breakdownAutoRepairRounds: 1,
      scriptAutoRepairRounds: 1
    },
    taskDefaults: {
      defaultPriority: 'normal',
      defaultMaxAutoRetries: 1,
      defaultBatchMode: 'independent',
      archiveAfterDays: 14
    },
    recommendedTemplateIds: ['builtin:full-daily', 'builtin:director-repair'],
    defaultExportProfileId: 'export:delivery-bundle'
  },
  {
    id: 'preset:rush-delivery',
    label: '交付冲刺 · 快速推进',
    description: '降低阻塞，优先保证批量推进速度，适合赶档期。',
    pipelineSettings: {
      maxRetries: 2,
      passScore: 6,
      llmTimeoutSec: 75,
      durationMin: 80,
      durationMax: 110,
      singlePromptMax: 10
    },
    reviewPolicy: {
      qaMode: 'lenient',
      breakdownAutoRepairRounds: 0,
      scriptAutoRepairRounds: 0
    },
    taskDefaults: {
      defaultPriority: 'high',
      defaultMaxAutoRetries: 0,
      defaultBatchMode: 'sequential_always',
      archiveAfterDays: 7
    },
    recommendedTemplateIds: ['builtin:art-repair', 'builtin:storyboard-final'],
    defaultExportProfileId: 'export:review-pack'
  },
  {
    id: 'preset:data-audit',
    label: '审计回溯 · 留痕优先',
    description: '适合需要频繁审校和对账的项目，偏保守配置。',
    pipelineSettings: {
      maxRetries: 4,
      passScore: 8,
      llmTimeoutSec: 120,
      durationMin: 90,
      durationMax: 120,
      singlePromptMax: 8
    },
    reviewPolicy: {
      qaMode: 'strict',
      breakdownAutoRepairRounds: 2,
      scriptAutoRepairRounds: 2
    },
    taskDefaults: {
      defaultPriority: 'normal',
      defaultMaxAutoRetries: 2,
      defaultBatchMode: 'sequential_on_success',
      archiveAfterDays: 30
    },
    recommendedTemplateIds: ['builtin:full-daily', 'builtin:storyboard-final'],
    defaultExportProfileId: 'export:prompt-dataset'
  }
]

export const BUILTIN_EXPORT_PROFILES: ExportProfilePreset[] = [
  {
    id: 'export:review-pack',
    label: '审阅包',
    description: '导出当前范围的 Markdown 提示词，适合人工审阅和群内流转。',
    action: 'prompts',
    format: 'markdown',
    rangeMode: 'selected'
  },
  {
    id: 'export:prompt-dataset',
    label: '数据包',
    description: '导出 JSON 提示词，适合程序处理、统计和外部对接。',
    action: 'prompts',
    format: 'json',
    rangeMode: 'selected'
  },
  {
    id: 'export:scripts-manuscript',
    label: '剧本总稿',
    description: '合并选定范围剧本为一份总稿，适合编剧审校和交接。',
    action: 'scripts',
    rangeMode: 'selected'
  },
  {
    id: 'export:delivery-bundle',
    label: '完整交付包',
    description: '导出当前版本产物、manifest 和审核快照，适合归档与移交。',
    action: 'bundle',
    rangeMode: 'all'
  }
]

export function resolveBuiltinTaskTemplates(): ProjectTaskTemplate[] {
  return BUILTIN_TASK_TEMPLATES.map((template) => ({ ...template }))
}

export function resolveBuiltinProjectPreset(id?: string | null): ProjectAutomationPreset | null {
  if (!id) return null
  return BUILTIN_PROJECT_PRESETS.find((preset) => preset.id === id) || null
}

export function resolveBuiltinExportProfile(id?: string | null): ExportProfilePreset | null {
  if (!id) return null
  return BUILTIN_EXPORT_PROFILES.find((profile) => profile.id === id) || null
}

export function buildProjectPresetConfig(
  preset?: ProjectAutomationPreset | null
): Pick<ProjectConfig, 'templateProfileId' | 'exportProfileId' | 'pipelineSettings' | 'reviewPolicy' | 'taskDefaults'> {
  if (!preset) {
    return {}
  }

  return {
    templateProfileId: preset.id,
    exportProfileId: preset.defaultExportProfileId,
    pipelineSettings: preset.pipelineSettings ? { ...preset.pipelineSettings } : undefined,
    reviewPolicy: preset.reviewPolicy ? { ...preset.reviewPolicy } : undefined,
    taskDefaults: preset.taskDefaults ? { ...preset.taskDefaults } as ProjectTaskDefaults : undefined
  }
}
