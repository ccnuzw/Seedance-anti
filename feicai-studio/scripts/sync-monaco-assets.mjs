import { cpSync, existsSync, mkdirSync, rmSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '..')
const SOURCE_DIR = join(PROJECT_ROOT, 'node_modules', 'monaco-editor', 'min', 'vs')
const TARGET_DIR = join(PROJECT_ROOT, 'public', 'vendor', 'monaco', 'vs')

function main() {
  if (!existsSync(SOURCE_DIR)) {
    throw new Error(`Monaco 资源目录不存在：${SOURCE_DIR}`)
  }

  mkdirSync(dirname(TARGET_DIR), { recursive: true })
  rmSync(TARGET_DIR, { recursive: true, force: true })
  cpSync(SOURCE_DIR, TARGET_DIR, { recursive: true })
  console.log(`Monaco 静态资源已同步到 ${TARGET_DIR}`)
}

main()
