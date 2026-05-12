import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import ProjectRouteSync from './components/layout/ProjectRouteSync'
import LoadingSpinner from './components/layout/LoadingSpinner'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const ProjectPage = lazy(() => import('./pages/ProjectPage'))
const PipelinePage = lazy(() => import('./pages/PipelinePage'))
const AssetPage = lazy(() => import('./pages/AssetPage'))
const PromptPage = lazy(() => import('./pages/PromptPage'))
const SourceEditorPage = lazy(() => import('./pages/SourceEditorPage'))
const StoryBeatEditorPage = lazy(() => import('./pages/StoryBeatEditorPage'))
const ScriptEditorPage = lazy(() => import('./pages/ScriptEditorPage'))
const ReviewPage = lazy(() => import('./pages/ReviewPage'))
const BatchPage = lazy(() => import('./pages/BatchPage'))
const ProjectHealthPage = lazy(() => import('./pages/ProjectHealthPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingSpinner size="lg" text="页面加载中..." />}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/project/:id" element={<ProjectRouteSync />}>
              <Route index element={<ProjectPage />} />
              <Route path="pipeline" element={<PipelinePage />} />
              <Route path="assets" element={<AssetPage />} />
              <Route path="prompts" element={<PromptPage />} />
              <Route path="source" element={<SourceEditorPage />} />
              <Route path="story" element={<StoryBeatEditorPage />} />
              <Route path="script" element={<ScriptEditorPage />} />
              <Route path="review" element={<ReviewPage />} />
              <Route path="batch" element={<BatchPage />} />
              <Route path="health" element={<ProjectHealthPage />} />
            </Route>
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
