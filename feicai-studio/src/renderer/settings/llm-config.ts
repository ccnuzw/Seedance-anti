import type {
  LLMConfig,
  LLMProviderType,
  ModelCategory,
  OpenAIImageBackground,
  OpenAIImageOutputFormat,
  OpenAIImageQuality,
  OpenAIImageSize,
  OpenAIReasoningEffort,
  OpenAIWireApi
} from '@shared/types'

export interface ProviderOption {
  value: LLMProviderType
  label: string
}

export interface CategoryTab {
  value: ModelCategory
  label: string
  emoji: string
  desc: string
  color: string
}

export interface LLMFormState {
  name: string
  category: ModelCategory
  provider: LLMProviderType
  baseUrl: string
  apiKey: string
  model: string
  wireApi: OpenAIWireApi
  reasoningEffort: OpenAIReasoningEffort
  imageSize: OpenAIImageSize
  imageQuality: OpenAIImageQuality
  imageOutputFormat: OpenAIImageOutputFormat
  imageBackground: OpenAIImageBackground
  maxTokens: number
  temperature: number
  isDefault: boolean
}

export const PROVIDER_OPTIONS: ProviderOption[] = [
  { value: 'openai', label: 'OpenAI 官方 (默认)' },
  { value: 'openai-compatible', label: 'OpenAI 兼容 / 自建代理' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'anthropic', label: 'Anthropic Claude' }
]

export const CATEGORY_TABS: CategoryTab[] = [
  {
    value: 'llm',
    label: 'LLM 文本',
    emoji: '🤖',
    desc: '剧本 · 导演 · 分镜 · 服化道',
    color: 'accent'
  },
  {
    value: 'image',
    label: '图像生成',
    emoji: '🎨',
    desc: 'AI 生图模型',
    color: 'green'
  },
  {
    value: 'video',
    label: '视频生成',
    emoji: '🎬',
    desc: 'AI 生视频模型',
    color: 'purple'
  }
]

export const DEFAULT_URLS: Record<LLMProviderType, string> = {
  google: 'https://generativelanguage.googleapis.com',
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  'openai-compatible': ''
}

export const DEFAULT_WIRE_API: Record<LLMProviderType, OpenAIWireApi> = {
  google: 'chat-completions',
  anthropic: 'chat-completions',
  openai: 'responses',
  'openai-compatible': 'responses'
}

export const DEFAULT_REASONING_EFFORT: OpenAIReasoningEffort = 'medium'
export const DEFAULT_IMAGE_SIZE: OpenAIImageSize = '1024x1024'
export const DEFAULT_IMAGE_QUALITY: OpenAIImageQuality = 'auto'
export const DEFAULT_IMAGE_OUTPUT_FORMAT: OpenAIImageOutputFormat = 'png'
export const DEFAULT_IMAGE_BACKGROUND: OpenAIImageBackground = 'auto'
export const DEFAULT_MODELS: Record<ModelCategory, string> = {
  llm: '',
  image: 'gpt-image-2',
  video: ''
}

export function getProviderOptions(category: ModelCategory): ProviderOption[] {
  if (category === 'image') {
    return PROVIDER_OPTIONS.filter(
      (opt) => opt.value === 'openai-compatible' || opt.value === 'openai'
    )
  }
  return PROVIDER_OPTIONS
}

export function createDefaultLLMForm(
  category: ModelCategory = 'llm'
): LLMFormState {
  return {
    name: '',
    category,
    provider: 'openai',
    baseUrl: DEFAULT_URLS.openai,
    apiKey: '',
    model: DEFAULT_MODELS[category],
    wireApi: DEFAULT_WIRE_API.openai,
    reasoningEffort: DEFAULT_REASONING_EFFORT,
    imageSize: DEFAULT_IMAGE_SIZE,
    imageQuality: DEFAULT_IMAGE_QUALITY,
    imageOutputFormat: DEFAULT_IMAGE_OUTPUT_FORMAT,
    imageBackground: DEFAULT_IMAGE_BACKGROUND,
    maxTokens: 8192,
    temperature: 0.7,
    isDefault: true
  }
}

export function toLLMFormState(config: LLMConfig): LLMFormState {
  return {
    name: config.name,
    category: config.category,
    provider: config.provider,
    baseUrl: config.baseUrl,
    apiKey: '',
    model: config.model,
    wireApi: config.wireApi || DEFAULT_WIRE_API[config.provider],
    reasoningEffort: config.reasoningEffort || DEFAULT_REASONING_EFFORT,
    imageSize: config.imageSize || DEFAULT_IMAGE_SIZE,
    imageQuality: config.imageQuality || DEFAULT_IMAGE_QUALITY,
    imageOutputFormat: config.imageOutputFormat || DEFAULT_IMAGE_OUTPUT_FORMAT,
    imageBackground: config.imageBackground || DEFAULT_IMAGE_BACKGROUND,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    isDefault: config.isDefault
  }
}
