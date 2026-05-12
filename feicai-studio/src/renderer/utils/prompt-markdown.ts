export interface ParsedPrompt {
  index: number
  title: string
  content: string
  duration: number
  references: Array<{ referenceTag: string; assetType: string }>
}

export function parsePromptsFromMarkdown(raw: string): ParsedPrompt[] {
  const prompts: ParsedPrompt[] = []
  const sections = raw.split(/^## /m).slice(1)

  sections.forEach((section, idx) => {
    const lines = section.trim().split('\n')
    const title = lines[0]?.trim() || `提示词 ${idx + 1}`

    const durationMatch =
      section.match(/时长[：:]\s*(\d+)\s*[秒s]/i) ||
      section.match(/(\d+)\s*[秒s]/i)
    const duration = durationMatch ? parseInt(durationMatch[1]) : 5

    const contentLines = lines
      .slice(1)
      .filter((line) => !line.startsWith('**') && line.trim().length > 0)
    const content = contentLines.join('\n').trim()

    const references: ParsedPrompt['references'] = []
    const refMatches = section.matchAll(/@(图片\d+|场景图\d+)/g)
    for (const match of refMatches) {
      references.push({
        referenceTag: match[0],
        assetType: match[1].startsWith('场景') ? 'scene' : 'character'
      })
    }

    if (content.length > 0) {
      prompts.push({ index: idx, title, content, duration, references })
    }
  })

  return prompts
}
