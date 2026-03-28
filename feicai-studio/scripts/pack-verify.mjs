import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '..')

function walkFiles(baseDir, currentDir = baseDir) {
  if (!existsSync(currentDir)) return []

  const entries = readdirSync(currentDir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const nextPath = join(currentDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(baseDir, nextPath))
      continue
    }

    if (entry.isFile()) {
      files.push(relative(baseDir, nextPath).replace(/\\/g, '/'))
    }
  }

  return files.sort()
}

function formatBytes(sizeBytes) {
  const mb = sizeBytes / (1024 * 1024)
  return `${mb.toFixed(2)} MB`
}

export function collectPackTargets(files) {
  const targets = new Map()

  for (const filePath of files) {
    const macMatch = filePath.match(/^(.+\.app)\/Contents\/MacOS\/([^/]+)$/)
    if (macMatch) {
      const rootPath = macMatch[1]
      if (rootPath.includes('/Contents/Frameworks/')) {
        continue
      }
      targets.set(rootPath, {
        platform: 'mac',
        rootPath,
        executablePath: filePath
      })
      continue
    }

    const winMatch = filePath.match(/^((?:win|windows)[^/]*-unpacked)\/([^/]+\.exe)$/i)
    if (winMatch) {
      const rootPath = winMatch[1]
      targets.set(rootPath, {
        platform: 'win',
        rootPath,
        executablePath: filePath
      })
      continue
    }

    const linuxMatch = filePath.match(/^((?:linux)[^/]*-unpacked)\/([^/]+)$/i)
    if (linuxMatch && !linuxMatch[2].includes('.')) {
      const rootPath = linuxMatch[1]
      targets.set(rootPath, {
        platform: 'linux',
        rootPath,
        executablePath: filePath
      })
    }
  }

  return [...targets.values()].sort((a, b) => a.rootPath.localeCompare(b.rootPath))
}

function inspectPackTarget(target, files, sizeMap) {
  let resourcesPrefix = ''
  if (target.platform === 'mac') {
    resourcesPrefix = `${target.rootPath}/Contents/Resources`
  } else {
    resourcesPrefix = `${target.rootPath}/resources`
  }

  const targetFiles = files.filter((filePath) => filePath.startsWith(`${target.rootPath}/`))
  const targetSizeBytes = targetFiles.reduce((total, filePath) => total + (sizeMap.get(filePath) || 0), 0)
  const appAsarPath = `${resourcesPrefix}/app.asar`
  const skillFiles = targetFiles.filter((filePath) => filePath.startsWith(`${resourcesPrefix}/builtin-skills/`) && filePath.endsWith('/SKILL.md'))
  const nativeBindingFiles = targetFiles.filter((filePath) => filePath.startsWith(`${resourcesPrefix}/app.asar.unpacked/node_modules/better-sqlite3/`) && filePath.endsWith('.node'))

  return {
    ...target,
    targetSizeBytes,
    appAsarPath,
    hasAppAsar: files.includes(appAsarPath),
    skillFiles,
    nativeBindingFiles
  }
}

export function evaluatePackVerify(input) {
  const issues = []
  const warnings = []
  const targets = collectPackTargets(input.files || []).map((target) => inspectPackTarget(target, input.files || [], input.sizeMap || new Map()))

  if (!(input.files || []).length) {
    issues.push('dist 目录为空，尚未生成任何目录包产物')
  }

  if (targets.length === 0) {
    issues.push('未检测到任何 unpacked 目录包目标，pack:verify 没有产出可校验应用')
  }

  for (const target of targets) {
    if (!target.executablePath) {
      issues.push(`${target.rootPath} 缺少应用可执行文件`)
    }
    if (!target.hasAppAsar) {
      issues.push(`${target.rootPath} 缺少 app.asar`)
    }
    if (target.skillFiles.length === 0) {
      issues.push(`${target.rootPath} 缺少 builtin-skills/SKILL.md`)
    }
    if (target.nativeBindingFiles.length === 0) {
      issues.push(`${target.rootPath} 缺少 better-sqlite3 原生绑定`)
    }
  }

  if (input.nativeDependencyWarning) {
    warnings.push(input.nativeDependencyWarning)
  }

  return {
    targets,
    issues,
    warnings
  }
}

export function buildPackVerifyMarkdownReport(input) {
  const lines = [
    '# 打包验收报告',
    '',
    `- 生成时间：${new Date(input.generatedAt).toLocaleString('zh-CN')}`,
    `- 目标数量：${input.targets.length}`,
    `- 阻塞问题：${input.issues.length}`,
    `- 警告：${input.warnings.length}`,
    ''
  ]

  if (input.targets.length > 0) {
    lines.push('## 目录包目标')
    lines.push('')
    for (const target of input.targets) {
      lines.push(`### ${target.rootPath}`)
      lines.push('')
      lines.push(`- 平台：${target.platform}`)
      lines.push(`- 可执行文件：${target.executablePath}`)
      lines.push(`- app.asar：${target.hasAppAsar ? '存在' : '缺失'}`)
      lines.push(`- 内置技能：${target.skillFiles.length}`)
      lines.push(`- better-sqlite3 原生绑定：${target.nativeBindingFiles.length}`)
      lines.push(`- 目录体积：${formatBytes(target.targetSizeBytes)}`)
      lines.push('')
    }
  }

  if (input.issues.length > 0) {
    lines.push('## 阻塞问题')
    lines.push('')
    for (const issue of input.issues) {
      lines.push(`- ${issue}`)
    }
    lines.push('')
  }

  if (input.warnings.length > 0) {
    lines.push('## 警告')
    lines.push('')
    for (const warning of input.warnings) {
      lines.push(`- ${warning}`)
    }
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

async function run() {
  const distDir = join(PROJECT_ROOT, 'dist')
  const files = walkFiles(distDir)
  const sizeMap = new Map(files.map((filePath) => [filePath, statSync(join(distDir, filePath)).size]))
  const generatedAt = new Date().toISOString()
  const result = evaluatePackVerify({
    files,
    sizeMap
  })

  const reportJsonPath = join(distDir, 'pack-verify-report.json')
  const reportMdPath = join(distDir, 'pack-verify-report.md')
  mkdirSync(distDir, { recursive: true })
  writeFileSync(reportJsonPath, `${JSON.stringify({ generatedAt, ...result }, null, 2)}\n`, 'utf-8')
  writeFileSync(reportMdPath, buildPackVerifyMarkdownReport({ generatedAt, ...result }), 'utf-8')

  console.log('Pack Verify Summary')
  console.log(`- Targets: ${result.targets.length}`)
  console.log(`- Issues: ${result.issues.length}`)
  console.log(`- Warnings: ${result.warnings.length}`)
  console.log(`- JSON report: ${relative(PROJECT_ROOT, reportJsonPath)}`)
  console.log(`- Markdown report: ${relative(PROJECT_ROOT, reportMdPath)}`)

  if (result.issues.length > 0) {
    console.error('\nBlocking Issues')
    for (const issue of result.issues) {
      console.error(`- ${issue}`)
    }
    process.exitCode = 1
  }

  if (result.warnings.length > 0) {
    console.warn('\nWarnings')
    for (const warning of result.warnings) {
      console.warn(`- ${warning}`)
    }
  }

  if (result.issues.length === 0) {
    console.log('\nPack verify passed.')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  await run()
}
