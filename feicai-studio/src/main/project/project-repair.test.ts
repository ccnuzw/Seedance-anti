import { afterEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { repairProjectIssues } from './project-repair'

describe('project-repair', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('dry-run 会返回预览清单但不会创建模板文件', async () => {
    const root = mkdtempSync(join(tmpdir(), 'feicai-repair-'))
    tempDirs.push(root)

    writeFileSync(
      join(root, 'project-config.json'),
      JSON.stringify(
        {
          projectName: '预览项目',
          totalEpisodes: 6,
          entryStage: 'novel',
          workflowMode: 'novel_to_shortdrama'
        },
        null,
        2
      ),
      'utf-8'
    )

    const result = await repairProjectIssues({
      projectPath: root,
      actionIds: ['create_missing_templates'],
      trustMode: 'registered',
      dryRun: true
    })

    expect(result.dryRun).toBe(true)
    expect(result.appliedActions).toEqual([])
    expect(
      result.plannedChanges.some((change) => change.includes('生成模板:'))
    ).toBe(true)
    expect(existsSync(join(root, 'source', 'novel.md'))).toBe(false)
  })

  it('执行模板补全后会创建标准文件并更新就绪清单', async () => {
    const root = mkdtempSync(join(tmpdir(), 'feicai-repair-'))
    tempDirs.push(root)

    writeFileSync(
      join(root, 'project-config.json'),
      JSON.stringify(
        {
          projectName: '补全项目',
          totalEpisodes: 6,
          entryStage: 'novel',
          workflowMode: 'novel_to_shortdrama'
        },
        null,
        2
      ),
      'utf-8'
    )

    const result = await repairProjectIssues({
      projectPath: root,
      actionIds: ['create_missing_templates'],
      trustMode: 'registered'
    })

    expect(result.appliedActions).toEqual(['create_missing_templates'])
    expect(existsSync(join(root, 'source', 'novel.md'))).toBe(true)
    expect(readFileSync(join(root, 'source', 'novel.md'), 'utf-8')).toContain(
      '> 项目：补全项目'
    )
    expect(
      result.readyItems.find((item) => item.label === '小说原文')?.exists
    ).toBe(true)
  })
})
