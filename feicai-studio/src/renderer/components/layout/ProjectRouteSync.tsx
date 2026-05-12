import { Outlet } from 'react-router-dom'
import { useProjectSync } from '@renderer/hooks/useProjectSync'

export default function ProjectRouteSync() {
  useProjectSync()
  return <Outlet />
}
