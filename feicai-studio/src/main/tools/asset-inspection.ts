import { object } from '../../shared/production-contracts/validation'
import { toolFileReferenceSchema } from '../../shared/tool-contracts'
import type {
  ToolFileReference,
  ToolDescriptor
} from '../../shared/tool-contracts'
import type { ToolRegistry } from './tool-registry'

export const ASSET_INSPECTION_TOOL: ToolDescriptor = {
  schemaVersion: 1,
  toolId: 'builtin.inspect-asset-reference',
  version: '1',
  transport: 'builtin',
  inputSchema: { id: 'asset-reference-input', version: '1' },
  outputSchema: { id: 'asset-reference-output', version: '1' },
  effect: 'read-only',
  cost: 'free',
  scope: 'project-files',
  allowedDirectories: ['assets'],
  writeTargets: [],
  idempotency: 'supported',
  cancellation: 'cooperative',
  retry: 'never'
}
/** Verify an existing asset's size/hash and project containment. Does not parse media or publish it. */
export function registerAssetInspectionTool(registry: ToolRegistry): void {
  const schema = object<{ file: ToolFileReference }>({
    file: toolFileReferenceSchema
  })
  registry.registerSchema(ASSET_INSPECTION_TOOL.inputSchema, schema)
  registry.registerSchema(ASSET_INSPECTION_TOOL.outputSchema, schema)
  registry.register(ASSET_INSPECTION_TOOL, {
    inputResources: (input) => [(input as { file: ToolFileReference }).file],
    async execute(input, context) {
      const file = context.inspectFile(
        (input as { file: ToolFileReference }).file
      )
      return { schemaVersion: 1, data: { file }, resources: [file] }
    }
  })
}
