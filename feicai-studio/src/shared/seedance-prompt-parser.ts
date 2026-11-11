// Pure Markdown metadata parsing shared by the asset tracker and prompt cards.
interface ImageReference {
  referenceTag: string
  assetType: 'character' | 'scene'
  assetName?: string
}

export interface SeedanceReferenceTable {
  present: boolean
  entries: Map<string, Omit<ImageReference, 'referenceTag'> | null>
}

function plainCell(value: string): string {
  return value
    .trim()
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*`]/g, '')
    .trim()
}

/** Only named reference tables define mappings; prose mentions do not. */
export function parseSeedanceReferenceTable(
  raw: string
): SeedanceReferenceTable {
  const table: SeedanceReferenceTable = { present: false, entries: new Map() }
  let inTableSection = false
  let columns: { tag: number; type: number; name: number } | undefined
  for (const line of raw.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+)/)
    if (heading) {
      inTableSection = /^(?:素材对应表|参考图表)\s*[：:]?$/.test(
        plainCell(heading[1])
      )
      if (inTableSection && plainCell(heading[1]).startsWith('素材对应表')) {
        // An incomplete new-format table must not revive the legacy character guess.
        table.present = true
      }
      columns = undefined
      continue
    }
    if (!inTableSection || !line.trim().startsWith('|')) continue
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map(plainCell)
    if (!columns) {
      const tag = cells.findIndex((cell) =>
        /^(?:引用编号|引用|编号)$/.test(cell)
      )
      const type = cells.findIndex((cell) => /^(?:素材类型|类型)$/.test(cell))
      const name = cells.findIndex((cell) =>
        /^(?:对应素材|素材名称|名称)$/.test(cell)
      )
      if (tag >= 0 && type >= 0 && name >= 0) {
        columns = { tag, type, name }
        table.present = true
      }
      continue
    }
    const tag = cells[columns.tag]
    if (!/^@(?:图片|场景图|音频|视频)\d+$/.test(tag || '')) continue
    const type = cells[columns.type] || ''
    const assetType = /^(?:人物|角色)(?:参考(?:图)?)?$|^character$/i.test(type)
      ? 'character'
      : /^(?:场景)(?:参考(?:图)?)?$|^scene$/i.test(type)
        ? 'scene'
        : undefined
    const assetName = (cells[columns.name] || '')
      .replace(/^\[(.*)\]$/, '$1')
      .replace(/[,，;；]\s*参见.*$/, '')
      .trim()
    const entry: Omit<ImageReference, 'referenceTag'> | null =
      assetType && /^@(?:图片|场景图)\d+$/.test(tag)
        ? {
            assetType,
            ...(assetName && !/^(?:人物名|角色名|场景名)$/.test(assetName)
              ? { assetName }
              : {})
          }
        : null
    // Conflicting declarations are ambiguous, so never guess an asset identity.
    const previous = table.entries.get(tag)
    table.entries.set(
      tag,
      table.entries.has(tag) &&
        JSON.stringify(previous) !== JSON.stringify(entry)
        ? null
        : entry
    )
  }
  return table
}

/** Deduplicate per prompt; audio/video and untyped table entries are not image assets. */
export function extractSeedanceReferences(
  text: string,
  table: SeedanceReferenceTable
): ImageReference[] {
  const references: ImageReference[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(/@(?:图片|场景图)\d+(?![\w])/g)) {
    const tag = match[0]
    if (seen.has(tag)) continue
    seen.add(tag)
    if (table.entries.has(tag)) {
      const entry = table.entries.get(tag)
      if (entry) references.push({ referenceTag: tag, ...entry })
    } else if (tag.startsWith('@场景图') || !table.present) {
      references.push({
        referenceTag: tag,
        assetType: tag.startsWith('@场景图') ? 'scene' : 'character'
      })
    }
  }
  return references
}

/**
 * First valid title duration wins, then explicit body metadata, then a legacy
 * standalone duration line, then 5s. Only positive finite seconds are valid.
 * Never infer a total from timeline ranges or incidental numbers in prose.
 */
export function parseSeedanceDuration(title: string, body: string): number {
  const value = String.raw`(\d+(?:[.．]\d+)?)\s*(?:秒|s)(?![\w.．]|[ \t]*[-~～—–至到])`
  const label = String.raw`(?:建议时长|总时长|时长|duration)\s*[：:]\s*`
  const valid = (text: string, pattern: RegExp): number | undefined => {
    for (const match of text.matchAll(pattern)) {
      const duration = Number(match[1].replace('．', '.'))
      if (Number.isFinite(duration) && duration > 0) return duration
    }
    return undefined
  }
  const cleanBody = body.replace(/\*\*/g, '')
  return (
    valid(title.replace(/\*\*/g, ''), new RegExp(label + value, 'gi')) ??
    valid(
      cleanBody,
      new RegExp(String.raw`^\s*(?:[-*]\s+)?[【（(\[]?` + label + value, 'gim')
    ) ??
    valid(
      cleanBody,
      new RegExp(String.raw`^\s*` + value + String.raw`\s*[。；;]?\s*$`, 'gim')
    ) ??
    5
  )
}
