import {
  createHashRouter,
  createRoutesFromElements,
  RouterProvider,
  Route,
  Navigate
} from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import ProjectRouteSync from './components/layout/ProjectRouteSync'
import DocumentNavigationGuard from './components/editor/DocumentNavigationGuard'
import { retryablePage } from './components/editor/RetryablePage'

const DashboardPage = retryablePage(() => import('./pages/DashboardPage'))
const ProjectPage = retryablePage(() => import('./pages/ProjectPage'))
const PipelinePage = retryablePage(() => import('./pages/PipelinePage'))
const AssetPage = retryablePage(() => import('./pages/AssetPage'))
const PromptPage = retryablePage(() => import('./pages/PromptPage'))
const SourceEditorPage = retryablePage(() => import('./pages/SourceEditorPage'))
const StoryBeatEditorPage = retryablePage(
  () => import('./pages/StoryBeatEditorPage')
)
const ScriptEditorPage = retryablePage(() => import('./pages/ScriptEditorPage'))
const ReviewPage = retryablePage(() => import('./pages/ReviewPage'))
const BatchPage = retryablePage(() => import('./pages/BatchPage'))
const ProjectHealthPage = retryablePage(
  () => import('./pages/ProjectHealthPage')
)
const SettingsPage = retryablePage(() => import('./pages/SettingsPage'))

// Data hash routing works under Electron file:// and supports blockers for POP as well as links.
const router = createHashRouter(
  createRoutesFromElements(
    <Route element={<DocumentNavigationGuard />}>
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
    </Route>
  )
)

export default function App() {
  return <RouterProvider router={router} />
}
