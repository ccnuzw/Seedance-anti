import type { GenerateOptions } from '@shared/types'
import type { TextGenerationResult } from '@shared/provider-capabilities'

/** Request-local side channel; never stored on a reusable provider instance. */
export const TEXT_METADATA = Symbol('text-provider-metadata')
export interface TextMetadata extends Partial<TextGenerationResult> {
  streamEnded?: boolean
}
export interface TextMetadataOptions extends GenerateOptions {
  [TEXT_METADATA]?: (metadata: TextMetadata) => void
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
const string = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined
const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined

/** Observe wire facts without changing legacy text extraction or rejection behavior. */
export function observeTextMetadata(
  options: GenerateOptions | undefined,
  provider: 'openai' | 'anthropic' | 'google',
  value: unknown,
  event: string
): void {
  const notify = (options as TextMetadataOptions | undefined)?.[TEXT_METADATA]
  if (!notify) return
  const data = object(value)
  const type = string(data.type) || event
  const nested = object(data.response || data.message)
  const source = Object.keys(nested).length ? nested : data
  const metadata: TextMetadata = {}
  const requestId = string(source.id) || string(source.responseId)
  const model = string(source.model) || string(source.modelVersion)
  if (requestId) metadata.providerRequestId = requestId
  if (model) metadata.providerModel = model
  let reason: string | undefined
  if (provider === 'openai') {
    const choice = object(
      Array.isArray(data.choices) ? data.choices[0] : undefined
    )
    reason = string(choice.finish_reason)
    if (type === 'response.completed' || source.status === 'completed')
      reason = 'completed'
    if (type === 'response.incomplete' || source.status === 'incomplete')
      reason = string(object(source.incomplete_details).reason) || 'incomplete'
    if (reason)
      metadata.completion = ['stop', 'completed'].includes(reason)
        ? 'complete'
        : ['length', 'max_output_tokens'].includes(reason)
          ? 'truncated'
          : reason === 'content_filter'
            ? 'refused'
            : 'incomplete'
    if (string(object(choice.message).refusal)) {
      reason = 'refusal'
      metadata.completion = 'refused'
    }
  } else if (provider === 'anthropic') {
    reason =
      string(source.stop_reason) || string(object(data.delta).stop_reason)
    // message_delta announces a stop reason; only message_stop confirms stream termination.
    if (reason)
      metadata.completion =
        reason === 'max_tokens'
          ? 'truncated'
          : reason === 'refusal'
            ? 'refused'
            : ['end_turn', 'stop_sequence'].includes(reason) && event === 'json'
              ? 'complete'
              : 'incomplete'
    if (type === 'message_stop') metadata.streamEnded = true
  } else {
    const candidate = object(
      Array.isArray(data.candidates) ? data.candidates[0] : undefined
    )
    reason =
      string(candidate.finishReason) ||
      string(object(data.promptFeedback).blockReason)
    if (reason)
      metadata.completion =
        reason === 'STOP'
          ? 'complete'
          : reason === 'MAX_TOKENS'
            ? 'truncated'
            : reason === 'FINISH_REASON_UNSPECIFIED'
              ? 'unknown'
              : 'refused'
  }
  if (reason) metadata.finishReason = reason
  const usage = object(source.usage || data.usage || data.usageMetadata)
  const tokens =
    provider === 'google'
      ? {
          inputTokens: count(usage.promptTokenCount),
          outputTokens: count(usage.candidatesTokenCount),
          totalTokens: count(usage.totalTokenCount)
        }
      : {
          inputTokens: count(usage.input_tokens ?? usage.prompt_tokens),
          outputTokens: count(usage.output_tokens ?? usage.completion_tokens),
          totalTokens: count(usage.total_tokens)
        }
  metadata.usage = Object.fromEntries(
    Object.entries(tokens).filter(([, item]) => item !== undefined)
  )
  notify(metadata)
}
