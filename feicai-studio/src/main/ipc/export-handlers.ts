// ============================================================
// Export Handlers — 产出文件导出 IPC
// ============================================================

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile, writeFile, mkdir, readdir, copyFile } from 'fs/promises'
import { join } from 'path'
import { IPC } from '@shared/ipc-channels'
import { assertProjectPathAccess } from './path-access'
import { exportArtifactsBundle, listArtifacts } from '../project/artifact-service'

export function registerExportHandlers(): void {
  function normalizeEpisodeRange(episodeRange: number[]): number[] {
    return [...new Set(episodeRange)]
      .filter((ep) => Number.isInteger(ep) && ep > 0)
      .sort((a, b) => a - b)
  }

  /**
   * 导出提示词 — 汇总指定集数的 Seedance 提示词为单个 Markdown 文件
   */
  ipcMain.handle(IPC.EXPORT_PROMPTS, async (_event, params: {
    projectPath: string
    projectName: string
    episodeRange: number[]
    format: 'markdown' | 'json' | 'csv'
    }) => {
    try {
      const projectPath = assertProjectPathAccess(params.projectPath)
      const { projectName, format } = params
      const episodeRange = normalizeEpisodeRange(params.episodeRange)
      if (episodeRange.length === 0) {
        return { error: '请先选择有效的集数范围' }
      }

      // 弹出保存对话框
      const ext = format === 'json' ? 'json' : format === 'csv' ? 'csv' : 'md'
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showSaveDialog(win!, {
        title: '导出提示词',
        defaultPath: `${projectName}-prompts-ep${episodeRange[0]}-${episodeRange[episodeRange.length - 1]}.${ext}`,
        filters: [
          { name: format.toUpperCase(), extensions: [ext] }
        ]
      })

      if (result.canceled || !result.filePath) {
        return { canceled: true }
      }

      // 收集提示词
      const sections: string[] = []
      const jsonData: Array<{ episode: number; content: string }> = []

      for (const ep of episodeRange) {
        const epStr = String(ep).padStart(3, '0')
        const promptPath = join(projectPath, 'outputs', `ep${epStr}`, '02-seedance-prompts.md')
        try {
          const content = await readFile(promptPath, 'utf-8')
          if (format === 'markdown') {
            sections.push(`# EP${epStr}\n\n${content}`)
          } else if (format === 'json') {
            jsonData.push({ episode: ep, content })
          } else {
            // CSV: 每条提示词一行
            const prompts = content.split(/^## /m).slice(1)
            for (const p of prompts) {
              const title = p.split('\n')[0]?.trim() || ''
              const body = p.split('\n').slice(1).join(' ').trim()
              sections.push(`${ep},"${title}","${body.replace(/"/g, '""')}"`)
            }
          }
        } catch {
          // 该集无提示词，跳过
        }
      }

      // 写入文件
      const exportedCount = format === 'json'
        ? jsonData.length
        : format === 'csv'
          ? sections.length
          : sections.length
      if (exportedCount === 0) {
        return { error: '所选集数没有可导出的提示词' }
      }

      let output: string
      if (format === 'markdown') {
        output = sections.join('\n\n---\n\n')
      } else if (format === 'json') {
        output = JSON.stringify(jsonData, null, 2)
      } else {
        output = `集数,标题,内容\n${sections.join('\n')}`
      }

      await writeFile(result.filePath, output, 'utf-8')
      return { success: true, path: result.filePath, count: exportedCount }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  })

  /**
   * 导出全部产出 — 将 outputs + assets 复制到指定目录
   */
  ipcMain.handle(IPC.EXPORT_ALL, async (_event, params: {
    projectPath: string
    projectName: string
  }) => {
    try {
      const safeProjectPath = assertProjectPathAccess(params.projectPath)
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showOpenDialog(win!, {
        title: '选择导出目录',
        properties: ['openDirectory', 'createDirectory']
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true }
      }

      const exportDir = join(result.filePaths[0], `${params.projectName}-export`)
      await mkdir(exportDir, { recursive: true })

      const bundle = await exportArtifactsBundle(safeProjectPath, exportDir)
      const currentArtifacts = await listArtifacts({
        projectPath: safeProjectPath,
        currentOnly: true
      })
      const pipelineStatePath = join(safeProjectPath, 'outputs', 'pipeline-state.json')
      try {
        await copyFile(pipelineStatePath, join(exportDir, 'outputs', 'pipeline-state.json'))
      } catch {
        // 缺少运行状态则跳过
      }

      await writeFile(join(exportDir, 'export-summary.json'), JSON.stringify({
        exportedAt: new Date().toISOString(),
        projectName: params.projectName,
        artifactCount: currentArtifacts.length,
        manifestPath: bundle.manifestPath,
        includedReviewSource: 'outputs/pipeline-state.json'
      }, null, 2), 'utf-8')

      return { success: true, path: exportDir, count: currentArtifacts.length }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  })

  /**
   * 导出剧本合集 — 将多集 epXX.md 融合为一个超级长文导出
   */
  ipcMain.handle(IPC.EXPORT_SCRIPTS, async (_event, params: {
    projectPath: string
    projectName: string
    episodeRange: number[]
    }) => {
    try {
      const projectPath = assertProjectPathAccess(params.projectPath)
      const { projectName } = params
      const episodeRange = normalizeEpisodeRange(params.episodeRange)
      if (episodeRange.length === 0) {
        return { error: '请先选择有效的集数范围' }
      }

      const win = BrowserWindow.getFocusedWindow()
      const startStr = String(episodeRange[0]).padStart(3, '0')
      const endStr = String(episodeRange[episodeRange.length - 1]).padStart(3, '0')
      const result = await dialog.showSaveDialog(win!, {
        title: '导出融合剧本',
        defaultPath: `${projectName}-Scripts-ep${startStr}-${endStr}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }, { name: '纯文本', extensions: ['txt'] }]
      })

      if (result.canceled || !result.filePath) {
        return { canceled: true }
      }

      const sections: string[] = []
      for (const ep of episodeRange) {
        const epStr = String(ep).padStart(3, '0')
        const scriptPath = join(projectPath, 'script', `ep${epStr}.md`)
        try {
          const content = await readFile(scriptPath, 'utf-8')
          sections.push(content)
        } catch {
          // 该集无剧本，跳过
        }
      }

      if (sections.length === 0) {
        return { error: '所选集数没有可导出的剧本' }
      }

      const finalOutput = sections.join('\n\n---\n\n')
      await writeFile(result.filePath, finalOutput, 'utf-8')

      return { success: true, path: result.filePath, count: sections.length }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  })
}
async function copyDirRecursive(src: string, dest: string): Promise<void> {
  try {
    await mkdir(dest, { recursive: true })
    const entries = await readdir(src, { withFileTypes: true })
    for (const entry of entries) {
      const srcPath = join(src, entry.name)
      const destPath = join(dest, entry.name)
      if (entry.isDirectory()) {
        await copyDirRecursive(srcPath, destPath)
      } else {
        await copyFile(srcPath, destPath)
      }
    }
  } catch {
    // 源目录不存在，跳过
  }
}
