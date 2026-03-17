// ============================================================
// Asset Manager — 资产管理器
// ============================================================

import { readFile, writeFile, readdir, copyFile, mkdir } from 'fs/promises'
import { join, extname, basename } from 'path'
import { v4 as uuid } from 'uuid'
import { parseAssetMarkdown, serializeAssets, type ParsedAsset } from './markdown-parser'
import { parseSeedanceFile, computeStats, type ParsedPrompt } from './reference-tracker'
import type { Character, Scene } from '@shared/types'

export class AssetManager {
  private projectPath: string

  constructor(projectPath: string) {
    this.projectPath = projectPath
  }

  // ==================== 角色素材 ====================

  async loadCharacters(): Promise<Character[]> {
    const filePath = join(this.projectPath, 'assets', 'character-prompts.md')
    try {
      const content = await readFile(filePath, 'utf-8')
      const parsed = parseAssetMarkdown(content)
      return parsed.map((asset) => this.assetToCharacter(asset))
    } catch {
      return []
    }
  }

  private assetToCharacter(asset: ParsedAsset): Character {
    return {
      id: uuid(),
      projectId: '',
      name: asset.name,
      alias: asset.metadata['别名'] || asset.metadata['别称'],
      age: asset.metadata['年龄'],
      appearance: asset.metadata['外貌'] || asset.metadata['特征'],
      promptText: asset.promptText,
      referenceImagePath: undefined,
      firstEpisode: 1,
      isVariant: asset.name.includes('（') || asset.name.includes('('),
      variantOf: undefined,
      createdAt: new Date().toISOString()
    }
  }

  // ==================== 场景素材 ====================

  async loadScenes(): Promise<Scene[]> {
    const filePath = join(this.projectPath, 'assets', 'scene-prompts.md')
    try {
      const content = await readFile(filePath, 'utf-8')
      const parsed = parseAssetMarkdown(content)
      return parsed.map((asset) => this.assetToScene(asset))
    } catch {
      return []
    }
  }

  private assetToScene(asset: ParsedAsset): Scene {
    return {
      id: uuid(),
      projectId: '',
      name: asset.name,
      timeOfDay: asset.metadata['时间'],
      lighting: asset.metadata['光线'] || asset.metadata['照明'],
      atmosphere: asset.metadata['氛围'] || asset.metadata['气氛'],
      promptText: asset.promptText,
      referenceImagePath: undefined,
      createdAt: new Date().toISOString()
    }
  }

  // ==================== 素材编辑 ====================

  /**
   * 更新指定素材的提示词文本
   */
  async updateAssetPrompt(
    assetType: 'character' | 'scene',
    assetName: string,
    newPromptText: string
  ): Promise<{ success: boolean; error?: string }> {
    const fileName = assetType === 'character' ? 'character-prompts.md' : 'scene-prompts.md'
    const filePath = join(this.projectPath, 'assets', fileName)

    try {
      const content = await readFile(filePath, 'utf-8')
      const assets = parseAssetMarkdown(content)
      const target = assets.find(a => a.name === assetName)

      if (!target) {
        return { success: false, error: `未找到素材: ${assetName}` }
      }

      // 替换目标素材的提示词
      target.promptText = newPromptText.trim()

      // 重新序列化整个文件
      const newContent = serializeAssets(assets)
      await writeFile(filePath, newContent, 'utf-8')

      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ==================== 提示词 ====================

  async loadPrompts(episodeNum: number): Promise<ParsedPrompt[]> {
    const epStr = String(episodeNum).padStart(2, '0')
    const filePath = join(this.projectPath, 'outputs', `ep${epStr}`, '02-seedance-prompts.md')
    try {
      const content = await readFile(filePath, 'utf-8')
      return parseSeedanceFile(content)
    } catch {
      return []
    }
  }

  async getPromptStats(episodeNum: number) {
    const prompts = await this.loadPrompts(episodeNum)
    return computeStats(prompts)
  }

  // ==================== 参考图管理 ====================

  async uploadReferenceImage(
    assetType: 'character' | 'scene',
    assetName: string,
    sourcePath: string
  ): Promise<string> {
    const ext = extname(sourcePath)
    const sanitizedName = assetName.replace(/[^\w\u4e00-\u9fa5]/g, '_')
    const targetDir = join(this.projectPath, 'assets', 'images', assetType)
    await mkdir(targetDir, { recursive: true })
    const targetPath = join(targetDir, `${sanitizedName}${ext}`)
    await copyFile(sourcePath, targetPath)
    return targetPath
  }

  async listReferenceImages(assetType: 'character' | 'scene'): Promise<string[]> {
    const dir = join(this.projectPath, 'assets', 'images', assetType)
    try {
      const files = await readdir(dir)
      return files
        .filter(f => ['.jpg', '.jpeg', '.png', '.webp'].includes(extname(f).toLowerCase()))
        .map(f => join(dir, f))
    } catch {
      return []
    }
  }

  // ==================== 剧本 ====================

  async loadScript(episodeNum: number): Promise<string> {
    const epStr = String(episodeNum).padStart(2, '0')
    const filePath = join(this.projectPath, 'script', `ep${epStr}.md`)
    return readFile(filePath, 'utf-8')
  }

  async saveScript(episodeNum: number, content: string): Promise<void> {
    const epStr = String(episodeNum).padStart(2, '0')
    const dir = join(this.projectPath, 'script')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `ep${epStr}.md`), content, 'utf-8')
  }
}
