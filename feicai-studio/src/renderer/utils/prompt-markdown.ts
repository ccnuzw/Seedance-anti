import {
  extractSeedanceReferences,
  parseSeedanceDuration,
  parseSeedanceReferenceTable
} from '@shared/seedance-prompt-parser'

export interface ParsedPrompt {
  index: number
  title: string
  content: string
  duration: number
  references: Array<{ referenceTag: string; assetType: string }>
}

export function parsePromptsFromMarkdown(raw: string): ParsedPrompt[] {
  const prompts: ParsedPrompt[] = []
  const table = parseSeedanceReferenceTable(raw)
  const sections = raw.split(/^## /m).slice(1)

  sections.forEach((section, idx) => {
    const lines = section.trim().split('\n')
    const title = lines[0]?.trim() || `提示词 ${idx + 1}`

    const duration = parseSeedanceDuration(title, lines.slice(1).join('\n'))

    const contentLines = lines
      .slice(1)
      .filter((line) => !line.startsWith('**') && line.trim().length > 0)
    const content = contentLines.join('\n').trim()

    const references = extractSeedanceReferences(section, table).map(
      ({ referenceTag, assetType }) => ({ referenceTag, assetType })
    )

    if (content.length > 0) {
      prompts.push({ index: idx, title, content, duration, references })
    }
  })

  return prompts
}
