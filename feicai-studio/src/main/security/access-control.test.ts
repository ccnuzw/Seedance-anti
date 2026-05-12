import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  assertProjectFileReadAllowed,
  assertRegisteredProjectRoot,
  assertTrustedProjectSelection,
  assertProjectFileWriteAllowed,
  registerProjectRoot,
  rememberSelectedDirectory,
  rememberSelectedFile
} from './access-control'

describe('access-control', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('写入不存在文件时也会解析最近存在祖先目录的真实路径', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'feicai-security-project-'))
    const externalRoot = mkdtempSync(
      join(tmpdir(), 'feicai-security-external-')
    )
    tempDirs.push(projectRoot, externalRoot)

    mkdirSync(join(projectRoot, 'nested'), { recursive: true })
    symlinkSync(externalRoot, join(projectRoot, 'linked'))
    registerProjectRoot(projectRoot)

    const nestedDirRealPath = realpathSync.native(join(projectRoot, 'nested'))

    expect(
      assertProjectFileWriteAllowed(join(projectRoot, 'nested', 'draft.md'))
    ).toBe(join(nestedDirRealPath, 'draft.md'))

    expect(() =>
      assertProjectFileWriteAllowed(join(projectRoot, 'linked', 'escape.md'))
    ).toThrow('未授权写入该文件')
  })

  it('受信目录和受信文件允许读取，但不自动允许写入', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'feicai-security-read-'))
    const looseDir = mkdtempSync(join(tmpdir(), 'feicai-security-loose-'))
    const looseFile = join(looseDir, 'notes.md')
    tempDirs.push(projectRoot, looseDir)

    mkdirSync(join(projectRoot, 'source'), { recursive: true })
    mkdirSync(join(looseDir, 'nested'), { recursive: true })
    mkdirSync(join(projectRoot, 'script'), { recursive: true })

    rememberSelectedDirectory(looseDir)
    rememberSelectedFile(looseFile)
    registerProjectRoot(projectRoot)

    expect(assertTrustedProjectSelection(looseDir)).toBe(
      realpathSync.native(looseDir)
    )
    expect(
      assertProjectFileReadAllowed(join(looseDir, 'nested', 'draft.md'))
    ).toBe(join(realpathSync.native(looseDir), 'nested', 'draft.md'))
    expect(assertProjectFileReadAllowed(looseFile)).toBe(
      join(realpathSync.native(looseDir), 'notes.md')
    )
    expect(
      assertProjectFileReadAllowed(join(projectRoot, 'source', 'novel.md'))
    ).toBe(join(realpathSync.native(projectRoot), 'source', 'novel.md'))

    expect(() =>
      assertProjectFileWriteAllowed(join(looseDir, 'nested', 'draft.md'))
    ).toThrow('未授权写入该文件')
  })

  it('未登记的目录和文件会被拒绝', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'feicai-security-root-'))
    const otherDir = mkdtempSync(join(tmpdir(), 'feicai-security-other-'))
    tempDirs.push(projectRoot, otherDir)

    registerProjectRoot(projectRoot)

    expect(assertRegisteredProjectRoot(projectRoot)).toBe(
      realpathSync.native(projectRoot)
    )
    expect(() => assertRegisteredProjectRoot(otherDir)).toThrow(
      '未授权访问该项目目录'
    )
    expect(() => assertTrustedProjectSelection(otherDir)).toThrow(
      '该目录不是当前会话中经用户选择的项目目录'
    )
    expect(() =>
      assertProjectFileReadAllowed(join(otherDir, 'orphan.md'))
    ).toThrow('未授权读取该文件')
  })
})
