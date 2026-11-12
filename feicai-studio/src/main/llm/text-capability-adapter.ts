import { createHash } from 'node:crypto'
import type { LLMConfig } from '@shared/types'
import {
  parseModelDescriptor,
  parseProviderRequestEnvelope,
  parseStageModelBinding,
  ProviderContractError,
  requireModelCapability,
  validateCapabilityParameters,
  type ModelDescriptor,
  type StageModelBinding,
  type TextGenerationEvent,
  type TextGenerationRequest,
  type TextGenerationResult
} from '@shared/provider-capabilities'
import type { ILLMProvider } from './types'
import { endpointIdentity, LLMRequestError } from './endpoint-security'
import {
  TEXT_METADATA,
  type TextMetadata,
  type TextMetadataOptions
} from './text-metadata'

/** Stable safe identity of the configured endpoint; credentials are excluded. */
export function capabilityConnectionReference(
  config: LLMConfig
): StageModelBinding['connection'] {
  return {
    connectionId: config.id,
    endpointRevision: createHash('sha256')
      .update(endpointIdentity(config.provider, config.baseUrl))
      .digest('hex')
  }
}
export class TextProviderCallError extends LLMRequestError {
  /** Client-side abort does not confirm remote cancellation or absence of billing. */
  readonly cancellation?: { local: 'aborted'; remote: 'unknown' }
  constructor(
    error: LLMRequestError,
    readonly partialResult: TextGenerationResult
  ) {
    super(error.message, error.category)
    this.name = 'TextProviderCallError'
    if (error.category === 'cancelled' || error.category === 'timeout') {
      this.cancellation = { local: 'aborted', remote: 'unknown' }
    }
  }
}
export interface TextGenerationProvider {
  generate(request: TextGenerationRequest): Promise<TextGenerationResult>
  generateStream(
    request: TextGenerationRequest
  ): AsyncGenerator<TextGenerationEvent, void, unknown>
}

/** Bridges the actual legacy provider. No alternate HTTP implementation or model inference. */
export class LegacyTextCapabilityAdapter implements TextGenerationProvider {
  private readonly model: ModelDescriptor
  private readonly binding: StageModelBinding
  constructor(
    private readonly legacy: ILLMProvider,
    config: LLMConfig,
    model: ModelDescriptor,
    binding: StageModelBinding
  ) {
    this.model = parseModelDescriptor(model)
    this.binding = parseStageModelBinding(binding)
    const connection = capabilityConnectionReference(config)
    if (
      config.model !== this.model.modelId ||
      config.provider !== this.model.provider ||
      connection.connectionId !== this.binding.connection.connectionId ||
      connection.endpointRevision !==
        this.binding.connection.endpointRevision ||
      this.binding.capability !== 'text.generate'
    )
      throw new ProviderContractError('binding.connection_or_model')
    requireModelCapability(this.model, this.binding)
  }
  private prepare(
    request: TextGenerationRequest,
    streaming: boolean
  ): TextMetadataOptions {
    const envelope = parseProviderRequestEnvelope(request.envelope)
    // Fixed snapshot: callers cannot change stage, connection, model or binding defaults.
    const binding = envelope.binding
    if (
      binding.stage !== this.binding.stage ||
      binding.descriptorId !== this.binding.descriptorId ||
      binding.descriptorRevision !== this.binding.descriptorRevision ||
      binding.modelId !== this.binding.modelId ||
      binding.connection.connectionId !==
        this.binding.connection.connectionId ||
      binding.connection.endpointRevision !==
        this.binding.connection.endpointRevision ||
      JSON.stringify(Object.entries(binding.parameters).sort()) !==
        JSON.stringify(Object.entries(this.binding.parameters).sort()) ||
      envelope.capability !== 'text.generate'
    )
      throw new ProviderContractError('request.binding')
    if (envelope.inputMedia.length)
      throw new ProviderContractError('request.text.inputMedia')
    if (
      !request.prompt ||
      typeof request.prompt.system !== 'string' ||
      typeof request.prompt.user !== 'string'
    )
      throw new ProviderContractError('request.prompt')
    const parameters = { ...binding.parameters, ...envelope.parameters }
    for (const key of Object.keys(parameters)) {
      if (!['maxTokens', 'temperature'].includes(key))
        throw new ProviderContractError(`text.parameters.${key}.unimplemented`)
    }
    const entry = requireModelCapability(this.model, binding, {
      streaming,
      cancellation: request.signal !== undefined,
      limits:
        parameters.maxTokens === undefined
          ? {}
          : { maxOutputTokens: parameters.maxTokens as number }
    })
    validateCapabilityParameters(entry, parameters)
    return {
      maxTokens: parameters.maxTokens as number | undefined,
      temperature: parameters.temperature as number | undefined,
      timeoutMs: envelope.timeoutMs,
      signal: request.signal
    }
  }
  private state(options: TextMetadataOptions): TextGenerationResult {
    const result: TextGenerationResult = {
      kind: 'text',
      text: '',
      completion: 'unknown',
      usage: {}
    }
    options[TEXT_METADATA] = (update: TextMetadata) => {
      const { usage, streamEnded, ...fields } = update
      Object.assign(result, fields)
      Object.assign(result.usage, usage)
      if (
        streamEnded &&
        ['end_turn', 'stop_sequence'].includes(result.finishReason || '')
      )
        result.completion = 'complete'
    }
    return result
  }
  private failure(
    error: unknown,
    result: TextGenerationResult,
    signal?: AbortSignal
  ): TextProviderCallError {
    const safe = signal?.aborted
      ? new LLMRequestError('模型请求已取消', 'cancelled')
      : error instanceof LLMRequestError
        ? error
        : new LLMRequestError('模型请求失败，请检查网络、端点、模型与密钥设置')
    if (!['truncated', 'refused'].includes(result.completion))
      result.completion = 'incomplete'
    if (result.completion === 'refused' && safe.category === 'result_unknown')
      return new TextProviderCallError(
        new LLMRequestError(safe.message, 'content_refusal'),
        result
      )
    if (result.completion === 'truncated' && safe.category === 'result_unknown')
      return new TextProviderCallError(
        new LLMRequestError(safe.message, 'invalid_output'),
        result
      )
    return new TextProviderCallError(safe, result)
  }
  async generate(
    request: TextGenerationRequest
  ): Promise<TextGenerationResult> {
    const options = this.prepare(request, false)
    const result = this.state(options)
    // Preserve partial text when the legacy provider rejects after emitting chunks.
    options.onChunk = (chunk) => {
      result.text += chunk
    }
    try {
      result.text = await this.legacy.generate(request.prompt, options)
      return result
    } catch (error) {
      throw this.failure(error, result, request.signal)
    }
  }
  async *generateStream(
    request: TextGenerationRequest
  ): AsyncGenerator<TextGenerationEvent, void, unknown> {
    const options = this.prepare(request, true)
    const result = this.state(options)
    try {
      for await (const chunk of this.legacy.generateStream(
        request.prompt,
        options
      )) {
        result.text += chunk
        yield { kind: 'delta', text: chunk }
      }
      yield { kind: 'result', result }
    } catch (error) {
      throw this.failure(error, result, request.signal)
    }
  }
}
