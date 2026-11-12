import { describe, expect, it } from 'vitest'
import { DEFAULT_PIPELINE_SETTINGS } from './pipeline-settings'
import {
  parseSkillPackageManifest,
  resolveSkillParameters
} from './skill-package'

function manifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    skillId: 'studio.script',
    version: '1.0.0',
    contentHash: `sha256:${'a'.repeat(64)}`,
    entrypoints: [
      { stage: 'script', entries: ['novel', 'story'], promptRef: 'role' }
    ],
    resources: [
      { resourceId: 'role', path: 'role.md', kind: 'prompt' },
      { resourceId: 'output', path: 'output.json', kind: 'schema' },
      { resourceId: 'rules', path: 'rules.json', kind: 'rules' }
    ],
    requiredInputs: ['story'],
    outputSchemaRef: 'output',
    ruleProfileRef: 'rules',
    parameterContract: 'pipeline-settings/v1',
    allowedOverrides: ['durationMin', 'durationMax'],
    modelCapabilities: ['text.generate'],
    toolRequirements: [
      { toolId: 'asset.lookup', version: '1', purpose: 'Find references' }
    ]
  }
}

describe('Skill package contract', () => {
  it('decodes references and declarations into a detached value', () => {
    const input = manifest()
    const decoded = parseSkillPackageManifest(input)
    expect(decoded.outputSchemaRef).toBe('output')
    expect(decoded.toolRequirements[0].toolId).toBe('asset.lookup')
    ;(input.resources as unknown[]).pop()
    expect(decoded.resources).toHaveLength(3)
  })

  it.each([
    { schemaVersion: 2 },
    { schemaVersion: '1' },
    { contentHash: 'version-1' },
    { parameterContract: 'new-contract' },
    { outputSchemaRef: 'missing' },
    { outputSchemaRef: 'role' },
    { ruleProfileRef: 'output' },
    { allowedOverrides: ['systemPrompt'] },
    { allowedOverrides: ['passScore', 'passScore'] },
    { requiredInputs: null },
    { entrypoints: [] },
    {
      entrypoints: [{ stage: 'unknown', entries: ['novel'], promptRef: 'role' }]
    },
    {
      entrypoints: [
        { stage: 'script', entries: ['unknown'], promptRef: 'role' }
      ]
    },
    {
      entrypoints: [{ stage: 'script', entries: ['novel'], promptRef: 'rules' }]
    },
    {
      toolRequirements: [
        { toolId: 'tool', version: '1', purpose: 'test', granted: true }
      ]
    },
    { unknown: true }
  ])('rejects invalid schema/fields: %j', (patch) => {
    expect(() =>
      parseSkillPackageManifest({ ...manifest(), ...patch })
    ).toThrow()
  })

  it.each([
    '../outside.md',
    '/outside.md',
    'a/../role.md',
    'a//role.md',
    './role.md',
    'C:/role.md',
    'a\\role.md',
    'run.ts',
    'bad\0.md'
  ])('rejects unsafe or nontext resource %s', (path) => {
    expect(() =>
      parseSkillPackageManifest({
        ...manifest(),
        resources: [{ resourceId: 'role', path, kind: 'prompt' }]
      })
    ).toThrow()
  })

  it('rejects duplicate IDs and duplicate paths', () => {
    for (const field of ['resourceId', 'path']) {
      const input = manifest()
      const resources = input.resources as Record<string, unknown>[]
      resources[1][field] = resources[0][field]
      expect(() => parseSkillPackageManifest(input)).toThrow('Duplicate')
    }
  })
})

describe('Skill parameter resolution', () => {
  it('inherits existing defaults and merges explicit project then run values with provenance', () => {
    expect(resolveSkillParameters([]).parameters).toEqual(
      DEFAULT_PIPELINE_SETTINGS
    )
    const result = resolveSkillParameters(
      ['maxRetries', 'durationMin', 'durationMax'],
      { durationMin: 80 },
      { maxRetries: 0, durationMax: 140 },
      { durationMax: 150 }
    )
    expect(result.parameters).toEqual({
      ...DEFAULT_PIPELINE_SETTINGS,
      durationMin: 80,
      durationMax: 150,
      maxRetries: 0
    })
    expect(result.parameterSources).toMatchObject({
      durationMin: 'base',
      durationMax: 'run',
      maxRetries: 'project',
      passScore: 'default'
    })
  })
  it.each([
    null,
    [],
    { maxRetries: null },
    { maxRetries: undefined },
    { maxRetries: -1 },
    { maxRetries: 1.5 },
    { maxRetries: Infinity },
    { toolRequirements: [] },
    { ruleProfileRef: null }
  ])('rejects illegal supplied values %j', (input) => {
    expect(() =>
      resolveSkillParameters(['maxRetries'], undefined, input)
    ).toThrow()
  })
  it('rejects unauthorized fields at either layer and final cross-field violations', () => {
    expect(() =>
      resolveSkillParameters([], undefined, { maxRetries: 1 })
    ).toThrow('not allowed')
    expect(() =>
      resolveSkillParameters([], undefined, undefined, { maxRetries: 1 })
    ).toThrow('not allowed')
    expect(() =>
      resolveSkillParameters(['durationMin'], undefined, { durationMin: 200 })
    ).toThrow()
  })
  it('does not let a run lower the review threshold or mutate inputs', () => {
    const base = { passScore: 8 }
    expect(() =>
      resolveSkillParameters(['passScore'], base, undefined, { passScore: 7 })
    ).toThrow('cannot lower')
    expect(
      resolveSkillParameters(['passScore'], base, undefined, { passScore: 9 })
        .parameters.passScore
    ).toBe(9)
    expect(base).toEqual({ passScore: 8 })
  })
})
