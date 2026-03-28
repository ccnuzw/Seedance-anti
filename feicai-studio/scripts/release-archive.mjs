import { createHash } from 'crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
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

function sha256File(filePath) {
  const content = readFileSync(filePath)
  return createHash('sha256').update(content).digest('hex')
}

export function buildReleaseArchiveManifest(input) {
  const timestamp = input.generatedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  return {
    generatedAt: input.generatedAt,
    archiveId: `release-${timestamp}`,
    artifactCount: input.artifacts.length,
    artifacts: input.artifacts
  }
}

function main() {
  const distDir = join(PROJECT_ROOT, 'dist')
  const archiveRoot = join(distDir, 'release-archive')
  const generatedAt = new Date().toISOString()
  const archiveId = `release-${generatedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`
  const archiveDir = join(archiveRoot, archiveId)
  mkdirSync(archiveDir, { recursive: true })

  const candidateFiles = walkFiles(distDir).filter((filePath) => {
    if (filePath.startsWith('release-archive/')) return false
    if (filePath.startsWith('mac/')) return false
    return filePath.endsWith('.json') || filePath.endsWith('.md') || filePath.endsWith('.yml') || filePath.endsWith('.yaml') || filePath.endsWith('.dmg') || filePath.endsWith('.zip')
  })

  const artifacts = candidateFiles.map((filePath) => {
    const absolutePath = join(distDir, filePath)
    return {
      path: filePath,
      sizeBytes: statSync(absolutePath).size,
      sha256: sha256File(absolutePath)
    }
  })

  const manifest = buildReleaseArchiveManifest({ generatedAt, artifacts })
  const checksumLines = artifacts.map((artifact) => `${artifact.sha256}  ${artifact.path}`)

  for (const filePath of candidateFiles) {
    const sourcePath = join(distDir, filePath)
    const targetPath = join(archiveDir, filePath)
    mkdirSync(dirname(targetPath), { recursive: true })
    cpSync(sourcePath, targetPath)
  }

  writeFileSync(join(archiveDir, 'release-archive-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')
  writeFileSync(join(archiveDir, 'SHA256SUMS.txt'), `${checksumLines.join('\n')}\n`, 'utf-8')

  console.log(`Release archive created: ${relative(PROJECT_ROOT, archiveDir)}`)
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main()
}
