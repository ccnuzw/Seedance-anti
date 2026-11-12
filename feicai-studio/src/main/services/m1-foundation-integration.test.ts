import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import type { LLMConfig, ProjectConfig, Skill } from '@shared/types'
import { providerContractFixture } from '@shared/provider-capabilities.fixtures'
import {
  getEpisodeArtifactRelativePath,
  resolveProjectArtifactPath,
  resolveProjectLayout
} from '@shared/path-resolver'
import {
  decodeProductionManifest,
  decodeProductionManifestUpdate,
  getProductionPaths,
  previewLegacyProduction
} from '@shared/production-contracts'
import { productionFixture } from '@shared/production-contracts/fixtures'
import { SkillPackageLoader } from '../engine/skill-package-loader'
import { SkillLoader } from '../engine/skill-loader'
import { PromptAssembler } from '../engine/prompt-assembler'
import {
  createProvider,
  createTextCapabilityProvider
} from '../llm/provider-factory'
import { capabilityConnectionReference } from '../llm/text-capability-adapter'
import { AssetManager } from '../asset/asset-manager'

// Explicit test composition of independent M1 APIs, not a production consumer.
// All HTTP is intercepted; only repository builtin text and temporary files are read.
const builtin = join(process.cwd(), 'resources/builtin-skills')
const fetchMock = vi.fn()
const temporary: string[] = []
function temp() {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'feicai-m1-')))
  temporary.push(path)
  return path
}
afterEach(() => {
  vi.unstubAllGlobals()
  for (const path of temporary.splice(0))
    rmSync(path, { recursive: true, force: true })
})
const context = {
  projectName: 'M1 controlled',
  visualStyle: '写实',
  targetMedium: '短剧',
  episodeNumber: 1
}
const assembler = new PromptAssembler()

describe('M1 builtin → legacy assembler → actual provider bridge', () => {
  describe.each([
    'openai',
    'openai-compatible',
    'anthropic',
    'google'
  ] as const)('%s wire', (provider) => {
    it.each(['novel', 'story', 'script'] as const)(
      '%s keeps builtin prompt/parameters and distinguishes completion from text',
      async (entry) => {
        const snapshot = await new SkillPackageLoader(builtin).load(
          'script-generation-skill',
          {
            stage: 'script',
            entry,
            projectOverrides: {
              scriptWordCountMin: 1200,
              scriptWordCountMax: 1800
            }
          }
        )
        const inputs =
          entry === 'novel'
            ? {
                sourceNovel: '受控原文',
                plotBreakdown: '【剧情1】受控绑定库存'
              }
            : entry === 'story'
              ? { storyBeat: '受控已审人工剧情' }
              : { script: '受控导入剧本' }
        const assemble = (skill: Skill) =>
          assembler.assemble(
            skill,
            '受控角色',
            inputs,
            { ...context, ...snapshot.parameters },
            'script_generation',
            undefined,
            entry
          )
        const prompt = assemble(snapshot.legacySkill as Skill)
        expect(prompt).toEqual(
          assemble(
            await new SkillLoader(builtin).load('script-generation-skill')
          )
        )
        expect(prompt.user).toContain('1200-1800')
        if (entry !== 'novel') {
          expect(prompt.user).not.toContain('# 小说原文与设定')
          expect(prompt.user).not.toContain('# 当前集剧情库存')
        }
        const config: LLMConfig = {
          id: 'm1-test',
          name: 'controlled',
          provider,
          category: 'llm',
          model: 'test-model',
          baseUrl: 'https://m1.invalid/v1',
          apiKey: 'synthetic-only',
          maxTokens: 123,
          temperature: 0.2,
          isDefault: false
        }
        const { model, binding, request } = providerContractFixture()
        model.provider = provider
        binding.connection = capabilityConnectionReference(config)
        model.evidence[0].connection = { ...binding.connection }
        binding.parameters = { maxTokens: 64 }
        request.envelope.parameters =
          provider === 'openai-compatible' ? {} : { temperature: 0 }
        request.prompt = prompt
        // Entry selects a different controlled terminal condition; none authorizes review/adoption.
        const complete = entry === 'novel',
          truncated = entry === 'story'
        const text = '受控文本，不能仅因有正文判为完成'
        const finish = complete
          ? provider === 'anthropic'
            ? 'end_turn'
            : provider === 'google'
              ? 'STOP'
              : 'stop'
          : truncated
            ? provider === 'anthropic'
              ? 'max_tokens'
              : provider === 'google'
                ? 'MAX_TOKENS'
                : 'length'
            : undefined
        const body =
          provider === 'anthropic'
            ? { content: [{ type: 'text', text }], stop_reason: finish }
            : provider === 'google'
              ? {
                  candidates: [
                    { content: { parts: [{ text }] }, finishReason: finish }
                  ]
                }
              : {
                  choices: [
                    { message: { content: text }, finish_reason: finish }
                  ]
                }
        fetchMock.mockReset().mockImplementation(
          async () =>
            new Response(JSON.stringify(body), {
              headers: { 'content-type': 'application/json' }
            })
        )
        vi.stubGlobal('fetch', fetchMock)
        expect(
          await createProvider(config).generate(prompt, {
            maxTokens: 64,
            ...(provider === 'openai-compatible' ? {} : { temperature: 0 })
          })
        ).toBe(text)
        const result = await createTextCapabilityProvider(
          config,
          model,
          binding
        ).generate(request)
        expect(result).toMatchObject({
          text,
          completion: complete
            ? 'complete'
            : truncated
              ? 'truncated'
              : 'unknown',
          usage: {}
        })
        expect(result.usage.billedCost).toBeUndefined()
        expect(result.usage.inputTokens).toBeUndefined()
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(fetchMock.mock.calls[1][1].body).toBe(
          fetchMock.mock.calls[0][1].body
        )
        const wire = JSON.parse(fetchMock.mock.calls[1][1].body)
        const params = provider === 'google' ? wire.generationConfig : wire
        expect(
          params[provider === 'google' ? 'maxOutputTokens' : 'max_tokens']
        ).toBe(64)
        if (provider === 'openai-compatible')
          expect(params).not.toHaveProperty('temperature')
        else expect(params.temperature).toBe(0)
        expect(JSON.stringify(wire)).toContain('受控')
        expect(JSON.stringify(wire)).not.toContain('synthetic-only')
      }
    )
  })

  it.each(['novel', 'story', 'script'] as const)(
    '%s uses real builtin applicability rather than inventing a story prerequisite',
    async (entry) => {
      const loader = new SkillPackageLoader(builtin)
      const generation = loader.load('story-breakdown-skill', {
        stage: 'story',
        entry
      })
      if (entry === 'novel')
        await expect(generation).resolves.toHaveProperty('legacySkill')
      else await expect(generation).rejects.toThrow('not applicable')
      const review = loader.load('story-breakdown-review-skill', {
        stage: 'story_review',
        entry
      })
      if (entry === 'script')
        await expect(review).rejects.toThrow('not applicable')
      else await expect(review).resolves.toHaveProperty('legacySkill')
      await expect(
        loader.load('script-generation-skill', { stage: 'script', entry })
      ).resolves.toHaveProperty('legacySkill')
      await expect(
        loader.load('script-review-skill', { stage: 'script_review', entry })
      ).resolves.toHaveProperty('legacySkill')
    }
  )

  it('holds captured dependency bytes and assembled review stable while fresh builtin identity changes', async () => {
    const root = join(temp(), 'builtin')
    cpSync(builtin, root, { recursive: true })
    const loader = new SkillPackageLoader(root)
    const held = await loader.load('script-review-skill', {
      stage: 'script_review',
      entry: 'script'
    })
    const dependency = held.resources.find((resource) =>
      resource.path.startsWith('script-generation-skill/')
    )!
    expect(dependency).toBeDefined()
    const review = () =>
      assembler.assembleReview(
        held.legacySkill as Skill,
        '受控审核',
        '待审正文',
        undefined,
        undefined,
        undefined,
        undefined,
        'script',
        'script_review'
      )
    const before = review()
    const file = join(root, dependency.path)
    writeFileSync(
      file,
      `${readFileSync(file, 'utf8')}\nM1 changed dependency\n`
    )
    const fresh = await loader.load('script-review-skill')
    expect(fresh.manifest.version).toBe(held.manifest.version)
    expect(fresh.manifest.contentHash).not.toBe(held.manifest.contentHash)
    expect(review()).toEqual(before)
    expect(Object.isFrozen(held.legacySkill!.templates)).toBe(true)
    expect(Object.isFrozen(held.resources[0])).toBe(true)
    await expect(
      loader.load('script-review-skill', {
        selection: {
          source: 'builtin',
          skillName: 'script-review-skill',
          expected: held.manifest
        }
      })
    ).rejects.toThrow('contentHash mismatch')
  })
})

describe('M1 legacy files and detached version contracts', () => {
  it('previews actual legacy assets/scripts in a custom layout without promoting UUIDs or writing manifests', async () => {
    const root = temp()
    const config: Partial<ProjectConfig> = {
      entryStage: 'script',
      directories: {
        scriptDir: 'custom/scripts',
        assetsDir: 'custom/assets',
        outputsDir: 'custom/outputs'
      }
    }
    const file = resolveProjectArtifactPath(root, 'characterPrompts', config)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '# 人物提示词\n\n## 林舟\n灰衣人物。\n')
    const manager = new AssetManager(root, config)
    const script = '# 导入剧本\n无法结构化的 **正文**\n【卡黑】'
    await manager.saveScript(1, script)
    const characters = await manager.loadCharacters()
    expect(characters).toHaveLength(1)
    expect((await manager.loadCharacters())[0].id).not.toBe(characters[0].id)
    const preview = previewLegacyProduction({
      projectId: 'project-1',
      scripts: [
        {
          relativePath: getEpisodeArtifactRelativePath('script', 1, config),
          markdown: await manager.loadScript(1)
        }
      ],
      characters,
      scenes: await manager.loadScenes()
    })
    expect(preview).toMatchObject({
      ok: true,
      value: {
        status: 'needs-confirmation',
        scripts: [{ markdown: script, stableRevisionId: null }],
        assets: [
          {
            legacyId: characters[0].id,
            stableAssetId: null,
            stableRevisionId: null
          }
        ]
      }
    })
    expect(readFileSync(file, 'utf8')).toContain('灰衣人物')
    const layout = resolveProjectLayout(config)
    const paths = getProductionPaths(layout)
    expect(paths.manifest).toBe('custom/outputs/production/manifest.v1.json')
    const { existsSync } = await import('node:fs')
    expect(existsSync(join(root, paths.manifest))).toBe(false)
    expect(relative(root, file)).toBe('custom/assets/character-prompts.md')
  })

  it('carries an explicitly mapped builtin hash in version history without confusing it with adoption or latest revision', async () => {
    const snapshot = await new SkillPackageLoader(builtin).load(
      'director-skill',
      { stage: 'director', entry: 'script' }
    )
    const manifest = productionFixture()
    const layout = resolveProjectLayout({
      directories: { assetsDir: 'custom/assets', outputsDir: 'custom/outputs' }
    })
    for (const media of manifest.media)
      media.relativePath = `custom/${media.relativePath}`
    // T02 ExternalVersionRef uses bare hex; F02 uses sha256:hex. Mapping is explicit test data only.
    manifest.promptRevisions[0].skill = {
      id: snapshot.manifest.skillId,
      version: snapshot.manifest.version,
      contentHash: snapshot.manifest.contentHash.slice('sha256:'.length)
    }
    expect(decodeProductionManifest(manifest, { layout }).ok).toBe(true)
    expect(decodeProductionManifest(manifest).ok).toBe(false)
    const renamed = structuredClone(manifest)
    renamed.assets[0].name = '重新命名人物'
    expect(
      decodeProductionManifestUpdate(manifest, renamed, { layout }).ok
    ).toBe(true)
    expect(renamed.bindings[0].assetRevisionId).toBe('hero-r1')
    expect(renamed.cuts[0].clips[0].mediaId).toBe('video-old')
    const retargeted = structuredClone(renamed)
    retargeted.bindings[0].assetRevisionId = 'hero-r2'
    const result = decodeProductionManifestUpdate(renamed, retargeted, {
      layout
    })
    expect(result.ok).toBe(false)
    const changedSkill = structuredClone(renamed)
    changedSkill.promptRevisions[0].skill!.contentHash = 'f'.repeat(64)
    expect(
      decodeProductionManifestUpdate(renamed, changedSkill, { layout }).ok
    ).toBe(false)
    expect(
      decodeProductionManifest({ ...manifest, schemaVersion: 2 }, { layout })
    ).toMatchObject({ ok: false, issues: [{ code: 'unknown_schema' }] })
  })
})
