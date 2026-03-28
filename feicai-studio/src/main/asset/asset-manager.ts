// ============================================================
// Asset Manager — 资产管理器
// ============================================================

import { readFile, writeFile, readdir, copyFile, mkdir } from 'fs/promises'
import { join, extname, basename } from 'path'
import { v4 as uuid } from 'uuid'
import { parseAssetMarkdown, serializeAssets, getAssetIdentity, normalizeAssetName, type ParsedAsset } from './markdown-parser'
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
      const imageMap = await this.buildReferenceImageMap('character')
      return parsed.map((asset) => this.assetToCharacter(asset, imageMap))
    } catch {
      return []
    }
  }

  private assetToCharacter(asset: ParsedAsset, imageMap: Map<string, string>): Character {
    return {
      id: uuid(),
      projectId: '',
      name: asset.name,
      alias: asset.metadata['别名'] || asset.metadata['别称'],
      age: asset.metadata['年龄'],
      appearance: asset.metadata['外貌'] || asset.metadata['特征'],
      promptText: asset.promptText,
      referenceImagePath: imageMap.get(this.sanitizeAssetName(asset.name)),
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
      const imageMap = await this.buildReferenceImageMap('scene')
      return parsed.map((asset) => this.assetToScene(asset, imageMap))
    } catch {
      return []
    }
  }

  private assetToScene(asset: ParsedAsset, imageMap: Map<string, string>): Scene {
    return {
      id: uuid(),
      projectId: '',
      name: asset.name,
      timeOfDay: asset.metadata['时间'],
      lighting: asset.metadata['光线'] || asset.metadata['照明'],
      atmosphere: asset.metadata['氛围'] || asset.metadata['气氛'],
      promptText: asset.promptText,
      referenceImagePath: imageMap.get(this.sanitizeAssetName(asset.name)),
      createdAt: new Date().toISOString()
    }
  }

  private sanitizeAssetName(assetName: string): string {
    return assetName.replace(/[^\w\u4e00-\u9fa5]/g, '_')
  }

  private resolveAssetForUpdate(assets: ParsedAsset[], assetName: string): ParsedAsset | undefined {
    const trimmedName = assetName.trim()
    const exactMatches = assets.filter((asset) => asset.name.trim() === trimmedName)

    if (exactMatches.length === 1) {
      return exactMatches[0]
    }

    if (exactMatches.length > 1) {
      throw new Error(`素材名称存在重复，请先清理重复条目后再编辑: ${assetName}`)
    }

    const requestedIdentity = getAssetIdentity(assetName)
    const normalizedRequestedBaseName = normalizeAssetName(requestedIdentity.baseName)
    const baseMatches = assets.filter((asset) => {
      const assetIdentity = getAssetIdentity(asset.name)
      return assetIdentity.kind === 'base' && normalizeAssetName(assetIdentity.baseName) === normalizedRequestedBaseName
    })

    if (baseMatches.length === 1) {
      return baseMatches[0]
    }

    if (baseMatches.length > 1) {
      throw new Error(`素材名称匹配到多个基础项，请使用精确名称编辑: ${assetName}`)
    }

    return undefined
  }

  private async buildReferenceImageMap(assetType: 'character' | 'scene'): Promise<Map<string, string>> {
    const images = await this.listReferenceImages(assetType)
    const imageMap = new Map<string, string>()

    for (const imagePath of images) {
      const key = basename(imagePath, extname(imagePath))
      imageMap.set(key, imagePath)
    }

    return imageMap
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
      const target = this.resolveAssetForUpdate(assets, assetName)

      if (!target) {
        return { success: false, error: `未找到素材: ${assetName}` }
      }

      target.promptText = newPromptText.trim()

      const newContent = serializeAssets(assets)
      await writeFile(filePath, newContent, 'utf-8')

      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ==================== 提示词 ====================

  async loadPrompts(episodeNum: number): Promise<ParsedPrompt[]> {
    const epStr = String(episodeNum).padStart(3, '0')
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
    const sanitizedName = this.sanitizeAssetName(assetName)
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
    const epStr = String(episodeNum).padStart(3, '0')
    const filePath = join(this.projectPath, 'script', `ep${epStr}.md`)
    return readFile(filePath, 'utf-8')
  }

  async saveScript(episodeNum: number, content: string): Promise<void> {
    const epStr = String(episodeNum).padStart(3, '0')
    const dir = join(this.projectPath, 'script')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `ep${epStr}.md`), content, 'utf-8')
  }
}
