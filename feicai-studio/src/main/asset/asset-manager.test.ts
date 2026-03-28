import { mkdtempSync } from 'fs'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { AssetManager } from './asset-manager'
import { parseAssetMarkdown } from './markdown-parser'

const tempDirs: string[] = []

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'feicai-asset-manager-'))
  tempDirs.push(dir)
  return dir
}

async function writeAssetFile(projectPath: string, fileName: string, content: string): Promise<void> {
  const assetsDir = join(projectPath, 'assets')
  await mkdir(assetsDir, { recursive: true })
  await writeFile(join(assetsDir, fileName), content, 'utf-8')
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('asset-manager prompt updates', () => {
  it('updates a unique base asset', async () => {
    const projectPath = makeProjectDir()
    const manager = new AssetManager(projectPath)

    await writeAssetFile(projectPath, 'character-prompts.md', `## 江伟\n\n旧提示词`)

    const result = await manager.updateAssetPrompt('character', '江伟', '新提示词')
    const assets = parseAssetMarkdown(await readFile(join(projectPath, 'assets', 'character-prompts.md'), 'utf-8'))

    expect(result).toEqual({ success: true })
    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({ name: '江伟', promptText: '新提示词' })
  })

  it('updates an exact variant title before considering any fallback match', async () => {
    const projectPath = makeProjectDir()
    const manager = new AssetManager(projectPath)

    await writeAssetFile(
      projectPath,
      'character-prompts.md',
      `## 江伟\n\n基础提示词\n\n## 江伟（受伤版）\n\n旧伤妆提示词`
    )

    const result = await manager.updateAssetPrompt('character', '江伟（受伤版）', '新伤妆提示词')
    const assets = parseAssetMarkdown(await readFile(join(projectPath, 'assets', 'character-prompts.md'), 'utf-8'))

    expect(result).toEqual({ success: true })
    expect(assets.find((asset) => asset.name === '江伟')?.promptText).toBe('基础提示词')
    expect(assets.find((asset) => asset.name === '江伟（受伤版）')?.promptText).toBe('新伤妆提示词')
  })

  it('returns an ambiguity error instead of editing the first duplicate entry', async () => {
    const projectPath = makeProjectDir()
    const manager = new AssetManager(projectPath)

    await writeAssetFile(
      projectPath,
      'scene-prompts.md',
      `## 客厅\n\n旧版本 A\n\n## 客厅\n\n旧版本 B`
    )

    const result = await manager.updateAssetPrompt('scene', '客厅', '不应写入的新内容')
    const content = await readFile(join(projectPath, 'assets', 'scene-prompts.md'), 'utf-8')

    expect(result.success).toBe(false)
    expect(result.error).toContain('重复')
    expect(content).toContain('旧版本 A')
    expect(content).toContain('旧版本 B')
    expect(content).not.toContain('不应写入的新内容')
  })
})
