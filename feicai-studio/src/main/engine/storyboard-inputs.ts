import { readFile } from 'fs/promises'
import { join } from 'path'
import { parseAssetMarkdown, type ParsedAsset } from '../asset/markdown-parser'

function epLabelVariants(episodeNum: number): string[] {
  const short = `ep${String(episodeNum).padStart(2, '0')}`.toLowerCase()
  const long = `ep${String(episodeNum).padStart(3, '0')}`.toLowerCase()
  const numeric = String(episodeNum)
  return [short, long, `第${numeric}集`, `第 ${numeric} 集`, `ep ${numeric}`, `ep${numeric}`].map((item) => item.toLowerCase())
}

function isEpisodeSpecificAsset(asset: ParsedAsset, episodeNum: number): boolean {
  const variants = epLabelVariants(episodeNum)
  const name = asset.name.toLowerCase()
  const body = asset.promptText.toLowerCase()
  return variants.some((variant) => name.includes(variant) || body.includes(variant))
}

function formatAssetSubset(title: string, assets: ParsedAsset[]): string | undefined {
  if (assets.length === 0) return undefined
  return `# ${title}\n\n${assets.map((asset) => `## ${asset.name}\n\n${asset.promptText.trim()}`).join('\n\n')}`
}

export interface StoryboardEpisodeInputs {
  directorAnalysis: string
  characterPrompts?: string
  scenePrompts?: string
}

export async function loadStoryboardEpisodeInputs(projectPath: string, episodeNum: number): Promise<StoryboardEpisodeInputs> {
  const epStr = String(episodeNum).padStart(3, '0')
  const directorAnalysisPath = join(projectPath, 'outputs', `ep${epStr}`, '01-director-analysis.md')
  const characterPromptsPath = join(projectPath, 'assets', 'character-prompts.md')
  const scenePromptsPath = join(projectPath, 'assets', 'scene-prompts.md')

  const directorAnalysis = await readFile(directorAnalysisPath, 'utf-8')

  let characterPrompts: string | undefined
  let scenePrompts: string | undefined

  try {
    const raw = await readFile(characterPromptsPath, 'utf-8')
    const parsed = parseAssetMarkdown(raw)
    const filtered = parsed.filter((asset) => isEpisodeSpecificAsset(asset, episodeNum))
    characterPrompts = formatAssetSubset(`EP${String(episodeNum).padStart(2, '0')} 角色提示词`, filtered)
  } catch {
    characterPrompts = undefined
  }

  try {
    const raw = await readFile(scenePromptsPath, 'utf-8')
    const parsed = parseAssetMarkdown(raw)
    const filtered = parsed.filter((asset) => isEpisodeSpecificAsset(asset, episodeNum))
    scenePrompts = formatAssetSubset(`EP${String(episodeNum).padStart(2, '0')} 场景提示词`, filtered)
  } catch {
    scenePrompts = undefined
  }

  return {
    directorAnalysis,
    characterPrompts,
    scenePrompts
  }
}
