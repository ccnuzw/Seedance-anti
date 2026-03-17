// ============================================================
// Reference Tracker — Seedance 提示词中的 @引用 追踪
// ============================================================
//
// Seedance 提示词使用 @引用语法 关联角色和场景资产：
//   @图片1  → 对应某个角色的参考图
//   @场景图1 → 对应某个场景的参考图
//
// 本模块从提示词文件中提取所有 @引用，
// 并建立引用 → 资产的映射关系
//

export interface PromptReference {
  promptIndex: number    // 第几条提示词 (从 1 开始)
  referenceTag: string   // @图片1, @场景图2
  assetType: 'character' | 'scene'
  assetName?: string     // 解析出的资产名称（如果能确定）
}

export interface ParsedPrompt {
  index: number
  title: string
  content: string
  duration: number       // 秒
  references: PromptReference[]
}

/**
 * 从 Seedance 提示词文件中解析所有提示词条目
 */
export function parseSeedanceFile(content: string): ParsedPrompt[] {
  const prompts: ParsedPrompt[] = []
  const sections = content.split(/(?=^##?\s+(?:P|提示词)\s*\d+)/gm).filter(Boolean)

  for (const section of sections) {
    const headerMatch = section.match(/^##?\s+(?:P|提示词)\s*(\d+)[^\n]*/)
    if (!headerMatch) continue

    const index = parseInt(headerMatch[1])
    const title = headerMatch[0].replace(/^##?\s+/, '').trim()
    const body = section.slice(headerMatch[0].length).trim()

    // 提取时长
    const durationMatch = body.match(/(?:时长|duration)[：:]\s*(\d+)\s*[秒s]/i)
    const duration = durationMatch ? parseInt(durationMatch[1]) : 5

    // 提取 @引用
    const references = extractReferences(body, index)

    prompts.push({ index, title, content: body, duration, references })
  }

  return prompts
}

/**
 * 提取文本中的 @引用
 */
function extractReferences(text: string, promptIndex: number): PromptReference[] {
  const refs: PromptReference[] = []
  const seen = new Set<string>()

  // @图片1, @图片2... → 角色引用
  const charPattern = /@(图片\d+)/g
  let match: RegExpExecArray | null
  while ((match = charPattern.exec(text)) !== null) {
    const tag = `@${match[1]}`
    if (!seen.has(tag)) {
      refs.push({ promptIndex, referenceTag: tag, assetType: 'character' })
      seen.add(tag)
    }
  }

  // @场景图1, @场景图2... → 场景引用
  const scenePattern = /@(场景图\d+)/g
  while ((match = scenePattern.exec(text)) !== null) {
    const tag = `@${match[1]}`
    if (!seen.has(tag)) {
      refs.push({ promptIndex, referenceTag: tag, assetType: 'scene' })
      seen.add(tag)
    }
  }

  return refs
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
    avgDuration: totalCount > 0 ? Math.round(totalDuration / totalCount * 10) / 10 : 0
  }
}
