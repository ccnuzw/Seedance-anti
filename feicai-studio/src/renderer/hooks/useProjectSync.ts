// ============================================================
// useProjectSync — 从 URL 中的 :id 自动恢复 currentProject
// ============================================================

import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useProjectStore } from '@renderer/stores/projectStore'

/**
 * 在任何包含 /project/:id 路由的页面中调用。
 * 路由项目变化时加载项目与集数，不以另一项目遗留的集数数量判断已加载。
 */
export function useProjectSync(): void {
  const { id } = useParams<{ id: string }>()
  const loadProject = useProjectStore((s) => s.loadProject)

  useEffect(() => {
    if (id) void loadProject(id)
  }, [id, loadProject])
}
