import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { detectProjectDirectory } from './project-detector'

describe('project-detector', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('可以识别旧版 scripts 目录并推断脚本起步项目', () => {
    const root = mkdtempSync(join(tmpdir(), 'feicai-detector-'))
    tempDirs.push(root)

    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(
      join(root, 'project-config.json'),
      JSON.stringify(
        {
          projectName: '旧项目',
          totalEpisodes: 30,
          visualStyle: '电影感',
          targetMedium: '短剧'
        },
        null,
        2
      ),
      'utf-8'
    )
    writeFileSync(join(root, 'scripts', 'ep01.md'), '# 第1集', 'utf-8')

    const info = detectProjectDirectory(root)

    expect(info.suggestedConfig?.entryStage).toBe('script')
    expect(info.suggestedConfig?.directories?.scriptDir).toBe('scripts')
    expect(
      info.integrity?.checks.find((check) => check.id === 'script_dir')?.status
    ).toBe('pass')
    expect(
      info.integrity?.checks.find((check) => check.id === 'script_dir')?.group
    ).toBe('legacy')
    expect(info.integrity?.detectedEpisodes).toBe(1)
  })

  it('可以识别标准 script 目录并推断脚本起步项目', () => {
    const root = mkdtempSync(join(tmpdir(), 'feicai-detector-'))
    tempDirs.push(root)

    mkdirSync(join(root, 'script'), { recursive: true })
    writeFileSync(join(root, 'script', 'ep01.md'), '# 第1集', 'utf-8')

    const info = detectProjectDirectory(root)

    expect(info.suggestedConfig?.entryStage).toBe('script')
    expect(info.suggestedConfig?.workflowMode).toBe('script_to_shortdrama')
    expect(info.suggestedConfig?.directories?.scriptDir).toBe('script')
    expect(
      info.integrity?.checks.find((check) => check.id === 'script_dir')?.group
    ).toBe('directories')
  })

  it('会在完整性报告中提示旧版 novel 章节目录', () => {
    const root = mkdtempSync(join(tmpdir(), 'feicai-detector-'))
    tempDirs.push(root)

    mkdirSync(join(root, 'novel'), { recursive: true })
    writeFileSync(
      join(root, 'project-config.json'),
      JSON.stringify(
        {
          projectName: '旧小说项目',
          totalEpisodes: 12
        },
        null,
        2
      ),
      'utf-8'
    )
    writeFileSync(join(root, 'novel', 'chapter-0001.txt'), '第一章', 'utf-8')

    const info = detectProjectDirectory(root)
    const sourceCheck = info.integrity?.checks.find(
      (check) => check.id === 'source_novel'
    )

    expect(sourceCheck?.status).toBe('warn')
    expect(sourceCheck?.group).toBe('legacy')
    expect(sourceCheck?.detail).toContain('发现旧版小说目录 novel/')
    expect(sourceCheck?.path).toBe(join(root, 'novel'))
    expect(
      info.integrity?.recommendedActions?.map((action) => action.id)
    ).toContain('migrate_legacy_novel')
    expect(
      info.integrity?.recommendedActions?.map((action) => action.id)
    ).toContain('create_missing_directories')
  })

  it('标准项目会把配置与内容检查分到对应分组', () => {
    const root = mkdtempSync(join(tmpdir(), 'feicai-detector-'))
    tempDirs.push(root)

    mkdirSync(join(root, 'source'), { recursive: true })
    mkdirSync(join(root, 'story', 'episode-beats'), { recursive: true })
    mkdirSync(join(root, 'script'), { recursive: true })
    writeFileSync(
      join(root, 'project-config.json'),
      JSON.stringify(
        {
          projectName: '标准项目',
          totalEpisodes: 1,
          entryStage: 'novel',
          workflowMode: 'novel_to_shortdrama'
        },
        null,
        2
      ),
      'utf-8'
    )
    writeFileSync(join(root, 'source', 'novel.md'), '# 原文', 'utf-8')
    writeFileSync(
      join(root, 'story', 'episode-beats', 'ep01.md'),
      '# 拆解',
      'utf-8'
    )
    writeFileSync(join(root, 'script', 'ep01.md'), '# 剧本', 'utf-8')

    const info = detectProjectDirectory(root)

    expect(
      info.integrity?.checks.find((check) => check.id === 'config')?.group
    ).toBe('config')
    expect(
      info.integrity?.checks.find((check) => check.id === 'source_novel')?.group
    ).toBe('content')
    expect(
      info.integrity?.checks.find((check) => check.id === 'outputs_dir')?.group
    ).toBe('directories')
  })
})
