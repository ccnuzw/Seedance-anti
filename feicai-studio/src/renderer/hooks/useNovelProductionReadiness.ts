import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '@shared/types'
import type { PlotBreakdownSummary } from '@shared/ipc-contracts'
import { resolveProjectArtifactPath } from '@shared/path-resolver'
import { readTextFile } from '@renderer/services/file-io'
import { getPlotBreakdownSummary } from '@renderer/services/project-service'

export function useNovelProductionReadiness(project: Project | null) {
  const [state, setState] = useState<{
    key: string
    hasSource: boolean | null
    waterline: PlotBreakdownSummary | null
  } | null>(null)
  const epoch = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++epoch.current
    if (!project) return
    setState(null)
    const results = await Promise.allSettled([
      readTextFile(
        resolveProjectArtifactPath(
          project.projectPath,
          'sourceNovel',
          project.config
        )
      ),
      getPlotBreakdownSummary(project.id)
    ])
    if (request !== epoch.current) return
    const [source, summary] = results
    setState({
      key: project.id,
      hasSource:
        source.status === 'fulfilled'
          ? !!source.value?.trim() ||
            (summary.status === 'fulfilled' &&
              summary.value.totalSourceChapters > 0)
          : null,
      waterline: summary.status === 'fulfilled' ? summary.value : null
    })
  }, [project?.id, project?.updatedAt, project?.projectPath, project?.config])
  useEffect(() => {
    void refresh()
    return () => {
      epoch.current++
    }
  }, [refresh])
  const visible = state?.key === project?.id ? state : null
  return {
    hasSource: visible?.hasSource ?? null,
    waterline: visible?.waterline ?? null,
    refresh
  }
}
