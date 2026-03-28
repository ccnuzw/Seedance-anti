import { builtinModules } from 'module'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { formatNativeDependencyWarning, getNativeDependencyStatus } from './native-deps.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '..')
const BUILTIN_MODULE_SET = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))
const MB = 1024 * 1024
const RENDERER_ASSET_BUDGETS = [
  {
    label: 'renderer 入口脚本',
    maxBytes: 3 * MB,
    test: (assetPath) => /^assets\/index(?:-.*)?\.js$/.test(assetPath)
  },
  {
    label: 'renderer 样式',
    maxBytes: 512 * 1024,
    test: (assetPath) => /^assets\/index(?:-.*)?\.css$/.test(assetPath)
  },
  {
    label: '编辑器 worker',
    maxBytes: 2 * MB,
    test: (assetPath) => /^assets\/.*worker-.*\.js$/.test(assetPath)
  }
]

export function collectRuntimeDependencies(mainBundleSource) {
  const matches = [...mainBundleSource.matchAll(/require\("([^"]+)"\)/g)]
  return [...new Set(
    matches
      .map((match) => match[1])
      .filter((name) => !!name && !name.startsWith('.') && !name.startsWith('/') && name !== 'electron')
      .filter((name) => !BUILTIN_MODULE_SET.has(name))
  )].sort()
}

export function extractRendererAssetRefs(indexHtmlSource) {
  const refs = [
    ...indexHtmlSource.matchAll(/<script[^>]+src="([^"]+)"/g),
    ...indexHtmlSource.matchAll(/<link[^>]+href="([^"]+)"/g)
  ]

  return [...new Set(
    refs
      .map((match) => match[1])
      .filter((value) => !!value && !/^https?:\/\//.test(value))
      .map((value) => value.replace(/^\.\//, ''))
  )].sort()
}

export function evaluateReleasePreflight(input) {
  const issues = []
  const warnings = []
  const runtimeDependencies = collectRuntimeDependencies(input.mainBundleSource || '')
  const assetRefs = extractRendererAssetRefs(input.indexHtmlSource || '')
  const builderConfig = input.builderConfigSource || ''
  const iconRefs = [...builderConfig.matchAll(/^\s*icon:\s+(.+)$/gm)]
    .map((match) => match[1]?.trim())
    .filter(Boolean)

  if (!input.mainEntryExists) {
    issues.push('缺少 out/main/index.js，主进程构建产物不存在')
  }

  if (!input.preloadEntryExists) {
    issues.push('缺少 out/preload/index.js，预加载构建产物不存在')
  }

  if (!input.rendererEntryExists) {
    issues.push('缺少 out/renderer/index.html，渲染进程构建产物不存在')
  }

  const missingAssets = assetRefs.filter((assetRef) => !input.assetFiles.includes(assetRef))
  if (missingAssets.length > 0) {
    issues.push(`index.html 引用了缺失资源：${missingAssets.join(', ')}`)
  }

  const hasPackageJsonPattern = /^\s*-\s+package\.json\s*$/m.test(builderConfig)
  const hasNodeModulesPattern = /^\s*-\s+node_modules\/\*\*\/\*\s*$/m.test(builderConfig)
  if (runtimeDependencies.length > 0 && !hasPackageJsonPattern) {
    issues.push('electron-builder files 未包含 package.json，运行时依赖无法正确装载')
  }
  if (runtimeDependencies.length > 0 && !hasNodeModulesPattern) {
    issues.push('electron-builder files 未包含 node_modules/**/*，主进程外部依赖不会随包分发')
  }

  if (input.skillFiles.length === 0) {
    issues.push('resources/builtin-skills 中未找到任何 SKILL.md，内置技能不会进入安装包')
  }

  const missingBuilderIcons = iconRefs.filter((iconPath) => {
    const files = input.buildResourceFiles || []
    return !files.includes(iconPath) && !files.some((filePath) => filePath.startsWith(`${iconPath}/`))
  })
  if (missingBuilderIcons.length > 0) {
    issues.push(`electron-builder 配置引用了缺失图标：${missingBuilderIcons.join(', ')}`)
  }

  const coveredAssetPaths = new Set()
  for (const asset of input.assetSizes) {
    for (const budget of RENDERER_ASSET_BUDGETS) {
      if (!budget.test(asset.path)) continue
      coveredAssetPaths.add(asset.path)
      if (asset.sizeBytes > budget.maxBytes) {
        warnings.push(`${budget.label} 超出预算：${asset.path} ${formatBytes(asset.sizeBytes)} > ${formatBytes(budget.maxBytes)}`)
      }
    }
  }

  const largeAssets = input.assetSizes.filter((item) => item.sizeBytes >= 5 * MB && !coveredAssetPaths.has(item.path))
  if (largeAssets.length > 0) {
    warnings.push(`存在 ${largeAssets.length} 个大体积资源（>= 5 MB）：${largeAssets.map((item) => `${item.path} ${formatBytes(item.sizeBytes)}`).join(', ')}`)
  }

  if (input.nativeBindingWarning) {
    warnings.push(input.nativeBindingWarning)
  }

  return {
    runtimeDependencies,
    assetRefs,
    issues,
    warnings
  }
}

export function buildReleasePreflightReport(result, generatedAt = new Date().toISOString()) {
  return {
    generatedAt,
    runtimeDependencies: result.runtimeDependencies,
    assetRefs: result.assetRefs,
    issues: result.issues,
    warnings: result.warnings
  }
}

function formatBytes(sizeBytes) {
  const mb = sizeBytes / (1024 * 1024)
  return `${mb.toFixed(2)} MB`
}

function walkFiles(baseDir, currentDir = baseDir) {
  if (!existsSync(currentDir)) return []
  const entries = readdirSync(currentDir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const nextPath = join(currentDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(baseDir, nextPath))
    } else if (entry.isFile()) {
      files.push(relative(baseDir, nextPath))
    }
  }

  return files.sort()
}

async function run() {
  const outDir = join(PROJECT_ROOT, 'out')
  const rendererDir = join(outDir, 'renderer')
  const assetsDir = join(rendererDir, 'assets')
  const mainEntryPath = join(outDir, 'main', 'index.js')
  const preloadEntryPath = join(outDir, 'preload', 'index.js')
  const rendererEntryPath = join(rendererDir, 'index.html')
  const builderConfigPath = join(PROJECT_ROOT, 'electron-builder.yml')
  const skillRoot = join(PROJECT_ROOT, 'resources', 'builtin-skills')

  const assetFiles = walkFiles(rendererDir)
  const assetSizes = assetFiles.map((assetPath) => ({
    path: assetPath,
    sizeBytes: statSync(join(rendererDir, assetPath)).size
  }))

  const result = evaluateReleasePreflight({
    mainEntryExists: existsSync(mainEntryPath),
    preloadEntryExists: existsSync(preloadEntryPath),
    rendererEntryExists: existsSync(rendererEntryPath),
    mainBundleSource: existsSync(mainEntryPath) ? readFileSync(mainEntryPath, 'utf-8') : '',
    indexHtmlSource: existsSync(rendererEntryPath) ? readFileSync(rendererEntryPath, 'utf-8') : '',
    builderConfigSource: existsSync(builderConfigPath) ? readFileSync(builderConfigPath, 'utf-8') : '',
    assetFiles,
    assetSizes,
    buildResourceFiles: walkFiles(PROJECT_ROOT),
    skillFiles: walkFiles(skillRoot).filter((file) => file.endsWith('SKILL.md')),
    nativeBindingWarning: formatNativeDependencyWarning(getNativeDependencyStatus())
  })
  const report = buildReleasePreflightReport(result)
  const distDir = join(PROJECT_ROOT, 'dist')
  mkdirSync(distDir, { recursive: true })
  writeFileSync(join(distDir, 'release-preflight-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf-8')

  console.log('Release Preflight Summary')
  console.log(`- Runtime dependencies: ${result.runtimeDependencies.length > 0 ? result.runtimeDependencies.join(', ') : 'none'}`)
  console.log(`- Renderer asset refs: ${result.assetRefs.length}`)
  console.log(`- Issues: ${result.issues.length}`)
  console.log(`- Warnings: ${result.warnings.length}`)

  if (result.issues.length > 0) {
    console.error('\nBlocking Issues')
    for (const issue of result.issues) {
      console.error(`- ${issue}`)
    }
  }

  if (result.warnings.length > 0) {
    console.warn('\nWarnings')
    for (const warning of result.warnings) {
      console.warn(`- ${warning}`)
    }
  }

  if (result.issues.length === 0) {
    console.log('\nRelease preflight passed.')
  } else {
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  await run()
}
