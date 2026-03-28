import { describe, expect, it } from 'vitest'
import {
  buildReleasePreflightReport,
  collectRuntimeDependencies,
  evaluateReleasePreflight,
  extractRendererAssetRefs
} from './release-preflight.mjs'

describe('release-preflight', () => {
  it('collects external runtime dependencies from the main bundle', () => {
    const dependencies = collectRuntimeDependencies(`
      const electron = require("electron");
      const Database = require("better-sqlite3");
      const OpenAI = require("openai");
      const fs = require("fs");
      const local = require("./local");
    `)

    expect(dependencies).toEqual(['better-sqlite3', 'openai'])
  })

  it('extracts relative asset refs from renderer html', () => {
    const refs = extractRendererAssetRefs(`
      <link rel="stylesheet" href="./assets/index.css">
      <script type="module" src="./assets/index.js"></script>
    `)

    expect(refs).toEqual(['assets/index.css', 'assets/index.js'])
  })

  it('flags missing package metadata and node_modules coverage for runtime deps', () => {
    const result = evaluateReleasePreflight({
      mainEntryExists: true,
      preloadEntryExists: true,
      rendererEntryExists: true,
      mainBundleSource: 'const Database = require("better-sqlite3");',
      indexHtmlSource: '<script src="./assets/index.js"></script>',
      builderConfigSource: 'files:\n  - out/**/*\n',
      assetFiles: ['assets/index.js'],
      assetSizes: [{ path: 'assets/index.js', sizeBytes: 1024 }],
      buildResourceFiles: [],
      skillFiles: ['director-skill/SKILL.md']
    })

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('package.json'),
      expect.stringContaining('node_modules/**/*')
    ]))
  })

  it('returns warnings for oversized assets and native binding issues', () => {
    const result = evaluateReleasePreflight({
      mainEntryExists: true,
      preloadEntryExists: true,
      rendererEntryExists: true,
      mainBundleSource: 'const OpenAI = require("openai");',
      indexHtmlSource: '<script src="./assets/index.js"></script>',
      builderConfigSource: 'files:\n  - package.json\n  - node_modules/**/*\n  - out/**/*\n',
      assetFiles: ['assets/index.js'],
      assetSizes: [{ path: 'assets/index.js', sizeBytes: 6 * 1024 * 1024 }],
      buildResourceFiles: [],
      skillFiles: ['director-skill/SKILL.md'],
      nativeBindingWarning: 'better-sqlite3 原生绑定当前不可用'
    })

    expect(result.issues).toEqual([])
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('超出预算'),
      expect.stringContaining('better-sqlite3')
    ]))
  })

  it('flags missing builder icon assets', () => {
    const result = evaluateReleasePreflight({
      mainEntryExists: true,
      preloadEntryExists: true,
      rendererEntryExists: true,
      mainBundleSource: '',
      indexHtmlSource: '<script src="./assets/index.js"></script>',
      builderConfigSource: 'mac:\n  icon: resources/release-assets/generated/icon.icns\n',
      assetFiles: ['assets/index.js'],
      assetSizes: [{ path: 'assets/index.js', sizeBytes: 1024 }],
      buildResourceFiles: ['resources/release-assets/app-icon.svg'],
      skillFiles: ['director-skill/SKILL.md']
    })

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('缺失图标')
    ]))
  })

  it('builds a serializable preflight report', () => {
    const report = buildReleasePreflightReport({
      runtimeDependencies: ['better-sqlite3'],
      assetRefs: ['assets/index.js'],
      issues: [],
      warnings: ['warn']
    }, '2026-03-24T12:00:00.000Z')

    expect(report.generatedAt).toBe('2026-03-24T12:00:00.000Z')
    expect(report.runtimeDependencies).toEqual(['better-sqlite3'])
    expect(report.warnings).toEqual(['warn'])
  })
})
