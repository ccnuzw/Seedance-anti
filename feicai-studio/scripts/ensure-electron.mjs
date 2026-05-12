import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const electronRoot = path.join(projectRoot, 'node_modules', 'electron')
const pathFile = path.join(electronRoot, 'path.txt')
const installScript = path.join(electronRoot, 'install.js')

function resolveElectronBinary() {
  if (!existsSync(pathFile)) return null
  const relativeBinaryPath = readFileSync(pathFile, 'utf8').trim()
  if (!relativeBinaryPath) return null
  const absoluteBinaryPath = path.join(electronRoot, 'dist', relativeBinaryPath)
  return existsSync(absoluteBinaryPath) ? absoluteBinaryPath : null
}

if (!existsSync(installScript)) {
  console.error('未找到 electron/install.js，请先执行 npm install。')
  process.exit(1)
}

const currentBinary = resolveElectronBinary()
if (currentBinary) {
  console.log(`Electron binary ready: ${currentBinary}`)
  process.exit(0)
}

console.log('Electron binary missing, running installer...')
const result = spawnSync(process.execPath, [installScript], {
  cwd: projectRoot,
  stdio: 'inherit'
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

const installedBinary = resolveElectronBinary()
if (!installedBinary) {
  console.error('Electron 安装脚本已执行，但仍未找到二进制文件。')
  process.exit(1)
}

console.log(`Electron binary installed: ${installedBinary}`)
