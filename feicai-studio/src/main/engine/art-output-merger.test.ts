import { mkdtempSync } from 'fs'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseAssetMarkdown } from '../asset/markdown-parser'
import { ensureProjectDataFileSync } from '../project/project-data-compat'
import { ArtOutputMerger } from './art-output-merger'

const tempDirs: string[] = []

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'feicai-art-merger-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('art-output-merger', () => {
  it('overwrites repeated base assets instead of appending duplicates on rerun', async () => {
    const projectPath = makeProjectDir()

    await ArtOutputMerger.parseAndMerge(`
# 人物提示词
## 江伟

第一次版本。

# 场景道具提示词
## 客厅

白天版本。
`, projectPath, 1)

    await ArtOutputMerger.parseAndMerge(`
# 人物提示词
## 江伟

第二次版本。

# 场景道具提示词
## 客厅

夜晚重制版。
`, projectPath, 1)

    const characters = parseAssetMarkdown(await readFile(join(projectPath, 'assets', 'character-prompts.md'), 'utf-8'))
    const scenes = parseAssetMarkdown(await readFile(join(projectPath, 'assets', 'scene-prompts.md'), 'utf-8'))

    expect(characters).toHaveLength(1)
    expect(characters[0]).toMatchObject({ name: '江伟', promptText: '第二次版本。' })
    expect(scenes).toHaveLength(1)
    expect(scenes[0]).toMatchObject({ name: '客厅', promptText: '夜晚重制版。' })
  })

  it('treats episode provenance titles as the same base asset on rerun', async () => {
    const projectPath = makeProjectDir()

    await ArtOutputMerger.parseAndMerge(`
# 人物提示词
## 宝珠（ep01 新增）

第一版贴身丫鬟设定。

# 场景道具提示词
## ep01 场景宫格

第一版场景宫格。
`, projectPath, 1)

    await ArtOutputMerger.parseAndMerge(`
# 人物提示词
## 宝珠（ep05 新增）

跨集重写后的统一设定。

# 场景道具提示词
## ep01 场景宫格

重跑后的场景宫格。
`, projectPath, 5)

    const characters = parseAssetMarkdown(await readFile(join(projectPath, 'assets', 'character-prompts.md'), 'utf-8'))
    const scenes = parseAssetMarkdown(await readFile(join(projectPath, 'assets', 'scene-prompts.md'), 'utf-8'))

    expect(characters).toHaveLength(1)
    expect(characters[0]).toMatchObject({ name: '宝珠', promptText: '跨集重写后的统一设定。' })
    expect(scenes).toHaveLength(1)
    expect(scenes[0]).toMatchObject({ name: 'ep01 场景宫格', promptText: '重跑后的场景宫格。' })
  })

  it('keeps explicit variants as independent entries and overwrites the same variant only', async () => {
    const projectPath = makeProjectDir()

    await ArtOutputMerger.parseAndMerge(`
# 人物提示词
## 江伟

基础设定。

## 江伟（受伤版）

第一次伤妆。

# 场景道具提示词
## 客厅（夜）

夜景初版。
`, projectPath, 1)

    await ArtOutputMerger.parseAndMerge(`
# 人物提示词
## 江伟（受伤版）

第二次伤妆。

# 场景道具提示词
## 客厅（夜）

夜景终版。
`, projectPath, 1)

    const characters = parseAssetMarkdown(await readFile(join(projectPath, 'assets', 'character-prompts.md'), 'utf-8'))
    const scenes = parseAssetMarkdown(await readFile(join(projectPath, 'assets', 'scene-prompts.md'), 'utf-8'))

    expect(characters.map((asset) => asset.name)).toEqual(['江伟', '江伟（受伤版）'])
    expect(characters.find((asset) => asset.name === '江伟')?.promptText).toBe('基础设定。')
    expect(characters.find((asset) => asset.name === '江伟（受伤版）')?.promptText).toBe('第二次伤妆。')
    expect(scenes).toHaveLength(1)
    expect(scenes[0]).toMatchObject({ name: '客厅（夜）', promptText: '夜景终版。' })
  })

  it('keeps episode-tagged explicit variants as independent entries', async () => {
    const projectPath = makeProjectDir()

    await ArtOutputMerger.parseAndMerge(`
# 人物提示词
## 上官玉儿（ep01 新增）

成年版。

## 上官玉儿·幼年版（ep02 新增·变体 char-001）

幼年版初稿。
`, projectPath, 2)

    await ArtOutputMerger.parseAndMerge(`
# 人物提示词
## 上官玉儿（ep03 新增）

成年版重写。

## 上官玉儿·幼年版（ep02 新增·变体 char-001）

幼年版终稿。
`, projectPath, 3)

    const characters = parseAssetMarkdown(await readFile(join(projectPath, 'assets', 'character-prompts.md'), 'utf-8'))

    expect(characters).toHaveLength(2)
    expect(characters.map((asset) => asset.name)).toEqual(['上官玉儿', '上官玉儿·幼年版（ep02 新增·变体 char-001）'])
    expect(characters.find((asset) => asset.name === '上官玉儿')?.promptText).toBe('成年版重写。')
    expect(characters.find((asset) => asset.name === '上官玉儿·幼年版（ep02 新增·变体 char-001）')?.promptText).toBe('幼年版终稿。')
  })

  it('collapses historical duplicate entries when rerun writes the same asset key again', async () => {
    const projectPath = makeProjectDir()
    const assetsDir = join(projectPath, 'assets')
    await mkdir(assetsDir, { recursive: true })
    await writeFile(
      join(assetsDir, 'character-prompts.md'),
      `## 江伟\n\n旧版本 A。\n\n## 江伟\n\n旧版本 B。\n\n## 江伟（受伤版）\n\n保留变体。`,
      'utf-8'
    )

    await ArtOutputMerger.parseAndMerge(`
# 人物提示词
## 江伟

收敛后的新版本。
`, projectPath, 1)

    const characters = parseAssetMarkdown(await readFile(join(assetsDir, 'character-prompts.md'), 'utf-8'))

    expect(characters).toHaveLength(2)
    expect(characters.map((asset) => asset.name)).toEqual(['江伟', '江伟（受伤版）'])
    expect(characters.find((asset) => asset.name === '江伟')?.promptText).toBe('收敛后的新版本。')
    expect(characters.find((asset) => asset.name === '江伟（受伤版）')?.promptText).toBe('保留变体。')
  })

  it('records current episode asset artifacts for the happy path merge', async () => {
    const projectPath = makeProjectDir()

    const result = await ArtOutputMerger.parseAndMerge(`
# 人物提示词
## 柳青青（ep01 新增）

冷青色长袍，银簪束发，眼神克制。

# 场景道具提示词
## 侯府后院（ep01 新增）

冬日清晨薄雾，青石地面带水痕，镜头可用侧逆光。
`, projectPath, 1)

    expect(result).toEqual({ characters: 1, scenes: 1 })

    const characters = parseAssetMarkdown(await readFile(join(projectPath, 'assets', 'character-prompts.md'), 'utf-8'))
    const scenes = parseAssetMarkdown(await readFile(join(projectPath, 'assets', 'scene-prompts.md'), 'utf-8'))
    expect(characters[0]).toMatchObject({ name: '柳青青', promptText: '冷青色长袍，银簪束发，眼神克制。' })
    expect(scenes[0]).toMatchObject({ name: '侯府后院', promptText: '冬日清晨薄雾，青石地面带水痕，镜头可用侧逆光。' })

    const manifest = ensureProjectDataFileSync<{ artifacts?: Array<{ kind: string; metadata?: { episodeNum?: number }; isCurrent?: boolean }> }>(projectPath, 'artifactManifest').data
    const currentArtifacts = (manifest?.artifacts || []).filter((artifact) => artifact.isCurrent)
    expect(currentArtifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'character_prompts', metadata: expect.objectContaining({ episodeNum: 1 }) }),
      expect.objectContaining({ kind: 'scene_prompts', metadata: expect.objectContaining({ episodeNum: 1 }) })
    ]))
  })
})
