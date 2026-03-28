import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '..')
const SOURCE_SVG = join(PROJECT_ROOT, 'resources', 'release-assets', 'app-icon.svg')
const OUTPUT_DIR = join(PROJECT_ROOT, 'resources', 'release-assets', 'generated')

const ICONSET_SPECS = [
  { size: 16, file: 'icon_16x16.png' },
  { size: 32, file: 'icon_16x16@2x.png' },
  { size: 32, file: 'icon_32x32.png' },
  { size: 64, file: 'icon_32x32@2x.png' },
  { size: 128, file: 'icon_128x128.png' },
  { size: 256, file: 'icon_128x128@2x.png' },
  { size: 256, file: 'icon_256x256.png' },
  { size: 512, file: 'icon_256x256@2x.png' },
  { size: 512, file: 'icon_512x512.png' },
  { size: 1024, file: 'icon_512x512@2x.png' }
]

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' })
}

function renderSourcePng(tempDir) {
  run('/usr/bin/qlmanage', ['-t', '-s', '1024', '-o', tempDir, SOURCE_SVG])
  const rendered = join(tempDir, 'app-icon.svg.png')
  if (!existsSync(rendered)) {
    throw new Error('图标源文件渲染失败，未生成 PNG 预览')
  }
  return rendered
}

function generateIconset(renderedPng, iconsetDir) {
  mkdirSync(iconsetDir, { recursive: true })
  for (const spec of ICONSET_SPECS) {
    run('/usr/bin/sips', ['-z', String(spec.size), String(spec.size), renderedPng, '--out', join(iconsetDir, spec.file)])
  }
}

function main() {
  if (!existsSync(SOURCE_SVG)) {
    throw new Error(`缺少图标源文件：${SOURCE_SVG}`)
  }

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const tempDir = mkdtempSync(join(tmpdir(), 'feicai-icon-'))
  const iconsetDir = join(tempDir, 'app.iconset')

  try {
    const renderedPng = renderSourcePng(tempDir)
    generateIconset(renderedPng, iconsetDir)
    run('/usr/bin/iconutil', ['-c', 'icns', iconsetDir, '-o', join(OUTPUT_DIR, 'icon.icns')])
    run('/bin/cp', [renderedPng, join(OUTPUT_DIR, 'icon.png')])
    console.log(`图标已生成：${OUTPUT_DIR}`)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

main()
