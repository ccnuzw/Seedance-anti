import { dialog } from 'electron'
import { mkdir, readdir } from 'fs/promises'
import { join, relative } from 'path'
import { IPC } from '@shared/ipc-channels'
import type { EpisodeArtifactId } from '@shared/artifact-registry'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath,
  resolveProjectLayout
} from '@shared/path-resolver'
import { parseReviewMarkdown } from '@shared/review-artifacts'
import type {
  Project,
  ProjectPipelineState,
  ReviewResult,
  ReviewStage
} from '@shared/types'
import {
  assertEpisodeNumber,
  assertNonEmptyString,
  assertPathWithinProject,
  assertRegisteredProjectRoot,
  isMissingFileError,
  isSameProjectRoot
} from '../security/access-control'
import { assertAllowedKeys, assertRecord } from '../security/input-validation'
import { registerSafeIpcHandler as handle } from '../security/safe-ipc'
import {
  atomicWriteFile,
  readJsonWithRecovery,
  readRegularFile
} from '../io/atomic-file'
import {
  hashReviewContent,
  isReviewCurrent
} from '../engine/artifact-provenance'
import { listRegisteredProjects } from '../services/project-service'

const gate = 'current-reviewed-only' as const
const reviewArtifacts: Partial<Record<ReviewStage, EpisodeArtifactId>> = {
  story_review: 'storyReview',
  script_review: 'scriptReview',
  storyboard_review: 'storyboardReview'
}
const exportArtifacts: Record<ReviewStage, EpisodeArtifactId> = {
  story_review: 'storyBeat',
  script_review: 'script',
  director: 'directorAnalysis',
  art: 'artDesign',
  storyboard_review: 'seedancePrompts'
}
const upstream: Record<ReviewStage, ReviewStage[]> = {
  story_review: [],
  script_review: [],
  director: ['script_review'],
  art: ['script_review', 'director'],
  storyboard_review: ['script_review', 'director', 'art']
}

export function safeExportName(name: string): string {
  const safe = name
    .replace(/[\p{Cc}/\\:*?"<>|]/gu, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 100)
  if (!safe || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe))
    return `project-${safe || 'export'}`
  return safe
}

/** Quote every field, including numbers; neutralize spreadsheet formula starts. */
export function escapeCsvField(value: string | number): string {
  let text = String(value)
  if (/^[\s\p{Cc}]*[=+@-]/u.test(text) || /^[\t\r\n]/.test(text))
    text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

function registeredProject(path: unknown): Project {
  assertNonEmptyString(path, '项目目录')
  const root = assertRegisteredProjectRoot(path)
  const project = listRegisteredProjects().find((item) =>
    isSameProjectRoot(item.projectPath, root)
  )
  if (!project) throw new Error('项目未注册')
  return { ...project, projectPath: root }
}

async function optionalText(
  project: Project,
  artifact: EpisodeArtifactId,
  episode: number
): Promise<string | null> {
  const path = assertPathWithinProject(
    project.projectPath,
    resolveEpisodeArtifactPath(
      project.projectPath,
      artifact,
      episode,
      project.config
    )
  )
  try {
    return (await readRegularFile(path)).toString('utf8')
  } catch (error) {
    if (isMissingFileError(error)) return null
    throw error
  }
}

function isReview(value: unknown, stage: ReviewStage): value is ReviewResult {
  if (!value || typeof value !== 'object') return false
  const review = value as Partial<ReviewResult>
  return (
    review.stage === stage &&
    typeof review.createdAt === 'string' &&
    typeof review.score === 'number' &&
    typeof review.passed === 'boolean' &&
    ['PASS', 'FAIL', 'INVALID'].includes(String(review.result))
  )
}

async function loadReviewState(
  project: Project
): Promise<ProjectPipelineState | null> {
  const path = assertPathWithinProject(
    project.projectPath,
    resolveProjectArtifactPath(
      project.projectPath,
      'pipelineState',
      project.config
    )
  )
  const state = await readJsonWithRecovery<ProjectPipelineState>(path)
  if (state) {
    assertRecord(state)
    assertRecord(state.episodes, '流水线集数状态')
  }
  return state
}

async function latestReview(
  project: Project,
  state: ProjectPipelineState | null,
  stage: ReviewStage,
  episode: number
): Promise<ReviewResult | null> {
  const episodeState = state?.episodes[episode]
  const candidates: ReviewResult[] = []
  if (Array.isArray(episodeState?.reviews)) {
    for (const review of episodeState.reviews)
      if (isReview(review, stage)) candidates.push(review)
  }
  const last = episodeState?.stageStates?.[stage]?.lastReview
  if (isReview(last, stage)) candidates.push(last)
  const artifact = reviewArtifacts[stage]
  if (artifact) {
    const content = await optionalText(project, artifact, episode)
    if (content !== null) {
      const review = parseReviewMarkdown(content, stage)
      if (!review) throw new Error(`EP${episode} ${stage}审核报告格式无效`)
      candidates.push(review)
    }
  }
  candidates
    .reverse()
    .sort(
      (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
    )
  return candidates[0] || null
}

interface ApprovedArtifact {
  episode: number
  stage: ReviewStage
  path: string
  content: string
  reviews: ReviewResult[]
}

async function approvedArtifact(
  project: Project,
  state: ProjectPipelineState | null,
  stage: ReviewStage,
  episode: number
): Promise<ApprovedArtifact | null> {
  const path = assertPathWithinProject(
    project.projectPath,
    resolveEpisodeArtifactPath(
      project.projectPath,
      exportArtifacts[stage],
      episode,
      project.config
    )
  )
  const content = await optionalText(project, exportArtifacts[stage], episode)
  if (content === null || !content.trim()) return null
  const reviews: ReviewResult[] = []
  for (const dependency of [...upstream[stage], stage]) {
    const review = await latestReview(project, state, dependency, episode)
    if (
      !review ||
      !isReviewCurrent(review, project.projectPath, episode, project.config)
    )
      return null
    reviews.push(review)
  }
  if (hashReviewContent(content) !== reviews[reviews.length - 1].artifactHash)
    return null
  return { episode, stage, path, content, reviews }
}

async function revalidate(
  project: Project,
  artifacts: ApprovedArtifact[]
): Promise<void> {
  const state = await loadReviewState(project)
  for (const artifact of artifacts) {
    assertPathWithinProject(project.projectPath, artifact.path)
    for (const previous of artifact.reviews) {
      const review = await latestReview(
        project,
        state,
        previous.stage,
        artifact.episode
      )
      if (
        !review ||
        review.artifactHash !== previous.artifactHash ||
        !isReviewCurrent(
          review,
          project.projectPath,
          artifact.episode,
          project.config
        )
      ) {
        throw new Error(
          `EP${artifact.episode}产物或上游审核在导出期间发生变化，请重试`
        )
      }
    }
  }
}

function exportError(error: unknown): { error: string; gate: typeof gate } {
  return { error: error instanceof Error ? error.message : String(error), gate }
}

export function registerExportHandlers(): void {
  handle(IPC.EXPORT_PROMPTS, async (_event, params: unknown) => {
    try {
      assertRecord(params)
      assertAllowedKeys(params, [
        'projectPath',
        'projectName',
        'episodeRange',
        'format'
      ])
      const project = registeredProject(params.projectPath)
      assertNonEmptyString(params.projectName, '项目名')
      if (
        !Array.isArray(params.episodeRange) ||
        !params.episodeRange.length ||
        params.episodeRange.length > 10000
      )
        throw new Error('请选择有效集数范围')
      const episodes = [
        ...new Set(
          params.episodeRange.map((value: unknown) => {
            assertEpisodeNumber(value)
            return value
          })
        )
      ]
      if (
        params.format !== 'markdown' &&
        params.format !== 'json' &&
        params.format !== 'csv'
      )
        throw new Error('不支持的导出格式')
      const state = await loadReviewState(project)
      const artifacts: ApprovedArtifact[] = []
      for (const episode of episodes) {
        const artifact = await approvedArtifact(
          project,
          state,
          'storyboard_review',
          episode
        )
        if (artifact) artifacts.push(artifact)
      }
      if (!artifacts.length)
        throw new Error(
          '没有当前审核有效的提示词可导出；请先完成或重新执行剧本、导演、服化道及分镜审核'
        )
      const extension = params.format === 'markdown' ? 'md' : params.format
      const result = await dialog.showSaveDialog({
        title: '导出当前审核有效提示词（非项目备份）',
        defaultPath: `${safeExportName(project.name)}-prompts-ep${episodes[0]}-${episodes[episodes.length - 1]}.${extension}`,
        filters: [
          { name: params.format.toUpperCase(), extensions: [extension] }
        ]
      })
      if (result.canceled || !result.filePath) return { canceled: true, gate }
      let output: string
      if (params.format === 'markdown') {
        output = artifacts
          .map(
            (artifact) =>
              `# EP${String(artifact.episode).padStart(2, '0')}\n\n${artifact.content}`
          )
          .join('\n\n---\n\n')
      } else if (params.format === 'json') {
        output = JSON.stringify(
          artifacts.map((artifact) => ({
            episode: artifact.episode,
            content: artifact.content
          })),
          null,
          2
        )
      } else {
        const rows: Array<Array<string | number>> = [['集数', '标题', '内容']]
        for (const artifact of artifacts) {
          const sections = artifact.content.split(/^## /m).slice(1)
          if (!sections.length)
            rows.push([artifact.episode, '提示词', artifact.content])
          for (const section of sections) {
            const [title, ...body] = section.split('\n')
            rows.push([artifact.episode, title.trim(), body.join('\n').trim()])
          }
        }
        output = rows
          .map((row) => row.map(escapeCsvField).join(','))
          .join('\r\n')
      }
      await revalidate(project, artifacts)
      // The native save dialog grants only this exact target. Atomic I/O rejects
      // existing final/parent links, including .bak links, before replacement.
      await atomicWriteFile(result.filePath, output)
      return {
        success: true,
        path: result.filePath,
        count: artifacts.length,
        skipped: episodes.length - artifacts.length,
        gate
      }
    } catch (error) {
      return exportError(error)
    }
  })

  handle(IPC.EXPORT_ALL, async (_event, params: unknown) => {
    try {
      assertRecord(params)
      assertAllowedKeys(params, ['projectPath', 'projectName'])
      const project = registeredProject(params.projectPath)
      assertNonEmptyString(params.projectName, '项目名')
      const state = await loadReviewState(project)
      const episodes = new Set<number>()
      const layout = resolveProjectLayout(project.config)
      for (const directory of [
        layout.outputsDir,
        layout.scriptDir,
        layout.storyEpisodeBeatsDir
      ]) {
        const path = assertPathWithinProject(
          project.projectPath,
          join(project.projectPath, directory)
        )
        try {
          for (const entry of await readdir(path, { withFileTypes: true })) {
            const match = entry.name.match(/^ep(\d+)(?:\.md)?$/i)
            if (!match) continue
            const episode = Number(match[1])
            assertEpisodeNumber(episode)
            episodes.add(episode)
          }
        } catch (error) {
          if (!isMissingFileError(error)) throw error
        }
      }
      const artifacts: ApprovedArtifact[] = []
      for (const episode of [...episodes].sort((a, b) => a - b)) {
        for (const stage of Object.keys(exportArtifacts) as ReviewStage[]) {
          const artifact = await approvedArtifact(
            project,
            state,
            stage,
            episode
          )
          if (artifact) artifacts.push(artifact)
        }
      }
      if (!artifacts.length)
        throw new Error(
          '没有当前审核有效的产物可导出；此功能不是项目备份，不会复制草稿、源文、状态或全局素材库'
        )
      const result = await dialog.showOpenDialog({
        title: '导出审核有效产物（非项目备份）',
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || !result.filePaths.length)
        return { canceled: true, gate }
      const selectedRoot = assertPathWithinProject(
        result.filePaths[0],
        result.filePaths[0]
      )
      const name = `${safeExportName(project.name)}-export`
      let directory = ''
      for (let suffix = 0; !directory; suffix++) {
        const candidate = assertPathWithinProject(
          selectedRoot,
          join(selectedRoot, `${name}${suffix ? `-${suffix + 1}` : ''}`)
        )
        try {
          await mkdir(candidate)
          directory = candidate
        } catch (error) {
          if (
            !error ||
            typeof error !== 'object' ||
            !('code' in error) ||
            error.code !== 'EEXIST'
          )
            throw error
        }
      }
      await revalidate(project, artifacts)
      for (const artifact of artifacts) {
        const destination = assertPathWithinProject(
          directory,
          join(directory, relative(project.projectPath, artifact.path))
        )
        await atomicWriteFile(destination, artifact.content)
      }
      await atomicWriteFile(
        join(directory, 'export-manifest.json'),
        JSON.stringify(
          {
            gate,
            backup: false,
            description:
              '仅当前审核有效产物；不是项目备份。未审核或失效内容、源文、状态与全局素材库不在此导出范围。',
            projectName: project.name,
            exportedAt: new Date().toISOString(),
            count: artifacts.length,
            artifacts: artifacts.map((artifact) => ({
              episode: artifact.episode,
              stage: artifact.stage,
              path: relative(project.projectPath, artifact.path),
              artifactHash: hashReviewContent(artifact.content)
            }))
          },
          null,
          2
        )
      )
      return { success: true, path: directory, count: artifacts.length, gate }
    } catch (error) {
      return exportError(error)
    }
  })
}
