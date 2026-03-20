import { useEffect } from 'react'
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
import NovelPage from './pages/NovelPage'
import BreakdownPage from './pages/BreakdownPage'
import AdaptScriptPage from './pages/AdaptScriptPage'
import Sidebar from './components/layout/Sidebar'
import Header from './components/layout/Header'
import ToastContainer from './components/layout/ToastContainer'
import { useSettingsStore } from './stores/settingsStore'

export default function App() {
  // 应用启动时加载 LLM 配置，确保编剧管线等功能可获取到已配置的 LLM
  useEffect(() => {
    useSettingsStore.getState().loadLLMConfigs()
  }, [])
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
                <Route path="/project/:id/novel" element={<NovelPage />} />
                <Route path="/project/:id/breakdown" element={<BreakdownPage />} />
                <Route path="/project/:id/adapt-script" element={<AdaptScriptPage />} />
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

