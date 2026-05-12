import { readFile } from 'fs/promises'
import { resolveProjectArtifactPath } from '@shared/path-resolver'
import type { ProjectPipelineState } from '@shared/types'
import { getProjectByPath } from './project-service'

export async function getProjectPipelineState(
  projectPath: string
): Promise<ProjectPipelineState | null> {
  try {
    const project = getProjectByPath(projectPath)
    const statePath = resolveProjectArtifactPath(
      projectPath,
      'pipelineState',
      project?.config
    )
    const content = await readFile(statePath, 'utf-8')
    return JSON.parse(content) as ProjectPipelineState
  } catch {
    return null
  }
}
