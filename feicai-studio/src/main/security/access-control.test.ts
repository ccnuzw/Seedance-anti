import { afterEach, describe, expect, it } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  assertEpisodeNumber,
  assertPathWithinProject,
  assertProjectFileReadAllowed,
  assertProjectFileWriteAllowed,
  assertRegisteredProjectRoot,
  assertSelectedFileAllowed,
  assertTrustedProjectSelection,
  registerProjectRoot,
  refreshRegisteredProjectRoots,
  rememberSelectedDirectory,
  rememberSelectedFile,
  resetAccessControl
} from './access-control'

const directories: string[] = []
function temporary(): string {
  const directory = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'feicai-security-'))
  )
  directories.push(directory)
  return directory
}

afterEach(() => {
  resetAccessControl()
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

describe('项目最终路径边界', () => {
  it('允许根内普通新文件及尚不存在的父目录', () => {
    const root = temporary()
    registerProjectRoot(root)
    const file = join(root, 'new', 'nested', 'draft.md')
    expect(assertPathWithinProject(root, file)).toBe(file)
    expect(assertProjectFileWriteAllowed(file)).toBe(file)
    expect(assertProjectFileReadAllowed(file)).toBe(file)
  })

  it('拒绝根内有效外链、有效内链和悬空最终链接', () => {
    const root = temporary()
    const outside = temporary()
    writeFileSync(join(outside, 'private.md'), 'secret')
    writeFileSync(join(root, 'real.md'), 'real')
    registerProjectRoot(root)
    for (const [name, target] of [
      ['external.md', join(outside, 'private.md')],
      ['internal.md', join(root, 'real.md')],
      ['dangling.md', join(outside, 'missing.md')]
    ]) {
      const link = join(root, name)
      symlinkSync(target, link)
      expect(() => assertPathWithinProject(root, link)).toThrow('符号链接')
      expect(() => assertProjectFileReadAllowed(link)).toThrow()
      expect(() => assertProjectFileWriteAllowed(link)).toThrow()
    }
  })

  it('拒绝父目录链接，即使最终文件/多层目录尚不存在', () => {
    const root = temporary()
    const outside = temporary()
    symlinkSync(outside, join(root, 'linked'))
    symlinkSync(join(outside, 'missing'), join(root, 'dangling-parent'))
    for (const name of ['linked', 'dangling-parent']) {
      expect(() =>
        assertPathWithinProject(root, join(root, name, 'new', 'file.md'))
      ).toThrow('符号链接')
    }
    expect(() =>
      assertPathWithinProject(
        join(root, 'linked'),
        join(root, 'linked', 'file.md')
      )
    ).toThrow('符号链接')
  })

  it('拒绝穿越和相邻前缀，允许合法以两点开头的文件名', () => {
    const root = temporary()
    expect(() =>
      assertPathWithinProject(root, join(root, '..', 'escape.md'))
    ).toThrow('项目目录')
    expect(() =>
      assertPathWithinProject(root, `${root}-other/file.md`)
    ).toThrow('项目目录')
    expect(assertPathWithinProject(root, join(root, '..notes.md'))).toBe(
      join(root, '..notes.md')
    )
  })
})

describe('原生选择最小授权', () => {
  it('选定目录只允许该目录作为项目，既不允许任意读取也不自动授权子项目', () => {
    const root = temporary()
    mkdirSync(join(root, 'nested'))
    writeFileSync(join(root, 'private.md'), 'private')
    rememberSelectedDirectory(root)
    expect(assertTrustedProjectSelection(root)).toBe(root)
    expect(() => assertTrustedProjectSelection(join(root, 'nested'))).toThrow()
    expect(() =>
      assertProjectFileReadAllowed(join(root, 'private.md'))
    ).toThrow('未授权读取')
    expect(() =>
      assertProjectFileWriteAllowed(join(root, 'private.md'))
    ).toThrow('未授权写入')
  })

  it('选定文件只授权真实单个文件读取，不授权同目录其他文件或写入', () => {
    const root = temporary()
    const selected = join(root, 'chosen.md')
    writeFileSync(selected, 'chosen')
    writeFileSync(join(root, 'sibling.md'), 'sibling')
    rememberSelectedFile(selected)
    expect(assertSelectedFileAllowed(selected)).toBe(selected)
    expect(assertProjectFileReadAllowed(selected)).toBe(selected)
    expect(() =>
      assertProjectFileReadAllowed(join(root, 'sibling.md'))
    ).toThrow()
    expect(() => assertProjectFileWriteAllowed(selected)).toThrow()
    const link = join(root, 'link.md')
    symlinkSync(selected, link)
    expect(() => rememberSelectedFile(link)).toThrow('普通文件')
  })

  it('重建/清空capabilities立即撤销旧项目和文件权限', () => {
    const first = temporary()
    const second = temporary()
    registerProjectRoot(first)
    refreshRegisteredProjectRoots([second])
    expect(() => assertRegisteredProjectRoot(first)).toThrow()
    expect(assertRegisteredProjectRoot(second)).toBe(second)
    resetAccessControl()
    expect(() =>
      assertProjectFileWriteAllowed(join(second, 'draft.md'))
    ).toThrow()
  })

  it.each([0, -1, 1.5, 10001, NaN, Infinity, '1', null, undefined])(
    '拒绝无效集数 %s',
    (value) => {
      expect(() => assertEpisodeNumber(value)).toThrow()
    }
  )
})
