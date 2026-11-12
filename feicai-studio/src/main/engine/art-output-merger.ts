import { readFileSync } from 'fs'
import type { ProjectConfig } from '@shared/types'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath
} from '@shared/path-resolver'
import {
  parseAssetMarkdown,
  serializeAssets,
  type ParsedAsset
} from '../asset/markdown-parser'
import { randomUUID } from 'crypto'
import {
  ProductionCommitStore,
  commitHash,
  readCommitText,
  type CommitWrite
} from '../io/production-commit-store'
import {
  assertEpisodeNumber,
  assertPathWithinProject
} from '../security/access-control'

const OWNER_PATTERN = /\s*<!--\s*feicai-art-episodes:([\d,]+)\s*-->/gu

type SharedArtArtifact = 'characterPrompts' | 'scenePrompts'
interface ArtReferenceSnapshot {
  version: 1
  references: Partial<
    Record<SharedArtArtifact, { input: string; published: string }>
  >
}

function referencePath(
  projectPath: string,
  episodeNum: number,
  config?: Partial<ProjectConfig> | null
): string {
  return assertPathWithinProject(
    projectPath,
    `${resolveEpisodeArtifactPath(projectPath, 'artDesign', episodeNum, config)}.references.json`
  )
}

/** Publication may replace the shared file; retain the exact reference seen before
 * this episode published. Any later external edit exposes the current file and
 * invalidates the old review. Snapshots never rebind a review or grant PASS. */
export function readArtReference(
  projectPath: string,
  artifact: SharedArtArtifact,
  episodeNum?: number,
  config?: Partial<ProjectConfig> | null
): string {
  const path = assertPathWithinProject(
    projectPath,
    resolveProjectArtifactPath(projectPath, artifact, config)
  )
  let current = ''
  try {
    current = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (episodeNum !== undefined) {
    assertEpisodeNumber(episodeNum)
    let snapshot: ArtReferenceSnapshot | undefined
    try {
      snapshot = JSON.parse(
        readFileSync(referencePath(projectPath, episodeNum, config), 'utf8')
      )
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
        !(error instanceof SyntaxError)
      )
        throw error
    }
    const reference =
      snapshot?.version === 1 ? snapshot.references?.[artifact] : undefined
    if (
      reference &&
      typeof reference.input === 'string' &&
      reference.published === current
    )
      return reference.input
  }
  return current
}

/** Only approved episode art is published. Names are the stable shared asset identity. */
export class ArtOutputMerger {
  static validateOutput(output: string): {
    characters: ParsedAsset[]
    scenes: ParsedAsset[]
  } {
    const headings = [
      ...output.matchAll(
        /^#{1,2}\s*(人物(?:(?:设定|素材)?提示词|设定|素材)?|角色(?:(?:设定|素材)?提示词|设定|素材)?|Character[^\n]*|场景(?:道具|环境)?(?:提示词|设定|素材)?|Scene[^\n]*)\s*$/gimu
      )
    ]
    const sections = {
      characters: [] as ParsedAsset[],
      scenes: [] as ParsedAsset[]
    }
    for (let index = 0; index < headings.length; index++) {
      const match = headings[index]
      const body = output.slice(
        match.index! + match[0].length,
        headings[index + 1]?.index ?? output.length
      )
      // A category may use ## itself; normalize its nested headings for the asset parser.
      const assets = parseAssetMarkdown(
        match[0].trimStart().startsWith('##')
          ? body.replace(/^###\s+/gm, '## ')
          : body
      )
      const key = /^(?:人物|角色|Character)/iu.test(match[1])
        ? 'characters'
        : 'scenes'
      sections[key].push(...assets)
    }
    for (const [kind, assets] of Object.entries(sections)) {
      if (
        assets.length === 0 ||
        assets.some((asset) => !asset.name.trim() || !asset.promptText.trim())
      ) {
        throw new Error(
          `服化道输出缺少有效${kind === 'characters' ? '人物' : '场景'}分节`
        )
      }
      const names = new Set(assets.map((asset) => this.stableName(asset.name)))
      if (names.size !== assets.length)
        throw new Error('服化道输出包含重复素材名称')
    }
    return sections
  }

  static async parseAndMerge(
    output: string,
    projectPath: string,
    episodeNum: number,
    config?: Partial<ProjectConfig> | null,
    beforeCommit?: () => Promise<void>,
    prepareOnly = false
  ): Promise<{ characters: number; scenes: number; writes: CommitWrite[] }> {
    assertEpisodeNumber(episodeNum)
    if (!prepareOnly)
      await new ProductionCommitStore(projectPath, config).recover()
    const sections = this.validateOutput(output)
    const paths = {
      characters: assertPathWithinProject(
        projectPath,
        resolveProjectArtifactPath(projectPath, 'characterPrompts', config)
      ),
      scenes: assertPathWithinProject(
        projectPath,
        resolveProjectArtifactPath(projectPath, 'scenePrompts', config)
      )
    }
    const updates = await Promise.all(
      (['characters', 'scenes'] as const).map(async (kind) => {
        const expected = readCommitText(paths[kind])
        const existing = expected ?? ''
        const firstAsset = existing.search(/^##\s+/m)
        const prefix =
          firstAsset >= 0
            ? existing.slice(0, firstAsset).trim()
            : existing.trim()
        const incoming = new Map(
          sections[kind].map((asset) => [this.stableName(asset.name), asset])
        )
        const merged = new Map<string, ParsedAsset>()
        for (const asset of parseAssetMarkdown(existing)) {
          const name = this.stableName(asset.name)
          asset.name = name
          asset.promptText = asset.promptText
            .replace(/(?:\n+\s*---\s*)+$/u, '')
            .trim()
          const owners = this.owners(asset.promptText)
          if (owners.has(episodeNum) && !incoming.has(name)) {
            owners.delete(episodeNum)
            if (owners.size === 0) continue
            asset.promptText = this.withOwners(asset.promptText, owners)
          }
          merged.set(name, asset)
        }
        for (const [name, asset] of incoming) {
          asset.promptText = asset.promptText
            .replace(/(?:\n+\s*---\s*)+$/u, '')
            .trim()
          const owners = this.owners(merged.get(name)?.promptText || '')
          owners.add(episodeNum)
          merged.set(name, {
            ...asset,
            name,
            promptText: this.withOwners(asset.promptText, owners)
          })
        }
        return {
          path: paths[kind],
          expected,
          content:
            [prefix, serializeAssets([...merged.values()])]
              .filter(Boolean)
              .join('\n\n') + '\n'
        }
      })
    )
    const snapshot: ArtReferenceSnapshot = { version: 1, references: {} }
    for (const [index, artifact] of (
      ['characterPrompts', 'scenePrompts'] as const
    ).entries()) {
      snapshot.references[artifact] = {
        input: readArtReference(projectPath, artifact, episodeNum, config),
        published: updates[index].content
      }
    }
    await beforeCommit?.()
    const snapshotPath = referencePath(projectPath, episodeNum, config)
    const writes: CommitWrite[] = [
      {
        path: snapshotPath,
        content: JSON.stringify(snapshot),
        expected: readCommitText(snapshotPath)
      },
      ...updates
    ]
    if (!prepareOnly) {
      const store = new ProductionCommitStore(projectPath, config)
      const intent = await store.intent(
        randomUUID(),
        `art:${episodeNum}`,
        commitHash(output),
        [episodeNum]
      )
      await store.install(await store.prepare(intent, writes))
    }
    return {
      characters: sections.characters.length,
      scenes: sections.scenes.length,
      writes
    }
  }

  private static stableName(name: string): string {
    return name
      .normalize('NFC')
      .trim()
      .replace(
        /[（(]\s*ep\d+\s*(新增|复用|变体[：:].*?)?\s*[）)]$/iu,
        (_match, label: string | undefined) =>
          label?.startsWith('变体') ? `（${label}）` : ''
      )
      .trim()
  }

  private static owners(content: string): Set<number> {
    return new Set(
      [...content.matchAll(new RegExp(OWNER_PATTERN.source, 'gu'))].flatMap(
        (match) => match[1].split(',').map(Number)
      )
    )
  }

  private static withOwners(content: string, owners: Set<number>): string {
    return `${content.replace(OWNER_PATTERN, '').trim()}\n\n<!-- feicai-art-episodes:${[...owners].sort((a, b) => a - b).join(',')} -->`
  }
}
