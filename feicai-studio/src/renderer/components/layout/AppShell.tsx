import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import ToastContainer from './ToastContainer'
import TaskCenter from '@renderer/components/pipeline/TaskCenter'
import { DevProfiler } from '@renderer/dev/render-profiler'

export default function AppShell() {
  const location = useLocation()

  return (
    <DevProfiler id="AppShell">
      <>
        <div className="app-layout">
          <Sidebar />
          <div className="app-main">
            <Header pathname={location.pathname} />
            <TaskCenter />
            <div className="app-content">
              <Outlet />
            </div>
            <ToastContainer />
          </div>
        </div>
      </>
    </DevProfiler>
  )
}
