import { Navigate } from 'react-router-dom'
import { buildProjectRoute } from '@renderer/project-routing'
import { useProjectStore } from '@renderer/stores/projectStore'

export default function ProjectPage() {
  const { currentProject } = useProjectStore()

  if (!currentProject) {
    return <Navigate to="/" replace />
  }

  return <Navigate to={buildProjectRoute(currentProject.id, 'settings')} replace />
}
