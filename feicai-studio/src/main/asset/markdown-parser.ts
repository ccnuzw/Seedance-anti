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

/**
 * 解析资产提示词 Markdown 文件
 */
export function parseAssetMarkdown(content: string): ParsedAsset[] {
  const assets: ParsedAsset[] = []
  const lines = content.split('\n')

  let current: Partial<ParsedAsset> | null = null
  let bodyLines: string[] = []
  let startLine = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 检测二级标题
    if (line.startsWith('## ')) {
      // 保存前一个资产
      if (current) {
        current.promptText = bodyLines.join('\n').trim()
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
    current.promptText = bodyLines.join('\n').trim()
    current.rawSection = lines.slice(startLine).join('\n')
    current.endLine = lines.length - 1
    current.metadata = extractMetadata(current.promptText)
    assets.push(current as ParsedAsset)
  }

  return assets
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
  return assets.map((a) => `## ${a.name}\n\n${a.promptText}`).join('\n\n---\n\n')
}
