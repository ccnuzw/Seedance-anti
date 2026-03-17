import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import ProjectPage from './pages/ProjectPage'
import PipelinePage from './pages/PipelinePage'
import AssetPage from './pages/AssetPage'
import PromptPage from './pages/PromptPage'
import ScriptEditorPage from './pages/ScriptEditorPage'
import ReviewPage from './pages/ReviewPage'
import BatchPage from './pages/BatchPage'
import SettingsPage from './pages/SettingsPage'
import Sidebar from './components/layout/Sidebar'
import Header from './components/layout/Header'
import ToastContainer from './components/layout/ToastContainer'

export default function App() {
  return (
    <>
      <BrowserRouter>
        <div className="app-layout">
          <Sidebar />
          <div className="app-main">
            <Header />
            <div className="app-content">
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/project/:id" element={<ProjectPage />} />
                <Route path="/project/:id/pipeline" element={<PipelinePage />} />
                <Route path="/project/:id/assets" element={<AssetPage />} />
                <Route path="/project/:id/prompts" element={<PromptPage />} />
                <Route path="/project/:id/script" element={<ScriptEditorPage />} />
                <Route path="/project/:id/review" element={<ReviewPage />} />
                <Route path="/project/:id/batch" element={<BatchPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </div>
        </div>
      </BrowserRouter>
      <ToastContainer />
    </>
  )
}
