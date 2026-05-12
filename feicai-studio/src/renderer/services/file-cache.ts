import { readTextFile } from './file-io'

const textFileCache = new Map<string, Promise<string | null>>()

export async function readCachedTextFile(
  filePath: string
): Promise<string | null> {
  if (!filePath) return null

  const cached = textFileCache.get(filePath)
  if (cached) {
    return await cached
  }

  const request = readTextFile(filePath).catch(() => null)

  textFileCache.set(filePath, request)
  return await request
}

export function invalidateCachedTextFile(filePath: string): void {
  if (!filePath) return
  textFileCache.delete(filePath)
}

export function invalidateCachedTextFiles(filePaths: string[]): void {
  for (const filePath of filePaths) {
    invalidateCachedTextFile(filePath)
  }
}

export function clearCachedTextFiles(): void {
  textFileCache.clear()
}
