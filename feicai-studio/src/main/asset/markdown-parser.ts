// ============================================================
// Markdown Parser — 解析 character-prompts.md / scene-prompts.md
// ============================================================
//
// 资产提示词文件使用 Markdown 格式，每个资产用二级标题分隔：
//
// ## 角色名
// 提示词文本...
//
// ## 场景名
// 提示词文本...
//

export interface ParsedAsset {
  name: string
  promptText: string
  metadata: Record<string, string>  // 从文本中提取的键值对
  rawSection: string                // 原始 Markdown 段落
  startLine: number
  endLine: number
}

export interface AssetIdentity {
  displayName: string
  normalizedName: string
  baseName: string
  normalizedBaseName: string
  variantLabel?: string
  normalizedVariantLabel?: string
  kind: 'base' | 'variant'
}

function extractBracketedParts(name: string): { outerName: string; innerLabel: string } | undefined {
  const match = name.trim().match(/^(.+?)[（(](.+)[）)]$/)
  if (!match) {
    return undefined
  }

  return {
    outerName: match[1].trim(),
    innerLabel: match[2].trim()
  }
}

function parseEpisodeAnnotation(innerLabel: string): { isEpisodeAnnotation: boolean; variantLabel?: string } {
  const normalizedInnerLabel = normalizeAssetName(innerLabel)
  const match = normalizedInnerLabel.match(/^ep\d+\s*新增(?:\s*·\s*(.+))?$/i)

  if (!match) {
    return { isEpisodeAnnotation: false }
  }

  const rawTail = innerLabel.replace(/^ep\d+\s*新增/i, '').replace(/^\s*·\s*/, '').trim()
  if (!rawTail) {
    return { isEpisodeAnnotation: true }
  }

  const variantLabel = rawTail.replace(/^变体\s*/i, '').trim() || rawTail
  return {
    isEpisodeAnnotation: true,
    variantLabel
  }
}

function cleanPromptBody(bodyLines: string[]): string {
  const lines = [...bodyLines]

  while (lines.length > 0 && lines[0].trim() === '') {
    lines.shift()
  }

  while (lines.length > 0) {
    const tail = lines[lines.length - 1].trim()
    if (
      tail === '' ||
      tail === '---' ||
      /^<!--\s*ep\d+\s+新增\s*-->$/i.test(tail) ||
      /^#\s*(?:人物|角色|场景(?:道具|环境)?)(?:提示词|设定|素材)$/i.test(tail)
    ) {
      lines.pop()
      continue
    }
    break
  }

  return lines.join('\n').trim()
}

/**
 * 解析资产提示词 Markdown 文件
 */
export function parseAssetMarkdown(content: string): ParsedAsset[] {
  const assets: ParsedAsset[] = []
  const sanitizedContent = content
    .replace(/<!--\s*ep\d+\s+additions:start\s*-->[\s\S]*?<!--\s*ep\d+\s+additions:end\s*-->/gi, '')
    .replace(/^##\s*分集新增记录\s*$/gim, '')
    .replace(/^###\s*EP\d+\s*本集新增内容\s*$/gim, '')
  const lines = sanitizedContent.split('\n')

  let current: Partial<ParsedAsset> | null = null
  let bodyLines: string[] = []
  let startLine = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 检测二级标题（忽略文档级说明标题） 
    if (line.startsWith('## ') && !/^##\s*分集新增记录\s*$/i.test(line)) {
      // 保存前一个资产
      if (current) {
        current.promptText = cleanPromptBody(bodyLines)
        current.rawSection = lines.slice(startLine, i).join('\n')
        current.endLine = i - 1
        current.metadata = extractMetadata(current.promptText)
        assets.push(current as ParsedAsset)
      }

      // 开始新资产
      const name = line.replace('## ', '').trim()
      current = { name, startLine: i, metadata: {} }
      bodyLines = []
      startLine = i
    } else if (current) {
      bodyLines.push(line)
    }
  }

  // 最后一个资产
  if (current) {
    current.promptText = cleanPromptBody(bodyLines)
    current.rawSection = lines.slice(startLine).join('\n')
    current.endLine = lines.length - 1
    current.metadata = extractMetadata(current.promptText)
    assets.push(current as ParsedAsset)
  }

  return assets
}

export function normalizeAssetName(name: string): string {
  return name
    .trim()
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+/g, ' ')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*\)\s*/g, ')')
    .toLocaleLowerCase('zh-CN')
}

export function getAssetIdentity(name: string): AssetIdentity {
  const displayName = name.trim()
  const normalizedName = normalizeAssetName(displayName)
  const bracketedParts = extractBracketedParts(displayName)

  if (bracketedParts) {
    const episodeAnnotation = parseEpisodeAnnotation(bracketedParts.innerLabel)
    const baseName = bracketedParts.outerName.trim()
    const normalizedBaseName = normalizeAssetName(baseName)

    if (episodeAnnotation.isEpisodeAnnotation) {
      const variantLabel = episodeAnnotation.variantLabel?.trim()

      if (variantLabel) {
        return {
          displayName,
          normalizedName,
          baseName,
          normalizedBaseName,
          variantLabel,
          normalizedVariantLabel: normalizeAssetName(variantLabel),
          kind: 'variant'
        }
      }

      return {
        displayName,
        normalizedName,
        baseName,
        normalizedBaseName,
        kind: 'base'
      }
    }

    const variantLabel = bracketedParts.innerLabel.trim()

    return {
      displayName,
      normalizedName,
      baseName,
      normalizedBaseName,
      variantLabel,
      normalizedVariantLabel: normalizeAssetName(variantLabel),
      kind: 'variant'
    }
  }

  return {
    displayName,
    normalizedName,
    baseName: displayName,
    normalizedBaseName: normalizedName,
    kind: 'base'
  }
}

export function getAssetMergeKey(name: string): string {
  const identity = getAssetIdentity(name)
  if (identity.kind === 'variant') {
    return `variant:${identity.normalizedBaseName}:${identity.normalizedVariantLabel}`
  }
  return `base:${identity.normalizedBaseName}`
}

/**
 * 从提示词文本中提取键值对元数据
 * 格式：**键**：值 或 - 键：值
 */
function extractMetadata(text: string): Record<string, string> {
  const meta: Record<string, string> = {}

  // **年龄**：25岁
  const boldPattern = /\*\*(.+?)\*\*[：:]\s*(.+)/g
  let match: RegExpExecArray | null
  while ((match = boldPattern.exec(text)) !== null) {
    meta[match[1].trim()] = match[2].trim()
  }

  // - 年龄：25岁
  const listPattern = /^-\s*(.+?)[：:]\s*(.+)/gm
  while ((match = listPattern.exec(text)) !== null) {
    const key = match[1].replace(/\*\*/g, '').trim()
    if (!meta[key]) {
      meta[key] = match[2].trim()
    }
  }

  return meta
}

/**
 * 将解析后的资产数组重新序列化为 Markdown
 */
export function serializeAssets(assets: ParsedAsset[]): string {
  return assets
    .map((a) => `## ${a.name.trim()}\n\n${a.promptText.trim()}`)
    .join('\n\n')
    .trim()
}
