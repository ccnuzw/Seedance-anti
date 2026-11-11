import { readdir } from 'fs/promises'
import { join, extname } from 'path'
import { v4 as uuid } from 'uuid'
import {
  parseAssetMarkdown,
  serializeAssets,
  type ParsedAsset
} from './markdown-parser'
import {
  parseSeedanceFile,
  computeStats,
  type ParsedPrompt
} from './reference-tracker'
import type { Character, ProjectConfig, Scene } from '@shared/types'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath,
  resolveProjectLayout
} from '@shared/path-resolver'
import {
  assertEpisodeNumber,
  assertNonEmptyString,
  assertPathWithinProject,
  assertProjectFileReadAllowed,
  isMissingFileError
} from '../security/access-control'
import {
  atomicCompareAndWriteFile,
  atomicCopyFile,
  atomicWriteFile,
  readRegularFile
} from '../io/atomic-file'

const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp']

export function assertAssetType(
  value: unknown
): asserts value is 'character' | 'scene' {
  if (value !== 'character' && value !== 'scene')
    throw new Error('素材类型必须为character或scene')
}

export class AssetManager {
  private readonly projectPath: string

  constructor(
    projectPath: string,
    private readonly config?: Partial<ProjectConfig> | null
  ) {
    this.projectPath = assertPathWithinProject(projectPath, projectPath)
  }

  getProjectPath(): string {
    return this.projectPath
  }

  private checked(filePath: string): string {
    return assertPathWithinProject(this.projectPath, filePath)
  }

  private async optionalText(filePath: string): Promise<string | null> {
    try {
      return (await readRegularFile(this.checked(filePath))).toString('utf8')
    } catch (error) {
      if (isMissingFileError(error)) return null
      throw error
    }
  }

  async loadCharacters(): Promise<Character[]> {
    const content = await this.optionalText(
      resolveProjectArtifactPath(
        this.projectPath,
        'characterPrompts',
        this.config
      )
    )
    return content === null
      ? []
      : parseAssetMarkdown(content).map((asset) => this.assetToCharacter(asset))
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

  async loadScenes(): Promise<Scene[]> {
    const content = await this.optionalText(
      resolveProjectArtifactPath(this.projectPath, 'scenePrompts', this.config)
    )
    return content === null
      ? []
      : parseAssetMarkdown(content).map((asset) => this.assetToScene(asset))
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

  async updateAssetPrompt(
    assetType: 'character' | 'scene',
    assetName: string,
    newPromptText: string
  ): Promise<{ success: boolean; error?: string }> {
    assertAssetType(assetType)
    assertNonEmptyString(assetName, '素材名')
    if (typeof newPromptText !== 'string') throw new Error('提示词必须为字符串')
    const filePath = this.checked(
      resolveProjectArtifactPath(
        this.projectPath,
        assetType === 'character' ? 'characterPrompts' : 'scenePrompts',
        this.config
      )
    )
    const content = (await readRegularFile(filePath)).toString('utf8')
    const assets = parseAssetMarkdown(content)
    const target = assets.find((asset) => asset.name === assetName)
    if (!target) return { success: false, error: `未找到素材: ${assetName}` }
    target.promptText = newPromptText.trim()
    await atomicCompareAndWriteFile(filePath, serializeAssets(assets), content)
    return { success: true }
  }

  async loadPrompts(episodeNum: number): Promise<ParsedPrompt[]> {
    assertEpisodeNumber(episodeNum)
    const content = await this.optionalText(
      resolveEpisodeArtifactPath(
        this.projectPath,
        'seedancePrompts',
        episodeNum,
        this.config
      )
    )
    return content === null ? [] : parseSeedanceFile(content)
  }

  async getPromptStats(episodeNum: number) {
    return computeStats(await this.loadPrompts(episodeNum))
  }

  async uploadReferenceImage(
    assetType: 'character' | 'scene',
    assetName: string,
    sourcePath: string
  ): Promise<string> {
    assertAssetType(assetType)
    assertNonEmptyString(assetName, '素材名')
    const source = assertProjectFileReadAllowed(sourcePath)
    const extension = extname(source).toLowerCase()
    if (!imageExtensions.includes(extension))
      throw new Error('仅支持JPG、PNG、WEBP参考图')
    const safeName = assetName.replace(/[^\w\u4e00-\u9fa5]/g, '_').slice(0, 120)
    const directory = this.checked(
      join(
        this.projectPath,
        resolveProjectLayout(this.config).assetsDir,
        'images',
        assetType
      )
    )
    const target = this.checked(join(directory, `${safeName}${extension}`))
    await atomicCopyFile(source, target)
    return target
  }

  async listReferenceImages(
    assetType: 'character' | 'scene'
  ): Promise<string[]> {
    assertAssetType(assetType)
    const directory = this.checked(
      join(
        this.projectPath,
        resolveProjectLayout(this.config).assetsDir,
        'images',
        assetType
      )
    )
    try {
      const entries = await readdir(directory, { withFileTypes: true })
      const images: string[] = []
      for (const entry of entries) {
        if (!imageExtensions.includes(extname(entry.name).toLowerCase()))
          continue
        const path = this.checked(join(directory, entry.name))
        if (entry.isFile()) images.push(path)
      }
      return images
    } catch (error) {
      if (isMissingFileError(error)) return []
      throw error
    }
  }

  async loadScript(episodeNum: number): Promise<string> {
    assertEpisodeNumber(episodeNum)
    return (
      await readRegularFile(
        this.checked(
          resolveEpisodeArtifactPath(
            this.projectPath,
            'script',
            episodeNum,
            this.config
          )
        )
      )
    ).toString('utf8')
  }

  async saveScript(episodeNum: number, content: string): Promise<void> {
    assertEpisodeNumber(episodeNum)
    if (typeof content !== 'string') throw new Error('剧本内容必须为字符串')
    await atomicWriteFile(
      this.checked(
        resolveEpisodeArtifactPath(
          this.projectPath,
          'script',
          episodeNum,
          this.config
        )
      ),
      content
    )
  }
}
