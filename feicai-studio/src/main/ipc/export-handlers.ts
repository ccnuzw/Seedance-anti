// ============================================================
// Export Handlers — 产出文件导出 IPC
// ============================================================

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile, writeFile, mkdir, readdir, copyFile } from 'fs/promises'
import { join } from 'path'
import { IPC } from '@shared/ipc-channels'
import {
  resolveEpisodeArtifactPath,
  resolveProjectLayout
} from '@shared/path-resolver'
import { assertRegisteredProjectRoot } from '../security/access-control'

export function registerExportHandlers(): void {
  /**
   * 导出提示词 — 汇总指定集数的 Seedance 提示词为单个 Markdown 文件
   */
  ipcMain.handle(
    IPC.EXPORT_PROMPTS,
    async (
      _event,
      params: {
        projectPath: string
        projectName: string
        episodeRange: number[]
        format: 'markdown' | 'json' | 'csv'
      }
    ) => {
      try {
        const trustedProjectPath = assertRegisteredProjectRoot(
          params.projectPath
        )
        const { projectName, episodeRange, format } = params

        // 弹出保存对话框
        const ext = format === 'json' ? 'json' : format === 'csv' ? 'csv' : 'md'
        const win = BrowserWindow.getFocusedWindow()
        const result = await dialog.showSaveDialog(win!, {
          title: '导出提示词',
          defaultPath: `${projectName}-prompts-ep${episodeRange[0]}-${episodeRange[episodeRange.length - 1]}.${ext}`,
          filters: [{ name: format.toUpperCase(), extensions: [ext] }]
        })

        if (result.canceled || !result.filePath) {
          return { canceled: true }
        }

        // 收集提示词
        const sections: string[] = []
        const jsonData: Array<{ episode: number; content: string }> = []

        for (const ep of episodeRange) {
          const epStr = String(ep).padStart(2, '0')
          const promptPath = resolveEpisodeArtifactPath(
            trustedProjectPath,
            'seedancePrompts',
            ep
          )
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
        let output: string
        if (format === 'markdown') {
          output = sections.join('\n\n---\n\n')
        } else if (format === 'json') {
          output = JSON.stringify(jsonData, null, 2)
        } else {
          output = `集数,标题,内容\n${sections.join('\n')}`
        }

        await writeFile(result.filePath, output, 'utf-8')
        return {
          success: true,
          path: result.filePath,
          count: episodeRange.length
        }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  /**
   * 导出全部产出 — 将 outputs + assets 复制到指定目录
   */
  ipcMain.handle(
    IPC.EXPORT_ALL,
    async (
      _event,
      params: {
        projectPath: string
        projectName: string
      }
    ) => {
      try {
        const win = BrowserWindow.getFocusedWindow()
        const result = await dialog.showOpenDialog(win!, {
          title: '选择导出目录',
          properties: ['openDirectory', 'createDirectory']
        })

        if (result.canceled || result.filePaths.length === 0) {
          return { canceled: true }
        }

        const exportDir = join(
          result.filePaths[0],
          `${params.projectName}-export`
        )
        await mkdir(exportDir, { recursive: true })

        // 复制 outputs
        const layout = resolveProjectLayout()
        const trustedProjectPath = assertRegisteredProjectRoot(
          params.projectPath
        )
        const outputsDir = join(trustedProjectPath, layout.outputsDir)
        await copyDirRecursive(outputsDir, join(exportDir, 'outputs'))

        // 复制 assets
        const assetsDir = join(trustedProjectPath, layout.assetsDir)
        await copyDirRecursive(assetsDir, join(exportDir, 'assets'))

        return { success: true, path: exportDir }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }
  )
}

/** 递归复制目录 */
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
