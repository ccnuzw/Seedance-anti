import { spawnSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '..')

function detectPythonBinary() {
  if (process.env.PYTHON) return process.env.PYTHON
  if (existsSync('/usr/bin/python3')) return '/usr/bin/python3'
  return undefined
}

function getNodeCommand() {
  return process.execPath
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
  const dirPath = resolve(PROJECT_ROOT, name)
  mkdirSync(dirPath, { recursive: true })
  return dirPath
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

function runStep(label, command, args, env = process.env) {
  console.log(`\n[dist] ${label}`)
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    env
  })
  return result.status ?? 1
}

async function run() {
  let exitCode = 0
  let builderRan = false

  exitCode = runStep('generate app icons', getNodeCommand(), ['scripts/generate-app-icons.mjs'])
  if (exitCode !== 0) process.exit(exitCode)

  exitCode = runStep('sync monaco assets', getNodeCommand(), ['scripts/sync-monaco-assets.mjs'])
  if (exitCode !== 0) process.exit(exitCode)

  exitCode = runStep('build', resolveLocalBinary('electron-vite'), ['build'])
  if (exitCode !== 0) process.exit(exitCode)

  exitCode = runStep('release preflight', getNodeCommand(), ['scripts/release-preflight.mjs'])
  if (exitCode !== 0) process.exit(exitCode)

  builderRan = true
  exitCode = runStep(
    'electron-builder',
    resolveLocalBinary('electron-builder'),
    [],
    {
      ...createBaseBuildEnv(),
      npm_config_devdir: ensureWorkspaceDir('.electron-gyp')
    }
  )

  if (exitCode === 0) {
    exitCode = runStep('release archive', getNodeCommand(), ['scripts/release-archive.mjs'])
  }

  if (builderRan) {
    const restoreCode = runStep('restore node native bindings', getNodeCommand(), ['scripts/native-deps.mjs', 'rebuild-node'])
    if (exitCode === 0 && restoreCode !== 0) {
      exitCode = restoreCode
    }
  }

  process.exit(exitCode)
}

await run()
