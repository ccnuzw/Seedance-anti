import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

const SCRIPT_DIR_NAMES = ['script', 'scripts'] as const

function buildEpisodeFilenameVariants(episode: number): string[] {
  const plain = String(episode)
  const ep2 = String(episode).padStart(2, '0')
  const ep3 = String(episode).padStart(3, '0')

  return [...new Set([
    `ep${plain}.md`,
    `ep${ep2}.md`,
    `ep${ep3}.md`,
    `ep${plain}-script.md`,
    `ep${ep2}-script.md`,
    `ep${ep3}-script.md`
  ])]
}

function parseEpisodeFromFilename(filename: string): number | null {
  const match = filename.match(/^ep(\d+)(?:-[^.]+)?\.md$/i)
  return match ? parseInt(match[1], 10) : null
}

function scoreFilename(filename: string): number {
  const match = filename.match(/^ep(\d+)(?:-[^.]+)?\.md$/i)
  if (!match) return 0
  const digits = match[1].length
  const hasSuffix = /-/.test(filename)
  const digitScore = digits >= 3 ? 30 : digits === 2 ? 20 : 10
  return digitScore + (hasSuffix ? 1 : 0)
}

export function listExistingScriptDirs(projectPath: string): string[] {
  return SCRIPT_DIR_NAMES
    .map((dirName) => join(projectPath, dirName))
    .filter((dirPath) => existsSync(dirPath))
}

export function resolvePreferredScriptDir(projectPath: string): string {
  return listExistingScriptDirs(projectPath)[0] || join(projectPath, 'script')
}

export function resolveScriptEpisodePath(projectPath: string, episode: number): string | null {
  const filenames = buildEpisodeFilenameVariants(episode)

  for (const dirPath of listExistingScriptDirs(projectPath)) {
    for (const filename of filenames) {
      const filePath = join(dirPath, filename)
      if (existsSync(filePath)) {
        return filePath
      }
    }

    const fallbackMatches = readdirSync(dirPath)
      .filter((filename) => parseEpisodeFromFilename(filename) === episode)
      .sort((a, b) => scoreFilename(b) - scoreFilename(a))

    if (fallbackMatches.length > 0) {
      return join(dirPath, fallbackMatches[0])
    }
  }

  return null
}

export function getWritableScriptEpisodePath(projectPath: string, episode: number): string {
  const preferredDir = resolvePreferredScriptDir(projectPath)
  const epStr = String(episode).padStart(3, '0')
  return join(preferredDir, `ep${epStr}.md`)
}

export interface ScriptEpisodeFileRef {
  episode: number
  filename: string
  filePath: string
}

export function listScriptEpisodeFiles(projectPath: string): ScriptEpisodeFileRef[] {
  const deduped = new Map<number, ScriptEpisodeFileRef>()

  for (const dirPath of listExistingScriptDirs(projectPath)) {
    const filenames = readdirSync(dirPath)
      .filter((filename) => /^ep\d+(?:-[^.]+)?\.md$/i.test(filename))
      .sort((a, b) => {
        const episodeDiff = (parseEpisodeFromFilename(a) || 0) - (parseEpisodeFromFilename(b) || 0)
        if (episodeDiff !== 0) return episodeDiff
        return scoreFilename(b) - scoreFilename(a)
      })

    for (const filename of filenames) {
      const episode = parseEpisodeFromFilename(filename)
      if (episode === null) continue
      if (deduped.has(episode)) continue

      deduped.set(episode, {
        episode,
        filename,
        filePath: join(dirPath, filename)
      })
    }
  }

  return [...deduped.values()].sort((a, b) => a.episode - b.episode)
}

export function getExistingScriptEpisodeSet(projectPath: string): Set<number> {
  return new Set(listScriptEpisodeFiles(projectPath).map((file) => file.episode))
}
