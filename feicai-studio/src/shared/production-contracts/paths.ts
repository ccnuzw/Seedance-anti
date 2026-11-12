import type { ProjectLayout } from '../artifact-registry'

export type ProductionLayout = Pick<ProjectLayout, 'assetsDir' | 'outputsDir'>

// Lexical portability only. Filesystem containment, symlinks and file hashes must be checked by main at I/O time.
export function isProductionRelativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    !/[\\:%?#<>"|*]/.test(value) &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127
    }) &&
    value
      .split('/')
      .every(
        (segment) =>
          segment.length > 0 &&
          segment !== '.' &&
          segment !== '..' &&
          !/[. ]$/.test(segment) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
      )
  )
}

export function getProductionPaths(layout: ProductionLayout): {
  manifest: string
  assetMedia: string
  outputMedia: string
  thumbnails: string
  operations: string
} {
  if (
    !isProductionRelativePath(layout.assetsDir) ||
    !isProductionRelativePath(layout.outputsDir)
  ) {
    throw new Error(
      'Production layout requires canonical project-relative assetsDir/outputsDir'
    )
  }
  return {
    manifest: `${layout.outputsDir}/production/manifest.v1.json`,
    assetMedia: `${layout.assetsDir}/media`,
    outputMedia: `${layout.outputsDir}/media`,
    thumbnails: `${layout.assetsDir}/thumbnails`,
    operations: `${layout.outputsDir}/production/operations`
  }
}

export function isWithinRelativeDirectory(
  path: string,
  directory: string
): boolean {
  return path.startsWith(`${directory}/`)
}
