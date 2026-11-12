import { cp, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'

// Export only review artifacts, never temporary Chromium profiles or caches.
export async function exportDomArtifacts(temporary, suite) {
  if (!process.env.UI_DOM_ARTIFACT_DIR) return
  const destination = join(process.env.UI_DOM_ARTIFACT_DIR, suite)
  await mkdir(destination, { recursive: true })
  for (const name of await readdir(temporary)) {
    if (name === 'result.json' || name.endsWith('.png'))
      await cp(join(temporary, name), join(destination, name))
  }
}
