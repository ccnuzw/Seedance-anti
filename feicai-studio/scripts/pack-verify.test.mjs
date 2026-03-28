import { describe, expect, it } from 'vitest'
import {
  buildPackVerifyMarkdownReport,
  collectPackTargets,
  evaluatePackVerify
} from './pack-verify.mjs'

describe('pack-verify', () => {
  it('collects unpacked app targets from packed files', () => {
    const targets = collectPackTargets([
      'mac/FEICAI Studio.app/Contents/MacOS/FEICAI Studio',
      'mac/FEICAI Studio.app/Contents/Resources/app.asar',
      'win-unpacked/FEICAI Studio.exe'
    ])

    expect(targets).toEqual([
      {
        executablePath: 'mac/FEICAI Studio.app/Contents/MacOS/FEICAI Studio',
        platform: 'mac',
        rootPath: 'mac/FEICAI Studio.app'
      },
      {
        executablePath: 'win-unpacked/FEICAI Studio.exe',
        platform: 'win',
        rootPath: 'win-unpacked'
      }
    ])
  })

  it('passes when app bundle contains asar, builtin skills, and sqlite binding', () => {
    const files = [
      'mac/FEICAI Studio.app/Contents/MacOS/FEICAI Studio',
      'mac/FEICAI Studio.app/Contents/Resources/app.asar',
      'mac/FEICAI Studio.app/Contents/Resources/builtin-skills/director-skill/SKILL.md',
      'mac/FEICAI Studio.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
    ]
    const sizeMap = new Map(files.map((filePath) => [filePath, 1024]))

    const result = evaluatePackVerify({
      files,
      sizeMap
    })

    expect(result.issues).toEqual([])
    expect(result.targets[0]?.skillFiles).toHaveLength(1)
    expect(result.targets[0]?.nativeBindingFiles).toHaveLength(1)
  })

  it('flags blocking issues when key packaged resources are missing', () => {
    const files = [
      'mac/FEICAI Studio.app/Contents/MacOS/FEICAI Studio'
    ]

    const result = evaluatePackVerify({
      files,
      sizeMap: new Map(files.map((filePath) => [filePath, 1024])),
      nativeDependencyWarning: 'better-sqlite3 当前仅验证了 Node ABI 127'
    })

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('app.asar'),
      expect.stringContaining('builtin-skills'),
      expect.stringContaining('better-sqlite3')
    ]))
    expect(result.warnings).toEqual([expect.stringContaining('Node ABI 127')])
  })

  it('renders markdown report with target summary', () => {
    const output = buildPackVerifyMarkdownReport({
      generatedAt: '2026-03-24T04:00:00.000Z',
      targets: [{
        platform: 'mac',
        rootPath: 'mac/FEICAI Studio.app',
        executablePath: 'mac/FEICAI Studio.app/Contents/MacOS/FEICAI Studio',
        hasAppAsar: true,
        skillFiles: ['mac/FEICAI Studio.app/Contents/Resources/builtin-skills/director-skill/SKILL.md'],
        nativeBindingFiles: ['mac/FEICAI Studio.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node'],
        targetSizeBytes: 4 * 1024 * 1024
      }],
      issues: [],
      warnings: ['native warning']
    })

    expect(output).toContain('# 打包验收报告')
    expect(output).toContain('## 目录包目标')
    expect(output).toContain('- app.asar：存在')
    expect(output).toContain('- 内置技能：1')
    expect(output).toContain('- better-sqlite3 原生绑定：1')
    expect(output).toContain('## 警告')
  })
})
