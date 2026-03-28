import type {
  LLMFailureClass,
  LLMProviderType,
  LLMUsageMetrics
} from '@shared/types'

function estimateTextTokens(text: string): number {
  if (!text.trim()) return 0

  const hanChars = (text.match(/\p{Script=Han}/gu) || []).length
  const words = (text.match(/[A-Za-z0-9_]+/g) || []).length
  const remainingChars = Math.max(
    0,
    text.replace(/[A-Za-z0-9_\s]/g, '').length - hanChars
  )

  return Math.max(
    1,
    Math.ceil(hanChars * 1.15 + words * 1.25 + remainingChars * 0.35)
  )
}

export function buildEstimatedUsage(systemPrompt: string, userPrompt: string, output: string): LLMUsageMetrics {
  const inputTokens = estimateTextTokens(systemPrompt) + estimateTextTokens(userPrompt)
  const outputTokens = estimateTextTokens(output)
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    tokenSource: 'estimated'
  }
}

type ModelPricing = {
  inputUsdPerMillion: number
  outputUsdPerMillion: number
}

const MODEL_PRICING: Array<{
  provider: LLMProviderType | 'any'
  match: RegExp
  pricing: ModelPricing
}> = [
  {
    provider: 'openai',
    match: /^gpt-5/i,
    pricing: { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 }
  },
  {
    provider: 'openai',
    match: /^gpt-4\.1/i,
    pricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 8 }
  },
  {
    provider: 'openai',
    match: /^gpt-4o/i,
    pricing: { inputUsdPerMillion: 2.5, outputUsdPerMillion: 10 }
  },
  {
    provider: 'anthropic',
    match: /^claude-3-7-sonnet/i,
    pricing: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 }
  },
  {
    provider: 'anthropic',
    match: /^claude-3-5-sonnet/i,
    pricing: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 }
  },
  {
    provider: 'anthropic',
    match: /^claude-3-5-haiku/i,
    pricing: { inputUsdPerMillion: 0.8, outputUsdPerMillion: 4 }
  },
  {
    provider: 'google',
    match: /^gemini-2\.5-pro/i,
    pricing: { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10 }
  },
  {
    provider: 'google',
    match: /^gemini-2\.5-flash/i,
    pricing: { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 }
  },
  {
    provider: 'google',
    match: /^gemini-2\.0-flash/i,
    pricing: { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4 }
  }
]

export function estimateCostUsd(
  provider: LLMProviderType | string,
  model: string,
  usage?: LLMUsageMetrics
): number | undefined {
  if (!usage) return undefined
  const pricing = MODEL_PRICING.find((entry) => {
    if (entry.provider !== 'any' && entry.provider !== provider) {
      return false
    }
    return entry.match.test(model)
  })?.pricing

  if (!pricing) return undefined

  const inputCost = ((usage.inputTokens || 0) / 1_000_000) * pricing.inputUsdPerMillion
  const outputCost = ((usage.outputTokens || 0) / 1_000_000) * pricing.outputUsdPerMillion
  return Number((inputCost + outputCost).toFixed(6))
}

export function classifyLLMFailure(error: unknown): LLMFailureClass {
  const message = (error instanceof Error ? error.message : String(error || '')).toLowerCase()

  if (!message) return 'unknown'
  if (message.includes('timeout') || message.includes('超时')) return 'timeout'
  if (message.includes('401') || message.includes('403') || message.includes('unauthorized') || message.includes('forbidden') || message.includes('api key')) return 'auth'
  if (message.includes('429') || message.includes('rate limit') || message.includes('quota')) return 'rate_limit'
  if (message.includes('econnrefused') || message.includes('etimedout') || message.includes('fetch') || message.includes('network') || message.includes('terminated') || message.includes('socket')) return 'network'
  if (message.includes('400') || message.includes('invalid') || message.includes('bad request')) return 'validation'
  if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('provider')) return 'provider'
  return 'unknown'
}
