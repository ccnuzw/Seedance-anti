// ============================================================
// Art Output Merger — 解析 art 阶段输出并合并到 assets
// ============================================================

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'

export class ArtOutputMerger {
  /**
   * 解析 art 阶段 LLM 输出，提取人物和场景段落，追加到 assets 文件
   */
  static async parseAndMerge(
    output: string,
    projectPath: string,
    episodeNum: number
  ): Promise<{ characters: number; scenes: number }> {
    const epTag = `ep${String(episodeNum).padStart(3, '0')}`
    const assetsDir = join(projectPath, 'assets')
    await mkdir(assetsDir, { recursive: true })

    const charPath = join(assetsDir, 'character-prompts.md')
    const scenePath = join(assetsDir, 'scene-prompts.md')

    // 解析输出：分拆为人物和场景两个段落
    const { characterSection, sceneSection } = this.parseOutput(output)

    let charCount = 0
    let sceneCount = 0

    // 追加人物提示词
    if (characterSection.trim()) {
      const header = `\n\n<!-- ${epTag} 新增 -->\n`
      const existing = await this.safeRead(charPath)
      await writeFile(charPath, existing + header + characterSection.trim() + '\n', 'utf-8')
      charCount = (characterSection.match(/^##\s/gm) || []).length
    }

    // 追加场景提示词
    if (sceneSection.trim()) {
      const header = `\n\n<!-- ${epTag} 新增 -->\n`
      const existing = await this.safeRead(scenePath)
      await writeFile(scenePath, existing + header + sceneSection.trim() + '\n', 'utf-8')
      sceneCount = (sceneSection.match(/^##\s/gm) || []).length
    }

    return { characters: charCount, scenes: sceneCount }
  }

  /**
   * 解析 LLM 输出，分拆为人物和场景两部分
   * 支持多种标题格式：# 人物提示词 / # 场景道具提示词 / ## 人物 等
   */
  private static parseOutput(output: string): {
    characterSection: string
    sceneSection: string
  } {
    // 尝试按一级标题 # 分割
    const charPatterns = [
      /^#\s*人物(?:提示词|设定|素材)/m,
      /^#\s*角色(?:提示词|设定|素材)/m,
      /^#\s*Character/mi
    ]
    const scenePatterns = [
      /^#\s*场景(?:道具|环境)?(?:提示词|设定|素材)/m,
      /^#\s*Scene/mi
    ]

    let charStart = -1
    let sceneStart = -1

    for (const p of charPatterns) {
      const m = output.match(p)
      if (m && m.index !== undefined) { charStart = m.index; break }
    }
    for (const p of scenePatterns) {
      const m = output.match(p)
      if (m && m.index !== undefined) { sceneStart = m.index; break }
    }

    let characterSection = ''
    let sceneSection = ''

    if (charStart >= 0 && sceneStart >= 0) {
      if (charStart < sceneStart) {
        characterSection = output.slice(charStart, sceneStart)
        sceneSection = output.slice(sceneStart)
      } else {
        sceneSection = output.slice(sceneStart, charStart)
        characterSection = output.slice(charStart)
      }
    } else if (charStart >= 0) {
      characterSection = output.slice(charStart)
    } else if (sceneStart >= 0) {
      sceneSection = output.slice(sceneStart)
    } else {
      // 无法解析分割，整段作为人物部分
      characterSection = output
    }

    return { characterSection, sceneSection }
  }

  /** 安全读取文件，不存在返回空字符串 */
  private static async safeRead(path: string): Promise<string> {
    try {
      return await readFile(path, 'utf-8')
    } catch {
      return ''
    }
  }
}
