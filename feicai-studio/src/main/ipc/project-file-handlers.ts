import { ipcMain } from 'electron'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { IPC } from '@shared/ipc-channels'
import { syncProjectConfigSnapshotByPath } from '../db/queries'
import { writeArtifactJson, writeArtifactText } from '../project/artifact-service'
import {
  getWritableScriptEpisodePath,
  listScriptEpisodeFiles,
  resolveScriptEpisodePath
} from '../project/script-file-utils'
import {
  readProjectConfig,
  saveProjectConfig
} from '../project/project-config-store'
import {
  deleteEpisodeOutline,
  generateEpisodeOutline,
  generateEpisodeScript,
  getEpisodeOutline,
  listEpisodeOutlines,
  listScriptVersions,
  readNovelContent,
  saveEpisodeOutline,
  saveNovelContent
} from '../project/project-content-service'
import { assertProjectPathAccess } from './path-access'

type PromptArtifactType = 'prompts' | 'director' | 'art'

const PROMPT_FILE_MAP: Record<PromptArtifactType, string> = {
  prompts: '02-seedance-prompts.md',
  director: '01-director-analysis.md',
  art: '01.5-art-design-output.md'
}

const PROMPT_ARTIFACT_KIND_MAP = {
  prompts: 'seedance_prompts',
  director: 'director_output',
  art: 'art_output'
} as const

function getScriptPath(projectPath: string, episode: number): string {
  const safeProjectPath = assertProjectPathAccess(projectPath)
  return resolveScriptEpisodePath(safeProjectPath, episode)
    || getWritableScriptEpisodePath(safeProjectPath, episode)
}

function getPromptArtifactPath(projectPath: string, episode: number, type: PromptArtifactType): string {
  const safeProjectPath = assertProjectPathAccess(projectPath)
  const epStr = String(episode).padStart(3, '0')
  return join(safeProjectPath, 'outputs', `ep${epStr}`, PROMPT_FILE_MAP[type])
}

function getNovelChapterPath(projectPath: string, chapterNum: number): string {
  const safeProjectPath = assertProjectPathAccess(projectPath)
  const chapterStr = String(chapterNum).padStart(4, '0')
  return join(safeProjectPath, 'novel', `chapter-${chapterStr}.txt`)
}

export function registerProjectFileHandlers(): void {
  ipcMain.handle(IPC.PROJECT_READ_CONFIG, async (_event, projectPath: string) => {
    const safeProjectPath = assertProjectPathAccess(projectPath)
    return readProjectConfig(safeProjectPath)
  })

  ipcMain.handle(IPC.PROJECT_SAVE_CONFIG, async (_event, projectPath: string, config: Record<string, unknown>) => {
    const safeProjectPath = assertProjectPathAccess(projectPath)
    const saved = await saveProjectConfig(safeProjectPath, {
      workingDirectory: safeProjectPath,
      ...config
    })
    await writeArtifactJson({
      projectPath: safeProjectPath,
      kind: 'project_config',
      filePath: join(safeProjectPath, 'project-config.json'),
      content: saved,
      label: '项目配置',
      createdBy: 'user'
    })
    const project = syncProjectConfigSnapshotByPath(safeProjectPath, saved)
    return { success: true, config: saved, project }
  })

  ipcMain.handle(IPC.SCRIPT_READ_EPISODE, async (_event, projectPath: string, episode: number) => {
    const scriptPath = getScriptPath(projectPath, episode)
    if (!existsSync(scriptPath)) return null
    return readFile(scriptPath, 'utf-8')
  })

  ipcMain.handle(IPC.SCRIPT_SAVE_EPISODE, async (_event, projectPath: string, episode: number, content: string) => {
    const safeProjectPath = assertProjectPathAccess(projectPath)
    const scriptPath = getScriptPath(safeProjectPath, episode)
    await writeArtifactText({
      projectPath: safeProjectPath,
      kind: 'script_episode',
      filePath: scriptPath,
      content,
      contentType: 'text/markdown',
      episodeNum: episode,
      createdBy: 'user'
    })
    return { success: true, filePath: scriptPath }
  })

  ipcMain.handle(IPC.SCRIPT_LIST_EPISODES, async (_event, projectPath: string) => {
    const safeProjectPath = assertProjectPathAccess(projectPath)
    return Promise.all(
      listScriptEpisodeFiles(safeProjectPath).map(async ({ filename, episode, filePath }) => ({
        episode,
        filename,
        content: await readFile(filePath, 'utf-8')
      }))
    )
  })

  ipcMain.handle(IPC.SCRIPT_GENERATE_EPISODE, async (_event, payload: { projectPath: string; episodeNumber: number; force?: boolean }) => {
    const safeProjectPath = assertProjectPathAccess(payload.projectPath)
    return generateEpisodeScript({
      projectPath: safeProjectPath,
      episodeNumber: payload.episodeNumber,
      force: payload.force
    })
  })

  ipcMain.handle(IPC.SCRIPT_LIST_VERSIONS, async (_event, projectPath: string, episodeNumber: number) => {
    const safeProjectPath = assertProjectPathAccess(projectPath)
    return listScriptVersions(safeProjectPath, episodeNumber)
  })

  ipcMain.handle(
    IPC.PROMPT_READ_EPISODE_FILE,
    async (_event, projectPath: string, episode: number, type: PromptArtifactType) => {
      const filePath = getPromptArtifactPath(projectPath, episode, type)
      if (!existsSync(filePath)) return null
      return readFile(filePath, 'utf-8')
    }
  )

  ipcMain.handle(
    IPC.PROMPT_SAVE_EPISODE_FILE,
    async (_event, projectPath: string, episode: number, type: PromptArtifactType, content: string) => {
      const filePath = getPromptArtifactPath(projectPath, episode, type)
      await writeArtifactText({
        projectPath: assertProjectPathAccess(projectPath),
        kind: PROMPT_ARTIFACT_KIND_MAP[type],
        filePath,
        content,
        contentType: 'text/markdown',
        episodeNum: episode,
        stage: type === 'director' ? 'director' : type === 'art' ? 'art' : 'storyboard',
        createdBy: 'user'
      })
      return { success: true }
    }
  )

  ipcMain.handle(IPC.NOVEL_READ_CHAPTER, async (_event, projectPath: string, chapterNum: number) => {
    const chapterPath = getNovelChapterPath(projectPath, chapterNum)
    if (!existsSync(chapterPath)) return null
    const content = await readFile(chapterPath, 'utf-8')
    const title = content.split('\n')[0]?.trim() || `第${chapterNum}章`
    return { chapterNum, title, content }
  })

  ipcMain.handle(IPC.NOVEL_READ_CONTENT, async (_event, projectPath: string) => {
    const safeProjectPath = assertProjectPathAccess(projectPath)
    return readNovelContent(safeProjectPath)
  })

  ipcMain.handle(IPC.NOVEL_SAVE_CONTENT, async (_event, payload: { projectPath: string; content: string; title?: string; genre?: string; sourcePath?: string }) => {
    const safeProjectPath = assertProjectPathAccess(payload.projectPath)
    const doc = await saveNovelContent({
      ...payload,
      projectPath: safeProjectPath
    })
    const savedConfig = await readProjectConfig(safeProjectPath)
    const project = savedConfig ? syncProjectConfigSnapshotByPath(safeProjectPath, savedConfig) : null
    return { success: true, document: doc, project }
  })

  ipcMain.handle(IPC.PLOT_LIST_EPISODE_OUTLINES, async (_event, projectPath: string) => {
    const safeProjectPath = assertProjectPathAccess(projectPath)
    return listEpisodeOutlines(safeProjectPath)
  })

  ipcMain.handle(IPC.PLOT_GET_EPISODE_OUTLINE, async (_event, projectPath: string, episodeNumber: number) => {
    const safeProjectPath = assertProjectPathAccess(projectPath)
    return getEpisodeOutline(safeProjectPath, episodeNumber)
  })

  ipcMain.handle(IPC.PLOT_SAVE_EPISODE_OUTLINE, async (_event, payload: { projectPath: string; episodeNumber: number; outline: Record<string, unknown> }) => {
    const safeProjectPath = assertProjectPathAccess(payload.projectPath)
    return saveEpisodeOutline({
      projectPath: safeProjectPath,
      episodeNumber: payload.episodeNumber,
      outline: payload.outline
    })
  })

  ipcMain.handle(IPC.PLOT_DELETE_EPISODE_OUTLINE, async (_event, projectPath: string, episodeNumber: number) => {
    const safeProjectPath = assertProjectPathAccess(projectPath)
    return deleteEpisodeOutline(safeProjectPath, episodeNumber)
  })

  ipcMain.handle(IPC.PLOT_GENERATE_EPISODE_OUTLINE, async (_event, payload: { projectPath: string; episodeNumber: number }) => {
    const safeProjectPath = assertProjectPathAccess(payload.projectPath)
    return generateEpisodeOutline({
      projectPath: safeProjectPath,
      episodeNumber: payload.episodeNumber
    })
  })

  ipcMain.handle(IPC.PLOT_READ_RAW, async (_event, projectPath: string) => {
    const safeProjectPath = assertProjectPathAccess(projectPath)
    const plotJsonPath = join(safeProjectPath, 'plot-breakdown.json')
    if (existsSync(plotJsonPath)) return readFile(plotJsonPath, 'utf-8')
    const plotMarkdownPath = join(safeProjectPath, 'plot-breakdown.md')
    if (!existsSync(plotMarkdownPath)) return null
    return readFile(plotMarkdownPath, 'utf-8')
  })
}
