import { createHash } from 'crypto'
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile
} from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  SkillPackageDefinition,
  SkillPackageManifest,
  SkillStage
} from '@shared/skill-package'
import type { ProjectEntryStage } from '@shared/types'
import { PromptAssembler } from './prompt-assembler'
import { SkillLoader } from './skill-loader'
import {
  calculateSkillPackageHash,
  SkillPackageLoader
} from './skill-package-loader'

const builtinRoot = fileURLToPath(
  new URL('../../../resources/builtin-skills/', import.meta.url)
)
const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})
async function temp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'feicai-skill-package-'))
  roots.push(root)
  return root
}
function definition(): SkillPackageDefinition {
  return {
    schemaVersion: 1,
    skillId: 'project.script',
    version: '1.0.0',
    entrypoints: [
      { stage: 'script', entries: ['novel', 'story'], promptRef: 'role' }
    ],
    resources: [
      { resourceId: 'role', path: 'SKILL.md', kind: 'prompt' },
      { resourceId: 'template', path: 'templates/script.md', kind: 'template' },
      { resourceId: 'output', path: 'output.json', kind: 'schema' },
      { resourceId: 'rules', path: 'rules.json', kind: 'rules' }
    ],
    requiredInputs: ['story', 'characters'],
    inputSchemaRef: 'output',
    outputSchemaRef: 'output',
    ruleProfileRef: 'rules',
    parameterContract: 'pipeline-settings/v1',
    allowedOverrides: ['maxRetries', 'durationMin', 'durationMax'],
    toolRequirements: [
      { toolId: 'asset.lookup', version: '1', purpose: 'Find references' }
    ],
    modelCapabilities: ['text.generate', 'text.structured']
  }
}
const initialContents = [
  { path: 'SKILL.md', content: '\uFEFF# Role\r\nDo good work.\r\n' },
  { path: 'templates/script.md', content: '# Template' },
  { path: 'output.json', content: '{"type":"object"}' },
  { path: 'rules.json', content: '{"critical":"block"}' }
]
async function project(): Promise<{
  root: string
  manifest: SkillPackageManifest
}> {
  const root = await temp()
  await mkdir(join(root, 'templates'))
  for (const resource of initialContents)
    await writeFile(join(root, resource.path), resource.content)
  const data = definition()
  const manifest = {
    ...data,
    contentHash: calculateSkillPackageHash(data, initialContents)
  }
  await writeFile(join(root, 'skill-package.json'), JSON.stringify(manifest))
  return { root, manifest }
}
function selected(root: string, expected: SkillPackageManifest) {
  return {
    selection: { source: 'project' as const, packageDir: root, expected }
  }
}

describe('deterministic Skill hash', () => {
  it('is independent of object/collection/file enumeration order and package location', async () => {
    const first = definition()
    const reversed = {
      ...first,
      entrypoints: first.entrypoints.map((entry) => ({
        ...entry,
        entries: [...entry.entries].reverse()
      })),
      resources: [...first.resources].reverse(),
      requiredInputs: [...first.requiredInputs].reverse(),
      allowedOverrides: [...first.allowedOverrides].reverse(),
      modelCapabilities: [...first.modelCapabilities].reverse()
    }
    expect(calculateSkillPackageHash(first, initialContents)).toBe(
      calculateSkillPackageHash(reversed, [...initialContents].reverse())
    )
    const a = await project()
    const b = await project()
    const loader = new SkillPackageLoader(builtinRoot)
    expect(
      (await loader.load('', selected(a.root, a.manifest))).manifest.contentHash
    ).toBe(
      (await loader.load('', selected(b.root, b.manifest))).manifest.contentHash
    )
  })
  it('covers every declared byte and the production contract', () => {
    const original = calculateSkillPackageHash(definition(), initialContents)
    for (const resource of initialContents) {
      const changed = initialContents.map((item) =>
        item === resource ? { ...item, content: item.content + '\n' } : item
      )
      expect(calculateSkillPackageHash(definition(), changed)).not.toBe(
        original
      )
    }
    expect(
      calculateSkillPackageHash(
        { ...definition(), version: '1.0.1' },
        initialContents
      )
    ).not.toBe(original)
    expect(
      calculateSkillPackageHash(
        { ...definition(), allowedOverrides: [] },
        initialContents
      )
    ).not.toBe(original)
    expect(() =>
      calculateSkillPackageHash(definition(), initialContents.slice(1))
    ).toThrow()
  })
})

describe('explicit project packages', () => {
  it('retains exact content and effective parameters without executing declarations', async () => {
    const { root, manifest } = await project()
    const snapshot = await new SkillPackageLoader(builtinRoot).load('', {
      ...selected(root, manifest),
      stage: 'script',
      entry: 'story',
      projectOverrides: { maxRetries: 0, durationMax: 140 },
      runOverrides: { durationMax: 150 }
    })
    expect(
      snapshot.resources.find((resource) => resource.resourceId === 'role')
        ?.content
    ).toBe(initialContents[0].content)
    expect(snapshot.resources[0].contentHash).toMatch(/^sha256:/)
    expect(snapshot.parameters).toMatchObject({
      maxRetries: 0,
      durationMax: 150
    })
    expect(snapshot.parameterSources).toMatchObject({
      maxRetries: 'project',
      durationMax: 'run'
    })
    expect(snapshot.manifest.toolRequirements[0].toolId).toBe('asset.lookup')
    expect(snapshot.legacySkill).toBeUndefined()
    expect(await readFile(join(root, 'skill-package.json'), 'utf8')).toBe(
      JSON.stringify(manifest)
    )
  })
  it('rejects tampering, wrong fixed identities, missing files and unknown schema', async () => {
    const { root, manifest } = await project()
    const loader = new SkillPackageLoader(builtinRoot)
    for (const patch of [
      { version: '2' },
      { skillId: 'other' },
      { contentHash: `sha256:${'0'.repeat(64)}` }
    ])
      await expect(
        loader.load('', selected(root, { ...manifest, ...patch }))
      ).rejects.toThrow('mismatch')
    await expect(
      loader.load('', {
        selection: { source: 'project', packageDir: root }
      } as never)
    ).rejects.toThrow('fixed Skill reference')
    await writeFile(join(root, 'rules.json'), '{}')
    await expect(loader.load('', selected(root, manifest))).rejects.toThrow(
      'contentHash mismatch'
    )
    await unlink(join(root, 'rules.json'))
    await expect(loader.load('', selected(root, manifest))).rejects.toThrow(
      'ENOENT'
    )
    await writeFile(
      join(root, 'skill-package.json'),
      JSON.stringify({ ...manifest, schemaVersion: 99 })
    )
    await expect(loader.load('', selected(root, manifest))).rejects.toThrow(
      'schemaVersion'
    )
  })
  it('rejects nonfiles and invalid UTF-8 instead of keeping a lossy snapshot', async () => {
    const { root, manifest } = await project()
    const loader = new SkillPackageLoader(builtinRoot)
    await writeFile(join(root, 'rules.json'), Buffer.from([0xff, 0xfe]))
    await expect(loader.load('', selected(root, manifest))).rejects.toThrow()
    await unlink(join(root, 'rules.json'))
    await mkdir(join(root, 'rules.json'))
    await expect(loader.load('', selected(root, manifest))).rejects.toThrow(
      'not a file'
    )
  })

  it('rejects unallowed overrides and incompatible stage/entry without falling back', async () => {
    const { root, manifest } = await project()
    const loader = new SkillPackageLoader(builtinRoot)
    await expect(
      loader.load('script-generation-skill', {
        ...selected(root, manifest),
        runOverrides: { passScore: 0 }
      })
    ).rejects.toThrow('not allowed')
    await expect(
      loader.load('', { ...selected(root, manifest), stage: 'art' })
    ).rejects.toThrow('not applicable')
    await expect(
      loader.load('', {
        ...selected(root, manifest),
        stage: 'script',
        entry: 'script'
      })
    ).rejects.toThrow('not applicable')
  })
  it('reads new content/version on the same loader but preserves a detached frozen old snapshot after edits/deletion', async () => {
    const { root, manifest } = await project()
    const loader = new SkillPackageLoader(builtinRoot)
    const first = await loader.load('', selected(root, manifest))
    const preserved = JSON.stringify(first)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.resources[0])).toBe(true)
    expect(Object.isFrozen(first.manifest.entrypoints[0].entries)).toBe(true)
    expect(Object.isFrozen(first.parameters)).toBe(true)
    const updated = initialContents.map((item) =>
      item.path === 'SKILL.md' ? { ...item, content: '# New role' } : item
    )
    const nextDefinition = { ...definition(), version: '1.1.0' }
    const next = {
      ...nextDefinition,
      contentHash: calculateSkillPackageHash(nextDefinition, updated)
    }
    await writeFile(join(root, 'SKILL.md'), '# New role')
    await writeFile(join(root, 'skill-package.json'), JSON.stringify(next))
    const second = await loader.load('', selected(root, next))
    expect(second.manifest.version).toBe('1.1.0')
    expect(second.manifest.contentHash).not.toBe(first.manifest.contentHash)
    await expect(loader.load('', selected(root, manifest))).rejects.toThrow(
      'mismatch'
    )
    await rm(root, { recursive: true })
    expect(JSON.stringify(first)).toBe(preserved)
    expect(
      second.resources.find((resource) => resource.resourceId === 'role')
        ?.content
    ).toBe('# New role')
  })
  it('rejects traversal plus resource/directory/manifest symlink escapes; permits internal symlinks', async () => {
    const { root, manifest } = await project()
    const outside = await temp()
    await writeFile(join(outside, 'rules.json'), initialContents[3].content)
    await mkdir(join(outside, 'templates'))
    await writeFile(
      join(outside, 'templates/script.md'),
      initialContents[1].content
    )
    const loader = new SkillPackageLoader(builtinRoot)
    await unlink(join(root, 'rules.json'))
    await symlink(join(outside, 'rules.json'), join(root, 'rules.json'))
    await expect(loader.load('', selected(root, manifest))).rejects.toThrow(
      'symlink escapes'
    )
    await unlink(join(root, 'rules.json'))
    await writeFile(join(root, 'internal.json'), initialContents[3].content)
    await symlink(join(root, 'internal.json'), join(root, 'rules.json'))
    await expect(
      loader.load('', selected(root, manifest))
    ).resolves.toHaveProperty('manifest.contentHash', manifest.contentHash)
    await rm(join(root, 'templates'), { recursive: true })
    await symlink(join(outside, 'templates'), join(root, 'templates'))
    await expect(loader.load('', selected(root, manifest))).rejects.toThrow(
      'symlink escapes'
    )
    await unlink(join(root, 'skill-package.json'))
    await writeFile(
      join(outside, 'skill-package.json'),
      JSON.stringify(manifest)
    )
    await symlink(
      join(outside, 'skill-package.json'),
      join(root, 'skill-package.json')
    )
    await expect(loader.load('', selected(root, manifest))).rejects.toThrow(
      'symlink escapes'
    )
    await unlink(join(root, 'skill-package.json'))
    await writeFile(
      join(root, 'skill-package.json'),
      JSON.stringify({
        ...manifest,
        resources: [
          { resourceId: 'role', path: '../outside.md', kind: 'prompt' }
        ]
      })
    )
    await expect(loader.load('', selected(root, manifest))).rejects.toThrow(
      'Unsafe'
    )
  })
})

describe('builtin compatibility packages', () => {
  // Expected applicability from WorkflowEngine's generation/review gates. In
  // particular, script generation also revises imported scripts; it is not
  // limited to novel/story sources. No project inventory is needed to load the
  // skills for a first novel batch. Review roles have separate contract stages.
  const builtinEntryMatrix: Array<{
    skillName: string
    stage: SkillStage
    entries: ProjectEntryStage[]
  }> = [
    {
      skillName: 'feicai-producer-skill',
      stage: 'producer',
      entries: ['novel', 'story', 'script']
    },
    { skillName: 'story-breakdown-skill', stage: 'story', entries: ['novel'] },
    {
      skillName: 'story-breakdown-review-skill',
      stage: 'story_review',
      entries: ['novel', 'story']
    },
    {
      skillName: 'script-generation-skill',
      stage: 'script',
      entries: ['novel', 'story', 'script']
    },
    {
      skillName: 'script-review-skill',
      stage: 'script_review',
      entries: ['novel', 'story', 'script']
    },
    {
      skillName: 'director-skill',
      stage: 'director',
      entries: ['novel', 'story', 'script']
    },
    {
      skillName: 'script-analysis-review-skill',
      stage: 'director_review',
      entries: ['novel', 'story', 'script']
    },
    {
      skillName: 'character-design-skill',
      stage: 'character',
      entries: ['novel', 'story', 'script']
    },
    {
      skillName: 'art-design-skill',
      stage: 'art',
      entries: ['novel', 'story', 'script']
    },
    {
      skillName: 'art-direction-review-skill',
      stage: 'art_review',
      entries: ['novel', 'story', 'script']
    },
    {
      skillName: 'seedance-storyboard-skill',
      stage: 'storyboard',
      entries: ['novel', 'story', 'script']
    },
    {
      skillName: 'seedance-prompt-review-skill',
      stage: 'storyboard_review',
      entries: ['novel', 'story', 'script']
    },
    {
      skillName: 'compliance-review-skill',
      stage: 'compliance_review',
      entries: ['novel', 'story', 'script']
    }
  ]
  it.each(
    builtinEntryMatrix.flatMap(({ skillName, stage, entries }) =>
      (['novel', 'story', 'script'] as const).map((entry) => ({
        skillName,
        stage,
        entry,
        applicable: entries.includes(entry)
      }))
    )
  )(
    '$skillName / $stage / $entry applies=$applicable',
    async ({ skillName, stage, entry, applicable }) => {
      const loading = new SkillPackageLoader(builtinRoot).load(skillName, {
        stage,
        entry
      })
      if (applicable) {
        await expect(loading).resolves.toMatchObject({
          manifest: {
            skillId: skillName,
            entrypoints: [{ stage, entries: expect.arrayContaining([entry]) }]
          },
          source: { kind: 'builtin' }
        })
      } else {
        await expect(loading).rejects.toThrow(
          `Skill is not applicable to stage/entry: ${stage}/${entry}`
        )
      }
    }
  )

  it('maps every real builtin and preserves legacy prompt/template output', async () => {
    const legacyLoader = new SkillLoader(builtinRoot)
    const loader = new SkillPackageLoader(builtinRoot)
    for (const { name } of await legacyLoader.listAll()) {
      const legacy = await legacyLoader.load(name)
      const snapshot = await loader.load(name)
      expect(snapshot.legacySkill).toEqual(legacy)
      expect(snapshot.resources.length).toBeGreaterThan(0)
      expect(
        calculateSkillPackageHash(snapshot.manifest, snapshot.resources)
      ).toBe(snapshot.manifest.contentHash)
      if (name.includes('review')) {
        const prompt = new PromptAssembler().assembleReview(
          legacy,
          '严格审核',
          '# 正文'
        )
        const capturedPrompt = new PromptAssembler().assembleReview(
          snapshot.legacySkill as typeof legacy,
          '严格审核',
          '# 正文'
        )
        expect(capturedPrompt).toEqual(prompt)
      }
    }
    const script = await loader.load('script-generation-skill')
    expect(script.legacySkill?.templates['script-template']).toContain('第')
    const frozen = JSON.stringify(script)
    expect(() => {
      ;(script.legacySkill!.templates as Record<string, string>)[
        'script-template'
      ] = 'tampered'
    }).toThrow()
    expect(JSON.stringify(script)).toBe(frozen)
  })
  it('captures all actual cross-package dependency bytes and verifies their individual hashes', async () => {
    const loader = new SkillPackageLoader(builtinRoot)
    const snapshot = await loader.load('script-review-skill')
    const dependency = snapshot.resources.find(
      (resource) => resource.path === 'script-generation-skill/adapt-method.md'
    )!
    const realContent = await readFile(
      join(builtinRoot, dependency.path),
      'utf8'
    )
    expect(dependency.content).toBe(realContent)
    expect(dependency.contentHash).toBe(
      `sha256:${createHash('sha256').update(realContent).digest('hex')}`
    )
    expect(snapshot.legacySkill?.methodology).toContain(realContent)
    await expect(
      loader.load('script-review-skill', {
        selection: {
          source: 'builtin',
          skillName: 'script-review-skill',
          expected: {
            ...snapshot.manifest,
            contentHash: `sha256:${'0'.repeat(64)}`
          }
        }
      })
    ).rejects.toThrow('mismatch')
  })
  it('detects builtin dependency edits using the same loader and isolates old captures', async () => {
    const root = await temp()
    await mkdir(join(root, 'script-review-skill'))
    await mkdir(join(root, 'script-generation-skill'))
    await writeFile(
      join(root, 'script-review-skill/SKILL.md'),
      '---\nname: script-review-skill\ndependencies: [../script-generation-skill/rules.md]\n---\n# Review'
    )
    await writeFile(
      join(root, 'script-generation-skill/rules.md'),
      'Original rules'
    )
    const loader = new SkillPackageLoader(root)
    const first = await loader.load('script-review-skill')
    await writeFile(
      join(root, 'script-generation-skill/rules.md'),
      'Changed rules'
    )
    const second = await loader.load('script-review-skill')
    expect(first.manifest.version).toBe(second.manifest.version)
    expect(first.manifest.contentHash).not.toBe(second.manifest.contentHash)
    expect(first.legacySkill?.methodology).toContain('Original rules')
    expect(second.legacySkill?.methodology).toContain('Changed rules')
    await unlink(join(root, 'script-generation-skill/rules.md'))
    await expect(loader.load('script-review-skill')).rejects.toThrow('ENOENT')
    const outside = await temp()
    await writeFile(join(outside, 'rules.md'), 'Outside')
    await symlink(
      join(outside, 'rules.md'),
      join(root, 'script-generation-skill/rules.md')
    )
    await expect(loader.load('script-review-skill')).rejects.toThrow(
      'symlink escapes'
    )
    await symlink(
      join(root, 'script-review-skill'),
      join(root, 'script-review-skill/cycle')
    )
    await expect(loader.load('script-review-skill')).rejects.toThrow(
      'symlink cycle'
    )
  })
})
