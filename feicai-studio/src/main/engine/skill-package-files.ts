import { open, readdir, realpath, stat } from 'fs/promises'
import { isAbsolute, relative, resolve, sep } from 'path'
import { constants } from 'fs'
import { TextDecoder } from 'util'

function contained(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** Both lexical and real paths must stay inside the authority root. Internal
 * symlinks are allowed, but directory cycles and outside targets are rejected. */
export async function resolveSkillPath(
  root: string,
  path: string
): Promise<string> {
  const lexicalRoot = resolve(root)
  const lexicalPath = resolve(path)
  if (!contained(lexicalRoot, lexicalPath))
    throw new Error(`Skill path escapes root: ${path}`)
  const [actualRoot, actualPath] = await Promise.all([
    realpath(lexicalRoot),
    realpath(lexicalPath)
  ])
  if (!contained(actualRoot, actualPath))
    throw new Error(`Skill symlink escapes root: ${path}`)
  return actualPath
}

export async function readSkillText(
  root: string,
  path: string
): Promise<string> {
  const actualPath = await resolveSkillPath(root, path)
  if (!(await stat(actualPath)).isFile())
    throw new Error(`Skill resource is not a file: ${path}`)
  const handle = await open(
    actualPath,
    constants.O_RDONLY | constants.O_NOFOLLOW
  )
  try {
    if (!(await handle.stat()).isFile())
      throw new Error(`Skill resource is not a file: ${path}`)
    const bytes = await handle.readFile()
    // Reject binary/invalid UTF-8 rather than hashing lossy replacement text.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes
    )
  } finally {
    await handle.close()
  }
}

export async function listSkillFiles(
  root: string,
  dir: string,
  ancestors: string[] = []
): Promise<string[]> {
  const actual = await resolveSkillPath(root, dir)
  if (ancestors.includes(actual))
    throw new Error(`Skill directory symlink cycle: ${dir}`)
  const files: string[] = []
  for (const entry of (await readdir(actual)).sort()) {
    const path = resolve(dir, entry)
    const target = await resolveSkillPath(root, path)
    if ((await stat(target)).isDirectory()) {
      files.push(...(await listSkillFiles(root, path, [...ancestors, actual])))
    } else files.push(path)
  }
  return files
}
