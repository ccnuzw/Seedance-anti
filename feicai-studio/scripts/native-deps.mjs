import { execFileSync, spawnSync } from 'child_process'
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { dirname, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '..')
const BETTER_SQLITE_ROOT = join(PROJECT_ROOT, 'node_modules', 'better-sqlite3')
const BETTER_SQLITE_BUILD_ROOT = join(BETTER_SQLITE_ROOT, 'build', 'Release')
const NATIVE_CACHE_ROOT = join(PROJECT_ROOT, '.native-cache', 'better-sqlite3')
const BINDING_FILE_NAMES = ['better_sqlite3.node', 'test_extension.node']

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
      files.push(relative(baseDir, nextPath))
    }
  }

  return files.sort()
}

function detectPythonBinary() {
  if (process.env.PYTHON) return process.env.PYTHON
  if (existsSync('/usr/bin/python3')) return '/usr/bin/python3'
  return undefined
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function resolveLocalBinary(name) {
  return resolve(
    PROJECT_ROOT,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name
  )
}

function ensureWorkspaceDir(name) {
  const dirPath = join(PROJECT_ROOT, name)
  mkdirSync(dirPath, { recursive: true })
  return dirPath
}

function buildBindingCacheKey(abi) {
  return `node-v${abi}-${process.platform}-${process.arch}`
}

function getBindingCacheDir(cacheKey) {
  return join(NATIVE_CACHE_ROOT, cacheKey)
}

function getExistingBindingFiles(baseDir) {
  return BINDING_FILE_NAMES
    .map((fileName) => ({
      fileName,
      sourcePath: join(baseDir, fileName)
    }))
    .filter((item) => existsSync(item.sourcePath))
}

function cacheBindingFiles(cacheKey, baseDir = BETTER_SQLITE_BUILD_ROOT) {
  const files = getExistingBindingFiles(baseDir)
  if (files.length === 0) return false
  const cacheDir = getBindingCacheDir(cacheKey)
  mkdirSync(cacheDir, { recursive: true })
  for (const file of files) {
    copyFileSync(file.sourcePath, join(cacheDir, file.fileName))
  }
  return true
}

function restoreBindingFilesFromCache(cacheKey) {
  const cacheDir = getBindingCacheDir(cacheKey)
  const files = getExistingBindingFiles(cacheDir)
  if (files.length === 0) return false
  mkdirSync(BETTER_SQLITE_BUILD_ROOT, { recursive: true })
  for (const file of files) {
    copyFileSync(file.sourcePath, join(BETTER_SQLITE_BUILD_ROOT, file.fileName))
  }
  return true
}

function seedElectronBindingCacheFromPackedApp(cacheKey) {
  const distDir = join(PROJECT_ROOT, 'dist')
  if (!existsSync(distDir)) return false

  const packedBindingPaths = walkFiles(distDir)
    .filter((filePath) => filePath.endsWith('/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node'))

  const bindingPath = packedBindingPaths[0]
  if (!bindingPath) return false

  const packedReleaseDir = join(distDir, dirname(bindingPath))
  return cacheBindingFiles(cacheKey, packedReleaseDir)
}

function readElectronVersions() {
  try {
    const electronBinary = require('electron')
    const stdout = execFileSync(
      electronBinary,
      ['-e', 'process.stdout.write(JSON.stringify(process.versions))'],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1'
        },
        encoding: 'utf-8'
      }
    )

    return {
      ok: true,
      binaryPath: electronBinary,
      versions: JSON.parse(stdout)
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

function probeBetterSqliteCurrentNode() {
  const probeDir = mkdtempSync(join(tmpdir(), 'feicai-sqlite-probe-'))

  try {
    const Database = require('better-sqlite3')
    const probePath = join(probeDir, 'probe.db')
    const db = new Database(probePath)
    db.close()
    return {
      ok: true
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }
}

function probeBetterSqliteElectronRuntime(electronBinary) {
  if (!electronBinary) {
    return {
      ok: false,
      error: 'Electron binary unavailable'
    }
  }

  const probeDir = mkdtempSync(join(tmpdir(), 'feicai-sqlite-electron-probe-'))

  try {
    execFileSync(
      electronBinary,
      [
        '-e',
        [
          "const Database = require('better-sqlite3')",
          "const path = require('path')",
          "const db = new Database(path.join(process.cwd(), '.tmp-electron-probe.db'))",
          'db.close()'
        ].join(';')
      ],
      {
        cwd: probeDir,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          NODE_PATH: join(PROJECT_ROOT, 'node_modules')
        },
        stdio: 'pipe'
      }
    )
    return {
      ok: true
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }
}

function collectBetterSqliteBindings() {
  return walkFiles(BETTER_SQLITE_ROOT)
    .filter((filePath) => filePath.endsWith('.node'))
    .map((filePath) => join(BETTER_SQLITE_ROOT, filePath))
}

function resolveNodeRuntimeRoot() {
  return resolve(process.execPath, '..', '..')
}

function createBaseBuildEnv() {
  const homeDir = ensureWorkspaceDir('.release-home')
  const cacheDir = ensureWorkspaceDir('.npm-cache')
  const pythonBinary = detectPythonBinary()

  return {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    npm_config_cache: cacheDir,
    ...(pythonBinary ? { PYTHON: pythonBinary } : {})
  }
}

export function getNativeDependencyStatus() {
  const nodeProbe = probeBetterSqliteCurrentNode()
  const electronRuntime = readElectronVersions()
  const electronProbe = electronRuntime.ok
    ? probeBetterSqliteElectronRuntime(electronRuntime.binaryPath)
    : { ok: false, error: electronRuntime.error }
  const bindingFiles = collectBetterSqliteBindings()
  const nodeModulesAbi = process.versions.modules
  const electronModulesAbi = electronRuntime.ok ? electronRuntime.versions.modules : undefined

  return {
    betterSqliteBindingFiles: bindingFiles,
    currentNodeBindingOk: nodeProbe.ok,
    currentNodeBindingError: nodeProbe.ok ? undefined : nodeProbe.error,
    currentElectronBindingOk: electronProbe.ok,
    currentElectronBindingError: electronProbe.ok ? undefined : electronProbe.error,
    electronBinaryPath: electronRuntime.ok ? electronRuntime.binaryPath : undefined,
    electronError: electronRuntime.ok ? undefined : electronRuntime.error,
    electronVersion: electronRuntime.ok ? electronRuntime.versions.electron : undefined,
    electronModulesAbi,
    nodeVersion: process.version,
    nodeModulesAbi,
    nodeRuntimeRoot: resolveNodeRuntimeRoot(),
    requiresElectronRebuild: !!(electronModulesAbi && nodeModulesAbi && electronModulesAbi !== nodeModulesAbi)
  }
}

export function formatNativeDependencyWarning(status) {
  if (!status.currentNodeBindingOk && status.currentElectronBindingOk) {
    return `better-sqlite3 当前 Electron 绑定可用，但 Node CLI 绑定不可用：${status.currentNodeBindingError}\n如需运行 Vitest / Node 脚本，请执行 npm run native:rebuild:node`
  }

  if (!status.currentElectronBindingOk && status.currentNodeBindingOk) {
    return `better-sqlite3 当前仅验证了 Node ABI ${status.nodeModulesAbi}，Electron ${status.electronVersion} 需要 ABI ${status.electronModulesAbi}；启动桌面端前请执行 npm run native:rebuild:electron`
  }

  if (!status.currentNodeBindingOk) {
    return `better-sqlite3 原生绑定当前不可用：${status.currentNodeBindingError}`
  }

  if (status.betterSqliteBindingFiles.length === 0) {
    return 'better-sqlite3 未发现任何原生 .node 产物，正式打包前需要先执行原生依赖重建'
  }

  if (status.requiresElectronRebuild) {
    return `better-sqlite3 的 Node ABI 与 Electron ABI 不一致（Node ${status.nodeModulesAbi} / Electron ${status.electronModulesAbi}）；不同工作流会自动切换，正式出包前仍建议执行 npm run native:rebuild:electron`
  }

  if (status.electronError) {
    return `无法读取 Electron 运行时版本信息：${status.electronError}`
  }

  return undefined
}

function printStatus(status) {
  console.log('Native Dependency Status')
  console.log(`- Node: ${status.nodeVersion} (ABI ${status.nodeModulesAbi})`)
  console.log(`- Node runtime root: ${status.nodeRuntimeRoot}`)
  if (status.electronVersion && status.electronModulesAbi) {
    console.log(`- Electron: ${status.electronVersion} (ABI ${status.electronModulesAbi})`)
  } else {
    console.log(`- Electron: unavailable${status.electronError ? ` (${status.electronError})` : ''}`)
  }
  if (status.electronBinaryPath) {
    console.log(`- Electron binary: ${status.electronBinaryPath}`)
  }
  console.log(`- better-sqlite3 load in current Node: ${status.currentNodeBindingOk ? 'ok' : 'failed'}`)
  if (status.currentNodeBindingError) {
    console.log(`- Node load error: ${status.currentNodeBindingError}`)
  }
  console.log(`- better-sqlite3 load in Electron runtime: ${status.currentElectronBindingOk ? 'ok' : 'failed'}`)
  if (status.currentElectronBindingError) {
    console.log(`- Electron load error: ${status.currentElectronBindingError}`)
  }
  console.log(`- better-sqlite3 binding files: ${status.betterSqliteBindingFiles.length}`)
  for (const bindingFile of status.betterSqliteBindingFiles) {
    const relativePath = relative(PROJECT_ROOT, bindingFile)
    const size = statSync(bindingFile).size
    console.log(`  - ${relativePath} (${size} bytes)`)
  }
  console.log(`- Requires Electron rebuild: ${status.requiresElectronRebuild ? 'yes' : 'no'}`)

  const warning = formatNativeDependencyWarning(status)
  if (warning) {
    console.log(`- Warning: ${warning}`)
  }
}

function runNodeRebuild() {
  const result = spawnSync(getNpmCommand(), ['rebuild', 'better-sqlite3'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    env: {
      ...createBaseBuildEnv(),
      npm_config_nodedir: resolveNodeRuntimeRoot()
    }
  })

  if ((result.status ?? 1) === 0) {
    cacheBindingFiles(buildBindingCacheKey(process.versions.modules))
  }

  process.exit(result.status ?? 1)
}

function runElectronRebuild() {
  const electronRuntime = readElectronVersions()
  if (!electronRuntime.ok || !electronRuntime.versions?.electron) {
    console.error(`无法读取 Electron 版本信息：${electronRuntime.error || 'unknown error'}`)
    process.exit(1)
  }

  const electronRebuildBinary = resolveLocalBinary('electron-rebuild')
  const result = spawnSync(electronRebuildBinary, [
    '--force',
    '--only',
    'better-sqlite3',
    '--module-dir',
    PROJECT_ROOT,
    '--version',
    electronRuntime.versions.electron
  ], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    env: {
      ...createBaseBuildEnv(),
      npm_config_devdir: ensureWorkspaceDir('.electron-gyp')
    }
  })

  if (result.status && result.status !== 0) {
    console.error('\nElectron 原生依赖重建失败。')
    console.error('如果错误信息包含 Electron headers / network / ECONN，请在可联网环境下重试，或预热 Electron headers 缓存。')
  }

  if ((result.status ?? 1) === 0) {
    cacheBindingFiles(buildBindingCacheKey(electronRuntime.versions.modules))
  }

  process.exit(result.status ?? 1)
}

function ensureNodeBindings() {
  const status = getNativeDependencyStatus()
  if (status.currentNodeBindingOk) {
    cacheBindingFiles(buildBindingCacheKey(status.nodeModulesAbi))
    console.log('better-sqlite3 当前 Node 绑定可用，无需重建。')
    process.exit(0)
  }

  if (restoreBindingFilesFromCache(buildBindingCacheKey(status.nodeModulesAbi))) {
    const restoredStatus = getNativeDependencyStatus()
    if (restoredStatus.currentNodeBindingOk) {
      console.log('better-sqlite3 已从本地缓存恢复 Node 绑定。')
      process.exit(0)
    }
  }

  runNodeRebuild()
}

function ensureElectronBindings() {
  const status = getNativeDependencyStatus()
  if (status.currentElectronBindingOk) {
    if (status.electronModulesAbi) {
      cacheBindingFiles(buildBindingCacheKey(status.electronModulesAbi))
    }
    console.log('better-sqlite3 当前 Electron 绑定可用，无需重建。')
    process.exit(0)
  }

  const electronCacheKey = status.electronModulesAbi
    ? buildBindingCacheKey(status.electronModulesAbi)
    : undefined

  if (electronCacheKey && restoreBindingFilesFromCache(electronCacheKey)) {
    const restoredStatus = getNativeDependencyStatus()
    if (restoredStatus.currentElectronBindingOk) {
      console.log('better-sqlite3 已从本地缓存恢复 Electron 绑定。')
      process.exit(0)
    }
  }

  if (electronCacheKey && seedElectronBindingCacheFromPackedApp(electronCacheKey) && restoreBindingFilesFromCache(electronCacheKey)) {
    const restoredStatus = getNativeDependencyStatus()
    if (restoredStatus.currentElectronBindingOk) {
      console.log('better-sqlite3 已从已打包产物恢复 Electron 绑定。')
      process.exit(0)
    }
  }

  runElectronRebuild()
}

function runCli(command) {
  if (command === 'status' || !command) {
    printStatus(getNativeDependencyStatus())
    return
  }

  if (command === 'rebuild-node') {
    runNodeRebuild()
    return
  }

  if (command === 'rebuild-electron') {
    runElectronRebuild()
    return
  }

  if (command === 'ensure-node') {
    ensureNodeBindings()
    return
  }

  if (command === 'ensure-electron') {
    ensureElectronBindings()
    return
  }

  console.error(`Unsupported command: ${command}`)
  process.exit(1)
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  runCli(process.argv[2])
}
