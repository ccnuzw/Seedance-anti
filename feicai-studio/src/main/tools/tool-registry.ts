import type { Schema } from '../../shared/production-contracts/validation'
import type { ToolDescriptor, ToolSchemaRef } from '../../shared/tool-contracts'
import { parseToolDescriptor } from '../../shared/tool-contracts'

export interface RegisteredTool {
  descriptor: ToolDescriptor
  input: Schema<unknown>
  output: Schema<unknown>
  adapter: ToolAdapter
}
export interface ToolAdapterContext {
  readonly signal: AbortSignal
  inspectFile(
    reference: unknown
  ): import('../../shared/tool-contracts').ToolFileReference
}
export interface ToolAdapter {
  /** Enumerate file references before execution; schema and extraction are trusted adapter code. */
  inputResources(input: unknown): unknown[]
  execute(input: unknown, context: ToolAdapterContext): Promise<unknown>
}
const key = (ref: ToolSchemaRef): string =>
  JSON.stringify([ref.id, ref.version])
const toolKey = (id: string, version: string): string =>
  JSON.stringify([id, version])
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
/** Construct and populate only in trusted main code. No discovery, IPC or model-driven registration. */
export class ToolRegistry {
  private readonly schemas = new Map<string, Schema<unknown>>()
  private readonly tools = new Map<string, RegisteredTool>()

  registerSchema(reference: ToolSchemaRef, schema: Schema<unknown>): void {
    // Validate references using the descriptor parser at tool registration as well.
    if (!reference.id || !reference.version || this.schemas.has(key(reference)))
      throw new Error('Duplicate/invalid tool schema')
    this.schemas.set(
      key(reference),
      Object.freeze({ read: schema.read.bind(schema) })
    )
  }

  register(descriptor: unknown, adapter: ToolAdapter): void {
    const parsed = parseToolDescriptor(descriptor)
    const input = this.schemas.get(key(parsed.inputSchema))
    const output = this.schemas.get(key(parsed.outputSchema))
    if (!input || !output) throw new Error('Unknown tool schema/version')
    if (
      parsed.effect !== 'read-only' ||
      parsed.cost !== 'free' ||
      parsed.writeTargets.length ||
      !parsed.allowedDirectories.length
    )
      throw new Error('Only scoped free read-only tools are supported')
    const entryKey = toolKey(parsed.toolId, parsed.version)
    if (this.tools.has(entryKey)) throw new Error('Duplicate tool/version')
    this.tools.set(
      entryKey,
      Object.freeze({
        descriptor: freeze(parsed),
        input,
        output,
        adapter: Object.freeze({
          inputResources: adapter.inputResources.bind(adapter),
          execute: adapter.execute.bind(adapter)
        })
      })
    )
  }

  get(id: string, version: string): RegisteredTool | undefined {
    return this.tools.get(toolKey(id, version))
  }
}
