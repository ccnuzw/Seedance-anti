// ============================================================
// useProjectSync — 从 URL 中的 :id 自动恢复 currentProject
// ============================================================

import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useProjectStore } from '@renderer/stores/projectStore'

/**
 * 在任何包含 /project/:id 路由的页面中调用。
 * 当 URL 中的 id 与当前 store 中的 currentProject 不匹配时，
 * 自动调用 loadProject 从数据库恢复项目上下文。
 */
export function useProjectSync(): void {
  const { id } = useParams<{ id: string }>()
  const { currentProject, loadProject } = useProjectStore()

  useEffect(() => {
    if (id && (!currentProject || currentProject.id !== id)) {
      loadProject(id)
    }
  }, [id, currentProject, loadProject])
}
