import { createHash } from 'crypto'
import { lstatSync, readFileSync, readdirSync } from 'fs'
import { join, relative, sep } from 'path'
import type { ProductionCommitRecord } from '@shared/production-commit'
import type { ProjectConfig } from '@shared/types'
import { resolveProjectLayout } from '@shared/path-resolver'
import {
  decodeProductionManifestUpdate,
  getProductionPaths,
  isProductionRelativePath
} from '@shared/production-contracts'
import {
  assertPathWithinProject,
  isMissingFileError
} from '../security/access-control'
import {
  assertNoLinkedPath,
  atomicCompareAndWriteFile,
  FileConflictError
} from './atomic-file'

export interface CommitWrite {
  path: string
  content: string
  expected: string | null
}
export type CommitFault = (
  point: string,
  record: ProductionCommitRecord
) => void
export function commitHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}
export function readCommitText(path: string): string | null {
  const target = assertNoLinkedPath(path)
  try {
    if (!lstatSync(target).isFile()) throw new Error('提交仅支持普通文件')
    return readFileSync(target, 'utf8')
  } catch (error) {
    if (isMissingFileError(error)) return null
    throw error
  }
}
function hashText(content: string | null): string | null {
  return content === null ? null : commitHash(content)
}

/** Recoverable forward installation, not a multi-file visibility transaction.
 * Callers retain their existing execution/maintenance lease for the entire call.
 * Journal corruption is never repaired from .bak: a backup may predate installation.
 */
export class ProductionCommitStore {
  readonly directory: string
  private readonly manifest: string
  constructor(
    readonly projectPath: string,
    private readonly config?: Partial<ProjectConfig> | null,
    private readonly fault?: CommitFault
  ) {
    this.projectPath = assertNoLinkedPath(
      assertPathWithinProject(projectPath, projectPath)
    )
    const paths = getProductionPaths(resolveProjectLayout(config))
    this.directory = this.checked(paths.operations)
    this.manifest = paths.manifest
  }
  private checked(path: string): string {
    if (!isProductionRelativePath(path)) throw new Error('提交路径无效')
    return assertNoLinkedPath(
      assertPathWithinProject(this.projectPath, join(this.projectPath, path))
    )
  }
  private journalPath(operationId: string, key: string): string {
    return this.checked(
      `${getProductionPaths(resolveProjectLayout(this.config)).operations}/${commitHash(JSON.stringify([operationId, key]))}.json`
    )
  }
  private validate(input: unknown): ProductionCommitRecord {
    const r = input as ProductionCommitRecord
    const hash = (v: unknown) =>
      typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
    if (
      !r ||
      r.schemaVersion !== 1 ||
      typeof r.operationId !== 'string' ||
      !r.operationId ||
      typeof r.key !== 'string' ||
      !r.key ||
      !hash(r.inputHash) ||
      !['intent', 'prepared', 'committed'].includes(r.phase) ||
      (r.kind !== undefined &&
        !['production', 'project-settings'].includes(r.kind)) ||
      typeof r.projected !== 'boolean' ||
      !Array.isArray(r.files) ||
      !Array.isArray(r.episodeNumbers) ||
      r.episodeNumbers.some((n) => !Number.isSafeInteger(n) || n < 1) ||
      (r.phase === 'intent' && (r.files.length || r.projected)) ||
      (r.phase !== 'committed' && r.projected)
    )
      throw new Error('未知或损坏的生产提交日志，禁止写入')
    if (r.kind === 'project-settings') {
      const result = r.result as Record<string, unknown>
      if (
        !result ||
        typeof result.id !== 'string' ||
        typeof result.name !== 'string' ||
        typeof result.visualStyle !== 'string' ||
        typeof result.targetMedium !== 'string' ||
        typeof result.totalEpisodes !== 'number' ||
        typeof result.configJson !== 'string' ||
        typeof result.updatedAt !== 'string'
      )
        throw new Error('项目设置提交投影内容损坏')
    }
    const targets = new Set<string>()
    for (const file of r.files) {
      if (
        !file ||
        !isProductionRelativePath(file.path) ||
        (file.oldHash !== null && !hash(file.oldHash)) ||
        !hash(file.newHash) ||
        typeof file.content !== 'string' ||
        commitHash(file.content) !== file.newHash
      )
        throw new Error('生产提交准备内容损坏')
      if (file.path === this.manifest) {
        const manifest = JSON.parse(file.content)
        const decoded = decodeProductionManifestUpdate(manifest, manifest, {
          layout: resolveProjectLayout(this.config)
        })
        if (!decoded.ok)
          throw new Error('生产manifest拒写：准备日志包含未知或损坏的manifest')
      }
      const path = this.checked(file.path)
      if (
        path === this.directory ||
        path.startsWith(`${this.directory}${sep}`) ||
        targets.has(path.normalize('NFC').toLowerCase())
      )
        throw new Error('提交写集路径重复或覆盖日志')
      targets.add(path.normalize('NFC').toLowerCase())
    }
    for (const guard of r.guards ?? []) {
      if (
        !guard ||
        !isProductionRelativePath(guard.path) ||
        (guard.hash !== null && !hash(guard.hash))
      )
        throw new Error('生产提交输入保护损坏')
      this.checked(guard.path)
    }
    return r
  }
  list(): ProductionCommitRecord[] {
    assertNoLinkedPath(this.directory)
    let entries: string[]
    try {
      entries = readdirSync(this.directory)
    } catch (error) {
      if (isMissingFileError(error)) return []
      throw error
    }
    return entries
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => {
        const path = join(this.directory, name)
        const r = this.validate(JSON.parse(readCommitText(path)!))
        if (path !== this.journalPath(r.operationId, r.key))
          throw new Error('提交日志身份与路径不匹配')
        return r
      })
  }
  get(operationId: string, key: string): ProductionCommitRecord | null {
    const text = readCommitText(this.journalPath(operationId, key))
    if (text === null) return null
    const record = this.validate(JSON.parse(text))
    if (record.operationId !== operationId || record.key !== key)
      throw new Error('提交日志身份与路径不匹配')
    return record
  }
  private async save(
    r: ProductionCommitRecord,
    previous: ProductionCommitRecord | null
  ): Promise<void> {
    this.validate(r)
    const path = this.journalPath(r.operationId, r.key)
    await atomicCompareAndWriteFile(
      path,
      JSON.stringify(r, null, 2),
      previous === null ? null : JSON.stringify(previous, null, 2)
    )
  }
  async intent(
    operationId: string,
    key: string,
    inputHash: string,
    episodeNumbers: number[],
    guardPaths: string[] = [],
    kind: 'production' | 'project-settings' = 'production',
    result?: unknown
  ): Promise<ProductionCommitRecord> {
    const existing = this.get(operationId, key)
    if (existing) {
      if (
        existing.inputHash !== inputHash ||
        JSON.stringify(existing.episodeNumbers) !==
          JSON.stringify(episodeNumbers)
      )
        throw new Error('operationId 已用于不同输入，禁止复用提交收据')
      return existing
    }
    const guards = guardPaths.map((path) => ({
      path: relative(
        this.projectPath,
        assertNoLinkedPath(assertPathWithinProject(this.projectPath, path))
      )
        .split(sep)
        .join('/'),
      hash: hashText(readCommitText(path))
    }))
    const r: ProductionCommitRecord = {
      schemaVersion: 1,
      operationId,
      key,
      inputHash,
      guards,
      phase: 'intent',
      kind,
      files: [],
      episodeNumbers,
      result,
      projected: false
    }
    await this.save(r, null)
    this.fault?.('intent', r)
    return r
  }
  assertGuards(r: ProductionCommitRecord): void {
    for (const guard of r.guards ?? []) {
      if (hashText(readCommitText(this.checked(guard.path))) !== guard.hash)
        throw new FileConflictError()
    }
  }
  async prepare(
    r: ProductionCommitRecord,
    writes: CommitWrite[],
    result?: unknown
  ): Promise<ProductionCommitRecord> {
    if (r.phase !== 'intent') throw new Error('提交已准备，不能替换载荷')
    this.assertGuards(r)
    const files = writes.map((w) => {
      const path = assertNoLinkedPath(
        assertPathWithinProject(this.projectPath, w.path)
      )
      const portable = relative(this.projectPath, path).split(sep).join('/')
      if (portable === this.manifest) {
        const next = JSON.parse(w.content)
        // Creating a first manifest validates against its empty history too.
        const previous =
          w.expected === null
            ? {
                ...next,
                scriptRevisions: [],
                scenes: [],
                shots: [],
                assets: [],
                assetRevisions: [],
                appearances: [],
                promptRevisions: [],
                media: [],
                candidates: [],
                bindings: [],
                reviews: [],
                adoptions: [],
                currentAdoptionIds: [],
                cuts: []
              }
            : JSON.parse(w.expected)
        const decoded = decodeProductionManifestUpdate(previous, next, {
          layout: resolveProjectLayout(this.config)
        })
        if (!decoded.ok)
          throw new Error(`生产manifest拒写: ${JSON.stringify(decoded.issues)}`)
      }
      if (readCommitText(path) !== w.expected) throw new FileConflictError()
      return {
        path: portable,
        oldHash: hashText(w.expected),
        newHash: commitHash(w.content),
        content: w.content
      }
    })
    const prepared = {
      ...r,
      phase: 'prepared' as const,
      files,
      result: result === undefined ? r.result : result
    }
    this.validate(prepared)
    await this.save(prepared, r)
    this.fault?.('prepared', prepared)
    return prepared
  }
  async install(r: ProductionCommitRecord): Promise<ProductionCommitRecord> {
    this.validate(r)
    if (r.phase !== 'prepared') return r
    // Validate the ENTIRE set before making any further change, including already installed members.
    const verify = () => {
      // A prepared payload is authoritative only while we still own these exact
      // journal bytes. Check before the first artifact and every later step.
      if (
        readCommitText(this.journalPath(r.operationId, r.key)) !==
        JSON.stringify(r, null, 2)
      )
        throw new FileConflictError()
      for (const guard of r.guards ?? []) {
        const current = hashText(readCommitText(this.checked(guard.path)))
        const installed = r.files.find((file) => file.path === guard.path)
        if (
          current !== guard.hash &&
          (!installed || current !== installed.newHash)
        )
          throw new FileConflictError()
      }
      for (const file of r.files) {
        const current = hashText(readCommitText(this.checked(file.path)))
        if (current !== file.oldHash && current !== file.newHash)
          throw new FileConflictError()
      }
    }
    verify()
    for (const [index, file] of r.files.entries()) {
      verify()
      const path = this.checked(file.path)
      const current = readCommitText(path)
      if (hashText(current) !== file.newHash)
        await atomicCompareAndWriteFile(path, file.content, current)
      this.fault?.(`installed:${index}`, r)
    }
    verify()
    const committed = { ...r, phase: 'committed' as const }
    await this.save(committed, r)
    this.fault?.('committed', committed)
    return committed
  }
  async recover(
    project?: (
      episodes: number[],
      record: ProductionCommitRecord
    ) => Promise<void>
  ): Promise<void> {
    for (let record of this.list()) {
      if (record.kind === 'project-settings' && !project)
        throw new Error('项目设置提交必须由受控项目恢复入口投影')
      if (record.phase === 'prepared') record = await this.install(record)
      if (record.phase === 'committed' && !record.projected) {
        if (!project && record.kind === 'project-settings')
          throw new Error('项目设置提交必须由受控项目恢复入口投影')
        if (!project) continue
        await project(record.episodeNumbers, record)
        this.fault?.('projection', record)
        await this.save({ ...record, projected: true }, record)
        this.fault?.('receipt', record)
      }
    }
  }
}

/** Read-only gate: partially installed or unrecognised logs never grant PASS. */
export function hasUncommittedProductionWrites(
  projectPath: string,
  config?: Partial<ProjectConfig> | null
): boolean {
  try {
    return new ProductionCommitStore(projectPath, config)
      .list()
      .some((r) => r.phase === 'prepared')
  } catch {
    return true
  }
}
export function assertNoPreparedProductionWrites(
  projectPath: string,
  config?: Partial<ProjectConfig> | null
): void {
  if (hasUncommittedProductionWrites(projectPath, config))
    throw new Error('存在未完成或损坏的生产提交，请在受控制作入口恢复后重试')
}
