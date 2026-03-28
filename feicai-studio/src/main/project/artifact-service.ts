import { createHash } from 'crypto'
import { existsSync, readdirSync } from 'fs'
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'fs/promises'
import { dirname, extname, join, relative, resolve } from 'path'
import { randomUUID } from 'crypto'
import type {
  ArtifactKind,
  ArtifactManifest,
  ArtifactQuery,
  ArtifactRecord,
  ArtifactRollbackParams
} from '@shared/types'
import {
  ARTIFACT_MANIFEST_VERSION,
  ensureProjectDataFile,
  getProjectDataFilePath
} from './project-data-compat'

const MANIFEST_DIR = join('outputs', 'artifacts')
const MANIFEST_PATH = join(MANIFEST_DIR, 'manifest.json')

interface ArtifactWriteParams {
  projectPath: string
  kind: ArtifactKind
  filePath: string
  content: string
  contentType: string
  label?: string
  episodeNum?: number
  stage?: ArtifactRecord['stage']
  sourceRunId?: string
  createdBy?: ArtifactRecord['createdBy']
  metadata?: Record<string, unknown>
}

interface ArtifactScanCandidate {
  kind: ArtifactKind
  filePath: string
  episodeNum?: number
  stage?: ArtifactRecord['stage']
  label: string
  contentType: string
}

function getManifestAbsolutePath(projectPath: string): string {
  return getProjectDataFilePath(projectPath, 'artifactManifest')
}

function createEmptyManifest(projectPath: string): ArtifactManifest {
  return {
    version: ARTIFACT_MANIFEST_VERSION,
    projectPath,
    artifacts: [],
    updatedAt: new Date().toISOString()
  }
}

async function readManifest(projectPath: string): Promise<ArtifactManifest> {
  const result = await ensureProjectDataFile<ArtifactManifest>(projectPath, 'artifactManifest')
  return result.data || createEmptyManifest(projectPath)
}

async function writeManifest(projectPath: string, manifest: ArtifactManifest): Promise<void> {
  const manifestPath = getManifestAbsolutePath(projectPath)
  await mkdir(dirname(manifestPath), { recursive: true })
  manifest.version = ARTIFACT_MANIFEST_VERSION
  manifest.updatedAt = new Date().toISOString()
  await writeAtomicText(manifestPath, JSON.stringify(manifest, null, 2))
}

async function writeAtomicText(targetPath: string, content: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await writeFile(tempPath, content, 'utf-8')
  await rename(tempPath, targetPath)
}

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function normalizeProjectRelativePath(projectPath: string, filePath: string): string {
  const absolutePath = resolve(filePath)
  const relativePath = relative(projectPath, absolutePath)
  if (relativePath.startsWith('..')) {
    throw new Error(`artifact path must stay within project root: ${filePath}`)
  }
  return relativePath
}

function getArtifactScopeKey(params: {
  kind: ArtifactKind
  episodeNum?: number
  filePath: string
}): string {
  return `${params.kind}:${params.episodeNum ?? 'global'}:${params.filePath}`
}

function getArtifactLabel(kind: ArtifactKind, episodeNum?: number): string {
  const epLabel = typeof episodeNum === 'number'
    ? `EP${String(episodeNum).padStart(3, '0')}`
    : 'GLOBAL'

  switch (kind) {
    case 'project_config':
      return '项目配置'
    case 'plot_breakdown':
      return '剧情拆解'
    case 'adapt_plan':
      return '改编规划'
    case 'adapt_notes':
      return '用户指导笔记'
    case 'script_episode':
      return `${epLabel} 剧本`
    case 'director_output':
      return `${epLabel} 导演分析`
    case 'art_output':
      return `${epLabel} 美术设计`
    case 'seedance_prompts':
      return `${epLabel} Seedance 提示词`
    case 'character_prompts':
      return '角色提示词库'
    case 'scene_prompts':
      return '场景提示词库'
    case 'pipeline_state':
      return '运行状态快照'
    default:
      return kind
  }
}

async function upsertArtifactVersion(params: ArtifactWriteParams): Promise<ArtifactRecord> {
  const projectPath = params.projectPath
  const canonicalRelativePath = normalizeProjectRelativePath(projectPath, params.filePath)
  const canonicalAbsolutePath = join(projectPath, canonicalRelativePath)
  const scopeKey = getArtifactScopeKey({
    kind: params.kind,
    episodeNum: params.episodeNum,
    filePath: canonicalRelativePath
  })
  const hash = computeHash(params.content)
  const manifest = await readManifest(projectPath)
  const previousCurrent = manifest.artifacts.find(
    (artifact) => artifact.scopeKey === scopeKey && artifact.isCurrent
  )

  if (previousCurrent && previousCurrent.hash === hash) {
    await writeAtomicText(canonicalAbsolutePath, params.content)
    return previousCurrent
  }

  const version = (previousCurrent?.version ?? 0) + 1
  const ext = extname(canonicalRelativePath)
  const snapshotRelativePath = join(
    MANIFEST_DIR,
    'snapshots',
    params.kind,
    typeof params.episodeNum === 'number' ? `ep${String(params.episodeNum).padStart(3, '0')}` : 'global',
    `v${String(version).padStart(4, '0')}${ext || '.txt'}`
  )
  const snapshotAbsolutePath = join(projectPath, snapshotRelativePath)

  await writeAtomicText(canonicalAbsolutePath, params.content)
  await writeAtomicText(snapshotAbsolutePath, params.content)

  const fileStat = await stat(canonicalAbsolutePath)
  const createdAt = new Date().toISOString()

  for (const artifact of manifest.artifacts) {
    if (artifact.scopeKey === scopeKey) {
      artifact.isCurrent = false
    }
  }

  const nextRecord: ArtifactRecord = {
    id: randomUUID(),
    projectPath,
    kind: params.kind,
    label: params.label || getArtifactLabel(params.kind, params.episodeNum),
    scopeKey,
    filePath: canonicalRelativePath,
    snapshotPath: snapshotRelativePath,
    episodeNum: params.episodeNum,
    stage: params.stage,
    sourceRunId: params.sourceRunId,
    createdBy: params.createdBy || 'system',
    version,
    contentType: params.contentType,
    sizeBytes: fileStat.size,
    hash,
    isCurrent: true,
    createdAt,
    metadata: params.metadata
  }

  manifest.artifacts.push(nextRecord)
  await writeManifest(projectPath, manifest)
  return nextRecord
}

function scanEpisodeNumberFromFileName(fileName: string): number | undefined {
  const match = fileName.match(/^ep(\d+)(?:\.md)?$/)
  return match ? parseInt(match[1], 10) : undefined
}

function collectCanonicalArtifacts(projectPath: string): ArtifactScanCandidate[] {
  const candidates: ArtifactScanCandidate[] = []

  const pushIfExists = (
    relativePath: string,
    kind: ArtifactKind,
    contentType: string,
    extras?: Pick<ArtifactScanCandidate, 'episodeNum' | 'stage' | 'label'>
  ) => {
    if (existsSync(join(projectPath, relativePath))) {
      candidates.push({
        kind,
        filePath: relativePath,
        contentType,
        label: extras?.label || getArtifactLabel(kind, extras?.episodeNum),
        episodeNum: extras?.episodeNum,
        stage: extras?.stage
      })
    }
  }

  pushIfExists('project-config.json', 'project_config', 'application/json')
  pushIfExists('plot-breakdown.md', 'plot_breakdown', 'text/markdown')
  pushIfExists('adapt-plan.json', 'adapt_plan', 'application/json')
  pushIfExists('context-notes.md', 'adapt_notes', 'text/markdown')
  pushIfExists(join('outputs', 'pipeline-state.json'), 'pipeline_state', 'application/json')
  pushIfExists(join('assets', 'character-prompts.md'), 'character_prompts', 'text/markdown')
  pushIfExists(join('assets', 'scene-prompts.md'), 'scene_prompts', 'text/markdown')

  const scriptDir = join(projectPath, 'script')
  if (existsSync(scriptDir)) {
    for (const entry of readdirSync(scriptDir)) {
      const episodeNum = scanEpisodeNumberFromFileName(entry)
      if (!episodeNum) continue
      pushIfExists(join('script', entry), 'script_episode', 'text/markdown', { episodeNum })
    }
  }

  const outputsDir = join(projectPath, 'outputs')
  if (existsSync(outputsDir)) {
    for (const entry of readdirSync(outputsDir)) {
      const episodeNum = scanEpisodeNumberFromFileName(entry)
      if (!episodeNum) continue
      pushIfExists(join('outputs', entry, '01-director-analysis.md'), 'director_output', 'text/markdown', { episodeNum, stage: 'director' })
      pushIfExists(join('outputs', entry, '01.5-art-design-output.md'), 'art_output', 'text/markdown', { episodeNum, stage: 'art' })
      pushIfExists(join('outputs', entry, '02-seedance-prompts.md'), 'seedance_prompts', 'text/markdown', { episodeNum, stage: 'storyboard' })
    }
  }

  return candidates
}

export async function reconcileProjectArtifacts(projectPath: string): Promise<void> {
  const manifest = await readManifest(projectPath)
  const candidates = collectCanonicalArtifacts(projectPath)

  for (const candidate of candidates) {
    const absolutePath = join(projectPath, candidate.filePath)
    const content = await readFile(absolutePath, 'utf-8')
    const scopeKey = getArtifactScopeKey({
      kind: candidate.kind,
      episodeNum: candidate.episodeNum,
      filePath: candidate.filePath
    })
    const hash = computeHash(content)
    const hasCurrent = manifest.artifacts.some(
      (artifact) => artifact.scopeKey === scopeKey && artifact.isCurrent && artifact.hash === hash
    )

    if (!hasCurrent) {
      await upsertArtifactVersion({
        projectPath,
        kind: candidate.kind,
        filePath: absolutePath,
        content,
        contentType: candidate.contentType,
        label: candidate.label,
        episodeNum: candidate.episodeNum,
        stage: candidate.stage,
        createdBy: 'system',
        metadata: { imported: true }
      })
    }
  }
}

export async function writeArtifactText(params: ArtifactWriteParams): Promise<ArtifactRecord> {
  return upsertArtifactVersion(params)
}

export async function writeArtifactJson(params: Omit<ArtifactWriteParams, 'content' | 'contentType'> & {
  content: unknown
}): Promise<ArtifactRecord> {
  return upsertArtifactVersion({
    ...params,
    contentType: 'application/json',
    content: JSON.stringify(params.content, null, 2)
  })
}

export async function listArtifacts(query: ArtifactQuery): Promise<ArtifactRecord[]> {
  await reconcileProjectArtifacts(query.projectPath)
  const manifest = await readManifest(query.projectPath)
  return manifest.artifacts
    .filter((artifact) => query.kind ? artifact.kind === query.kind : true)
    .filter((artifact) => typeof query.episodeNum === 'number' ? artifact.episodeNum === query.episodeNum : true)
    .filter((artifact) => query.currentOnly ? artifact.isCurrent : true)
    .sort((a, b) => {
      if (a.scopeKey === b.scopeKey) {
        return b.version - a.version
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
}

export async function rollbackArtifact(params: ArtifactRollbackParams): Promise<ArtifactRecord> {
  await reconcileProjectArtifacts(params.projectPath)
  const manifest = await readManifest(params.projectPath)
  const target = manifest.artifacts.find((artifact) => artifact.id === params.artifactId)
  if (!target) {
    throw new Error(`artifact not found: ${params.artifactId}`)
  }

  const snapshotAbsolutePath = join(params.projectPath, target.snapshotPath)
  const restoredContent = await readFile(snapshotAbsolutePath, 'utf-8')
  return upsertArtifactVersion({
    projectPath: params.projectPath,
    kind: target.kind,
    filePath: join(params.projectPath, target.filePath),
    content: restoredContent,
    contentType: target.contentType,
    label: target.label,
    episodeNum: target.episodeNum,
    stage: target.stage,
    sourceRunId: target.sourceRunId,
    createdBy: 'rollback',
    metadata: {
      rollbackFromArtifactId: target.id,
      rollbackFromVersion: target.version
    }
  })
}

export async function exportArtifactsBundle(projectPath: string, exportDir: string): Promise<{
  manifestPath: string
  artifactCount: number
}> {
  await reconcileProjectArtifacts(projectPath)
  const currentArtifacts = await listArtifacts({
    projectPath,
    currentOnly: true
  })

  for (const artifact of currentArtifacts) {
    const sourcePath = join(projectPath, artifact.filePath)
    const targetPath = join(exportDir, artifact.filePath)
    await mkdir(dirname(targetPath), { recursive: true })
    await copyFile(sourcePath, targetPath)
  }

  const manifest = await readManifest(projectPath)
  const manifestTargetPath = join(exportDir, MANIFEST_PATH)
  await mkdir(dirname(manifestTargetPath), { recursive: true })
  await writeFile(manifestTargetPath, JSON.stringify(manifest, null, 2), 'utf-8')

  return {
    manifestPath: manifestTargetPath,
    artifactCount: currentArtifacts.length
  }
}
