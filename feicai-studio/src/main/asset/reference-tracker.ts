// ============================================================
// Reference Tracker — Seedance 提示词中的 @引用 追踪
// ============================================================
//
// Seedance 提示词使用 @引用语法 关联角色和场景资产：
//   @图片1  → 由素材对应表确定角色或场景；旧文档默认为角色
//   @场景图1 → 对应某个场景的参考图
//
// 本模块从提示词文件中提取所有 @引用，
// 并建立引用 → 资产的映射关系
//

import {
  extractSeedanceReferences,
  parseSeedanceDuration,
  parseSeedanceReferenceTable
} from '@shared/seedance-prompt-parser'

export interface PromptReference {
  promptIndex: number // 第几条提示词 (从 1 开始)
  referenceTag: string // @图片1, @场景图2
  assetType: 'character' | 'scene'
  assetName?: string // 解析出的资产名称（如果能确定）
}

export interface ParsedPrompt {
  index: number
  title: string
  content: string
  duration: number // 秒
  references: PromptReference[]
}

/**
 * 从 Seedance 提示词文件中解析所有提示词条目
 */
export function parseSeedanceFile(content: string): ParsedPrompt[] {
  const prompts: ParsedPrompt[] = []
  const table = parseSeedanceReferenceTable(content)
  const sections = content
    .split(/(?=^##?\s+(?:P|提示词)\s*\d+)/gm)
    .filter(Boolean)

  for (const section of sections) {
    const headerMatch = section.match(/^##?\s+(?:P|提示词)\s*(\d+)[^\n]*/)
    if (!headerMatch) continue

    const index = parseInt(headerMatch[1])
    const title = headerMatch[0].replace(/^##?\s+/, '').trim()
    const body = section.slice(headerMatch[0].length).trim()

    const duration = parseSeedanceDuration(title, body)
    const references = extractSeedanceReferences(body, table).map((ref) => ({
      promptIndex: index,
      ...ref
    }))

    prompts.push({ index, title, content: body, duration, references })
  }

  return prompts
}

/**
 * 统计提示词文件的总时长和条数
 */
export function computeStats(prompts: ParsedPrompt[]): {
  totalCount: number
  totalDuration: number
  avgDuration: number
} {
  const totalCount = prompts.length
  const totalDuration = prompts.reduce((sum, p) => sum + p.duration, 0)
  return {
    totalCount,
    totalDuration,
    avgDuration:
      totalCount > 0 ? Math.round((totalDuration / totalCount) * 10) / 10 : 0
  }
}
