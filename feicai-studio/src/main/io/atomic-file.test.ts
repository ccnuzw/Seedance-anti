import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  atomicCompareAndWriteFile,
  atomicCopyFile,
  atomicWriteFile,
  atomicWriteFileSync,
  FileConflictError,
  flushPendingWrites,
  readJsonWithRecovery
} from './atomic-file'

const directories: string[] = []
function temporary(): string {
  const directory = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'feicai-atomic-'))
  )
  directories.push(directory)
  return directory
}
afterEach(async () => {
  await flushPendingWrites()
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

describe('durable atomic file API', () => {
  it('新文件自动建立普通父目录，同一路径队列顺序写入且保留最近有效bak', async () => {
    const root = temporary()
    const path = join(root, 'new', 'state.json')
    const writes = [1, 2, 3].map((value) =>
      atomicWriteFile(path, JSON.stringify({ value }))
    )
    await flushPendingWrites()
    await Promise.all(writes)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ value: 3 })
    expect(JSON.parse(readFileSync(`${path}.bak`, 'utf8'))).toEqual({
      value: 2
    })
    expect(readdirSync(join(root, 'new')).sort()).toEqual([
      'state.json',
      'state.json.bak'
    ])
  })

  it('标准系统tmpdir路径可直接使用，macOS系统别名不会误伤普通新文件', async () => {
    const root = mkdtempSync(join(tmpdir(), 'feicai-native-temp-'))
    directories.push(root)
    const path = join(root, 'state.json')
    await atomicWriteFile(path, '{"value":1}')
    expect(await readJsonWithRecovery(path)).toEqual({ value: 1 })
    atomicWriteFileSync(path, '{"value":2}')
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ value: 2 })
  })

  it('同步写同样保留有效bak并拒绝覆盖尚未settle的异步写', async () => {
    const path = join(temporary(), 'state.json')
    atomicWriteFileSync(path, '{"value":1}')
    atomicWriteFileSync(path, '{"value":2}')
    expect(JSON.parse(readFileSync(`${path}.bak`, 'utf8'))).toEqual({
      value: 1
    })
    const writing = atomicWriteFile(path, '{"value":3}')
    expect(() => atomicWriteFileSync(path, '{"value":4}')).toThrow('异步写入')
    await writing
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ value: 3 })
  })

  it('比较与提交在同一写入队列内，冲突不丢外部文件', async () => {
    const path = join(temporary(), 'draft.md')
    await atomicCompareAndWriteFile(path, 'first', null)
    const first = atomicCompareAndWriteFile(path, 'second', 'first')
    const conflict = atomicCompareAndWriteFile(path, 'stale', 'first')
    await expect(conflict).rejects.toBeInstanceOf(FileConflictError)
    await first
    expect(readFileSync(path, 'utf8')).toBe('second')
    await expect(atomicCompareAndWriteFile(path, 'new', null)).rejects.toThrow(
      'FILE_CONFLICT'
    )
  })

  it('损坏主文件从bak告警并恢复，不用损坏正文覆盖有效bak', async () => {
    const path = join(temporary(), 'state.json')
    await atomicWriteFile(path, '{"version":1}')
    await atomicWriteFile(path, '{"version":2}')
    writeFileSync(path, '{broken')
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined)
    expect(await readJsonWithRecovery(path)).toEqual({ version: 1 })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ version: 1 })
    expect(JSON.parse(readFileSync(`${path}.bak`, 'utf8'))).toEqual({
      version: 1
    })
    expect(warning).toHaveBeenCalled()
  })

  it('恢复读取排在已排队写入后，不用旧bak覆盖刚提交的新状态', async () => {
    const path = join(temporary(), 'state.json')
    await atomicWriteFile(path, '{"version":1}')
    await atomicWriteFile(path, '{"version":2}')
    writeFileSync(path, '{broken')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const writing = atomicWriteFile(path, '{"version":3}')
    const reading = readJsonWithRecovery(path)
    await writing
    expect(await reading).toEqual({ version: 3 })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ version: 3 })
  })

  it.each(['valid', 'missing', 'broken'])(
    '只读恢复在主文件 %s 时不创建或更改文件',
    async (primary) => {
      const root = temporary()
      const path = join(root, 'state.json')
      const original = primary === 'valid' ? '{"version":2}' : '{broken'
      if (primary !== 'missing') writeFileSync(path, original)
      writeFileSync(`${path}.bak`, '{"version":1}')
      const entries = readdirSync(root).sort()
      expect(await readJsonWithRecovery(path, { readOnly: true })).toEqual({
        version: primary === 'valid' ? 2 : 1
      })
      expect(readdirSync(root).sort()).toEqual(entries)
      expect(existsSync(path)).toBe(primary !== 'missing')
      if (primary !== 'missing')
        expect(readFileSync(path, 'utf8')).toBe(original)
      expect(readFileSync(`${path}.bak`, 'utf8')).toBe('{"version":1}')
    }
  )

  it('只读恢复不会创建父目录，双损坏仍抛错且保留字节', async () => {
    const root = temporary()
    expect(
      await readJsonWithRecovery(join(root, 'absent', 'state.json'), {
        readOnly: true
      })
    ).toBeNull()
    expect(readdirSync(root)).toEqual([])
    const path = join(root, 'state.json')
    writeFileSync(path, '{broken')
    writeFileSync(`${path}.bak`, 'broken-backup')
    await expect(
      readJsonWithRecovery(path, { readOnly: true })
    ).rejects.toThrow('均已损坏')
    expect(readFileSync(path, 'utf8')).toBe('{broken')
    expect(readFileSync(`${path}.bak`, 'utf8')).toBe('broken-backup')
    expect(readdirSync(root).sort()).toEqual(['state.json', 'state.json.bak'])
  })

  it('主文件与备份都损坏会抛错，真正缺失返回null', async () => {
    const root = temporary()
    expect(await readJsonWithRecovery(join(root, 'missing.json'))).toBeNull()
    const path = join(root, 'broken.json')
    writeFileSync(path, '{broken')
    writeFileSync(`${path}.bak`, 'not-json')
    await expect(readJsonWithRecovery(path)).rejects.toThrow('均已损坏')
  })

  it('有效/悬空最终链接、父目录链接和bak链接都不能被写入或复制', async () => {
    const root = temporary()
    const outside = temporary()
    const secret = join(outside, 'secret.md')
    writeFileSync(secret, 'secret')
    const source = join(root, 'source.md')
    writeFileSync(source, 'new')
    for (const [name, target] of [
      ['valid.md', secret],
      ['dangling.md', join(outside, 'missing.md')]
    ]) {
      const path = join(root, name)
      symlinkSync(target, path)
      await expect(
        Promise.resolve().then(() => atomicWriteFile(path, 'overwrite'))
      ).rejects.toThrow('符号链接')
      await expect(
        Promise.resolve().then(() => atomicCopyFile(source, path))
      ).rejects.toThrow('符号链接')
    }
    symlinkSync(outside, join(root, 'parent'))
    await expect(
      Promise.resolve().then(() =>
        atomicWriteFile(join(root, 'parent', 'new.md'), 'escape')
      )
    ).rejects.toThrow('符号链接')
    const path = join(root, 'ordinary.md')
    writeFileSync(path, 'original')
    symlinkSync(secret, `${path}.bak`)
    await expect(atomicWriteFile(path, 'changed')).rejects.toThrow('符号链接')
    expect(readFileSync(path, 'utf8')).toBe('original')
    expect(readFileSync(secret, 'utf8')).toBe('secret')
    expect(existsSync(join(outside, 'missing.md'))).toBe(false)
  })
})
