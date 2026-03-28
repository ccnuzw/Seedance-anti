// ============================================================
// Art Output Merger — 解析 art 阶段输出并合并到 assets
// ============================================================

import { readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import {
  getAssetIdentity,
  getAssetMergeKey,
  parseAssetMarkdown,
  serializeAssets,
  type ParsedAsset
} from '../asset/markdown-parser'
import { writeArtifactText } from '../project/artifact-service'

const HISTORY_MARKER = '<!-- cumulative-library -->'
const EPISODE_START_MARKER = (episodeNum: number) => `<!-- ep${String(episodeNum).padStart(2, '0')} additions:start -->`
const EPISODE_END_MARKER = (episodeNum: number) => `<!-- ep${String(episodeNum).padStart(2, '0')} additions:end -->`

function splitAssetDocument(content: string): { cumulative: string; additions: string } {
  const markerIndex = content.indexOf(HISTORY_MARKER)
  if (markerIndex === -1) {
    return {
      cumulative: content.trim(),
      additions: ''
    }
  }

  const afterMarker = content.slice(markerIndex + HISTORY_MARKER.length).trimStart()
  const additionsHeadingMatch = afterMarker.match(/^##\s*分集新增记录\s*$/m)

  if (!additionsHeadingMatch || additionsHeadingMatch.index === undefined) {
    return {
      cumulative: afterMarker.trim(),
      additions: ''
    }
  }

  return {
    cumulative: afterMarker.slice(0, additionsHeadingMatch.index).trim(),
    additions: afterMarker.slice(additionsHeadingMatch.index + additionsHeadingMatch[0].length).trim()
  }
}

function normalizeCumulativeAssetName(asset: ParsedAsset): ParsedAsset {
  const identity = getAssetIdentity(asset.name)
  return {
    ...asset,
    name: identity.kind === 'variant' ? asset.name.trim() : identity.baseName
  }
}

function buildAssetDocument(cumulative: ParsedAsset[], additionsBlock: string): string {
  const parts: string[] = []
  parts.push('# 累计提示词库')
  parts.push('')
  parts.push('> 以下内容为当前项目累计生效的最新提示词，可供后续集数直接复用。')
  parts.push('')
  parts.push(HISTORY_MARKER)
  const serialized = serializeAssets(cumulative.map(normalizeCumulativeAssetName))
  if (serialized) {
    parts.push('')
    parts.push(serialized)
  }

  if (additionsBlock.trim()) {
    parts.push('')
    parts.push('## 分集新增记录')
    parts.push('')
    parts.push(additionsBlock.trim())
  }

  return parts.join('\n').trim() + '\n'
}

function upsertEpisodeAdditionSection(existing: string, episodeNum: number, incoming: ParsedAsset[]): string {
  const episodeLabel = `EP${String(episodeNum).padStart(2, '0')}`
  const startMarker = EPISODE_START_MARKER(episodeNum)
  const endMarker = EPISODE_END_MARKER(episodeNum)
  const serialized = serializeAssets(incoming)

  const section = [
    startMarker,
    `### ${episodeLabel} 本集新增内容`,
    '',
    '> 以下内容仅展示本集本轮新增/更新的角色或场景，便于与历史累计内容区分。',
    '',
    serialized || '_本集无可识别新增内容_',
    endMarker
  ].join('\n')

  if (!existing.trim()) {
    return section
  }

  const pattern = new RegExp(`${startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm')
  if (pattern.test(existing)) {
    return existing.replace(pattern, section).trim()
  }

  return `${existing.trim()}\n\n${section}`
}

export class ArtOutputMerger {
  /**
   * 解析 art 阶段 LLM 输出，提取人物和场景段落，合并到 assets 文件
   */
  static async parseAndMerge(
    output: string,
    projectPath: string,
    episodeNum: number
  ): Promise<{ characters: number; scenes: number }> {
    const assetsDir = join(projectPath, 'assets')
    await mkdir(assetsDir, { recursive: true })

    const charPath = join(assetsDir, 'character-prompts.md')
    const scenePath = join(assetsDir, 'scene-prompts.md')

    const { characterSection, sceneSection } = this.parseOutput(output)

    let charCount = 0
    let sceneCount = 0

    if (characterSection.trim()) {
      const existingRaw = await this.safeRead(charPath)
      const existingDoc = splitAssetDocument(existingRaw)
      const existing = parseAssetMarkdown(existingDoc.cumulative)
      const incoming = parseAssetMarkdown(characterSection)
      const merged = this.mergeAssets(existing, incoming)
      const additions = upsertEpisodeAdditionSection(existingDoc.additions, episodeNum, incoming)
      await writeArtifactText({
        projectPath,
        kind: 'character_prompts',
        filePath: charPath,
        content: buildAssetDocument(merged, additions),
        contentType: 'text/markdown',
        label: '角色提示词库',
        createdBy: 'system',
        metadata: { episodeNum, latestUpdatedEpisodeNum: episodeNum }
      })
      charCount = incoming.length
    }

    if (sceneSection.trim()) {
      const existingRaw = await this.safeRead(scenePath)
      const existingDoc = splitAssetDocument(existingRaw)
      const existing = parseAssetMarkdown(existingDoc.cumulative)
      const incoming = parseAssetMarkdown(sceneSection)
      const merged = this.mergeAssets(existing, incoming)
      const additions = upsertEpisodeAdditionSection(existingDoc.additions, episodeNum, incoming)
      await writeArtifactText({
        projectPath,
        kind: 'scene_prompts',
        filePath: scenePath,
        content: buildAssetDocument(merged, additions),
        contentType: 'text/markdown',
        label: '场景提示词库',
        createdBy: 'system',
        metadata: { episodeNum, latestUpdatedEpisodeNum: episodeNum }
      })
      sceneCount = incoming.length
    }

    return { characters: charCount, scenes: sceneCount }
  }

  /**
   * 解析 LLM 输出，分拆为人物和场景两部分
   * 支持多种标题格式：# 人物提示词 / # 场景道具提示词 / ## 人物 等
   */
  private static parseOutput(output: string): {
    characterSection: string
    sceneSection: string
  } {
    const charPatterns = [
      /^#\s*人物(?:提示词|设定|素材)/m,
      /^#\s*角色(?:提示词|设定|素材)/m,
      /^#\s*Character/mi
    ]
    const scenePatterns = [
      /^#\s*场景(?:道具|环境)?(?:提示词|设定|素材)/m,
      /^#\s*Scene/mi
    ]

    let charStart = -1
    let sceneStart = -1

    for (const p of charPatterns) {
      const m = output.match(p)
      if (m && m.index !== undefined) { charStart = m.index; break }
    }
    for (const p of scenePatterns) {
      const m = output.match(p)
      if (m && m.index !== undefined) { sceneStart = m.index; break }
    }

    let characterSection = ''
    let sceneSection = ''

    if (charStart >= 0 && sceneStart >= 0) {
      if (charStart < sceneStart) {
        characterSection = output.slice(charStart, sceneStart)
        sceneSection = output.slice(sceneStart)
      } else {
        sceneSection = output.slice(sceneStart, charStart)
        characterSection = output.slice(charStart)
      }
    } else if (charStart >= 0) {
      characterSection = output.slice(charStart)
    } else if (sceneStart >= 0) {
      sceneSection = output.slice(sceneStart)
    } else {
      characterSection = output
    }

    return { characterSection, sceneSection }
  }

  private static mergeAssets(existing: ParsedAsset[], incoming: ParsedAsset[]): ParsedAsset[] {
    const merged = [...existing]
    const indexByKey = new Map<string, number>()

    for (let i = 0; i < merged.length; i++) {
      const key = getAssetMergeKey(merged[i].name)
      if (!indexByKey.has(key)) {
        indexByKey.set(key, i)
      }
    }

    for (const asset of incoming) {
      const identity = getAssetIdentity(asset.name)
      const key = getAssetMergeKey(asset.name)
      const existingIndex = indexByKey.get(key)

      if (existingIndex !== undefined) {
        merged[existingIndex] = this.mergeReplacement(merged[existingIndex], asset, identity.kind === 'variant')
        continue
      }

      merged.push(asset)
      indexByKey.set(key, merged.length - 1)
    }

    return this.dedupeMergedAssets(merged)
  }

  private static mergeReplacement(current: ParsedAsset, next: ParsedAsset, preserveName: boolean): ParsedAsset {
    return {
      ...current,
      name: preserveName ? next.name.trim() : getAssetIdentity(next.name).baseName,
      promptText: next.promptText.trim(),
      metadata: next.metadata,
      rawSection: next.rawSection,
      startLine: next.startLine,
      endLine: next.endLine
    }
  }

  private static dedupeMergedAssets(assets: ParsedAsset[]): ParsedAsset[] {
    const byKey = new Map<string, ParsedAsset>()
    const order: string[] = []

    for (const asset of assets) {
      const key = getAssetMergeKey(asset.name)
      if (!byKey.has(key)) {
        order.push(key)
        byKey.set(key, asset)
      }
    }

    return order
      .map((key) => byKey.get(key))
      .filter((asset): asset is ParsedAsset => !!asset)
  }

  /** 安全读取文件，不存在返回空字符串 */
  private static async safeRead(path: string): Promise<string> {
    try {
      return await readFile(path, 'utf-8')
    } catch {
      return ''
    }
  }
}
