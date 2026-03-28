import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import { IPC } from '@shared/ipc-channels'
import type { PipelineAutomationAlert } from '@shared/types'
import DashboardPage from './pages/DashboardPage'
import Sidebar from './components/layout/Sidebar'
import Header from './components/layout/Header'
import ToastContainer from './components/layout/ToastContainer'
import { useSettingsStore } from './stores/settingsStore'
import { useAdaptStore } from './stores/adaptStore'
import { useToastStore } from './stores/toastStore'
import { resolveLegacyProjectRedirect } from './project-routing'
import { platformAPI } from './platform/api'
import { getWebTransportConfig } from './platform/webTransport'

const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const TaskCenterPage = lazy(() => import('./pages/TaskCenterPage'))
const ProjectWorkspacePage = lazy(() => import('./pages/ProjectWorkspacePage'))
const SourceWorkspacePage = lazy(() => import('./pages/SourceWorkspacePage'))
const ScriptWorkspacePage = lazy(() => import('./pages/ScriptWorkspacePage'))
const ScriptEditorPage = lazy(() => import('./pages/ScriptEditorPage'))
const ProductionWorkspacePage = lazy(() => import('./pages/ProductionWorkspacePage'))
const DeliveryPage = lazy(() => import('./pages/DeliveryPage'))
const ProjectSettingsPage = lazy(() => import('./pages/ProjectSettingsPage'))

function LegacyProjectRedirect({
  target,
  extraParams
}: {
  target: 'workspace' | 'source' | 'script' | 'production' | 'delivery'
  extraParams?: Record<string, string>
}) {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  if (!id) {
    return <Navigate to="/" replace />
  }

  return <Navigate to={resolveLegacyProjectRedirect(id, target, location.search, extraParams)} replace />
}

export default function App() {
  const { addToast } = useToastStore()
  const hasDesktopBridge = platformAPI.isDesktopBridgeAvailable
  const webTransportConfig = !hasDesktopBridge ? getWebTransportConfig() : null

  // 应用启动时加载 LLM 配置，确保编剧管线等功能可获取到已配置的 LLM
  useEffect(() => {
    useSettingsStore.getState().loadLLMConfigs()
    if (!hasDesktopBridge) {
      return
    }
    // 在顶层挂一次监听，让 Adapt 后台任务状态在任意页面都保持同步
    const cleanup = useAdaptStore.getState().setupEventListeners()
    const unsubscribeAlert = platformAPI.on(IPC.PIPELINE_ALERT, (payload: unknown) => {
      const alert = payload as PipelineAutomationAlert
      if (alert.toastNotifications) {
        addToast(
          alert.type === 'run_failed' ? 'error' : 'info',
          alert.message,
          { title: alert.title }
        )
      }
      if (alert.desktopNotifications) {
        try {
          new Notification(alert.title || 'FEICAI Studio', {
            body: alert.message,
            silent: false
          })
        } catch {
          // 忽略桌面通知权限错误
        }
      }
    })

    return () => {
      cleanup()
      unsubscribeAlert()
    }
  }, [addToast, hasDesktopBridge])

  return (
    <>
      <BrowserRouter>
        <div className="app-layout">
          <Sidebar />
          <div className="app-main">
            <Header />
            <div className="app-content">
              {platformAPI.isWebPreview && (
                <div
                  className="card"
                  style={{
                    margin: '0 0 16px',
                    borderColor: 'var(--color-warning)',
                    background: 'color-mix(in srgb, var(--color-warning) 8%, var(--bg-card))'
                  }}
                >
                  <strong>网页预览模式</strong>
                  <p className="text-secondary" style={{ margin: '8px 0 0' }}>
                    {webTransportConfig?.mode === 'remote-http'
                      ? '当前已连接远程 HTTP 后端。网页端可直接使用项目创建、小说导入、任务中心、制作流水线和基础导出。'
                      : '当前可使用浏览器内项目、剧本编辑、项目设置、首页概览和基础导出。小说导入、本地目录访问和后台流水线仍需要桌面端或后续 web 后端。'}
                  </p>
                  <p className="text-secondary" style={{ margin: '8px 0 0' }}>
                    当前 transport：
                    {webTransportConfig?.mode === 'remote-http'
                      ? `远程 HTTP (${webTransportConfig.baseUrl || '未设置 Base URL'})`
                      : '浏览器本地'}
                  </p>
                </div>
              )}
              <Suspense fallback={<div className="text-secondary" style={{ padding: 24 }}>页面模块加载中...</div>}>
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/tasks" element={<TaskCenterPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  {hasDesktopBridge ? (
                    <>
                      <Route path="/project/:id" element={<LegacyProjectRedirect target="workspace" />} />
                      <Route path="/project/:id/workspace" element={<ProjectWorkspacePage />} />
                      <Route path="/project/:id/source" element={<SourceWorkspacePage />} />
                      <Route path="/project/:id/script" element={<ScriptWorkspacePage />} />
                      <Route path="/project/:id/production" element={<ProductionWorkspacePage />} />
                      <Route path="/project/:id/delivery" element={<DeliveryPage />} />
                      <Route path="/project/:id/settings" element={<ProjectSettingsPage />} />
                      <Route path="/project/:id/writing" element={<LegacyProjectRedirect target="workspace" />} />
                      <Route path="/project/:id/writing/source" element={<LegacyProjectRedirect target="source" extraParams={{ tab: 'source' }} />} />
                      <Route path="/project/:id/writing/plan" element={<LegacyProjectRedirect target="source" extraParams={{ tab: 'plan' }} />} />
                      <Route path="/project/:id/writing/scripts" element={<LegacyProjectRedirect target="script" />} />
                      <Route path="/project/:id/writing/qa" element={<LegacyProjectRedirect target="script" extraParams={{ tab: 'issues' }} />} />
                      <Route path="/project/:id/writing/handoff" element={<LegacyProjectRedirect target="delivery" />} />
                      <Route path="/project/:id/novel" element={<LegacyProjectRedirect target="source" extraParams={{ tab: 'source' }} />} />
                      <Route path="/project/:id/breakdown" element={<LegacyProjectRedirect target="source" extraParams={{ tab: 'plan' }} />} />
                      <Route path="/project/:id/adapt-script" element={<LegacyProjectRedirect target="script" />} />
                      <Route path="/project/:id/pipeline" element={<LegacyProjectRedirect target="production" extraParams={{ tab: 'pipeline' }} />} />
                      <Route path="/project/:id/assets" element={<LegacyProjectRedirect target="production" extraParams={{ tab: 'assets' }} />} />
                      <Route path="/project/:id/prompts" element={<LegacyProjectRedirect target="production" extraParams={{ tab: 'prompts' }} />} />
                      <Route path="/project/:id/review" element={<LegacyProjectRedirect target="production" extraParams={{ tab: 'review' }} />} />
                      <Route path="/project/:id/batch" element={<LegacyProjectRedirect target="production" extraParams={{ tab: 'batch' }} />} />
                    </>
                  ) : (
                    <>
                      <Route path="/project/:id" element={<LegacyProjectRedirect target="workspace" />} />
                      <Route path="/project/:id/workspace" element={<ProjectWorkspacePage />} />
                      <Route path="/project/:id/source" element={<SourceWorkspacePage />} />
                      <Route path="/project/:id/script" element={<ScriptEditorPage />} />
                      <Route path="/project/:id/production" element={<ProductionWorkspacePage />} />
                      <Route path="/project/:id/delivery" element={<DeliveryPage />} />
                      <Route path="/project/:id/settings" element={<ProjectSettingsPage />} />
                      <Route path="/project/:id/writing" element={<LegacyProjectRedirect target="workspace" />} />
                      <Route path="/project/:id/writing/scripts" element={<LegacyProjectRedirect target="script" />} />
                      <Route path="/project/:id/writing/handoff" element={<LegacyProjectRedirect target="delivery" />} />
                      <Route path="/project/:id/adapt-script" element={<LegacyProjectRedirect target="script" />} />
                      <Route path="/project/:id/source/*" element={<SourceWorkspacePage />} />
                      <Route path="/project/:id/pipeline" element={<LegacyProjectRedirect target="production" extraParams={{ tab: 'pipeline' }} />} />
                      <Route path="/project/:id/assets" element={<LegacyProjectRedirect target="production" extraParams={{ tab: 'assets' }} />} />
                      <Route path="/project/:id/prompts" element={<LegacyProjectRedirect target="production" extraParams={{ tab: 'prompts' }} />} />
                      <Route path="/project/:id/review" element={<LegacyProjectRedirect target="production" extraParams={{ tab: 'review' }} />} />
                      <Route path="/project/:id/batch" element={<LegacyProjectRedirect target="production" extraParams={{ tab: 'batch' }} />} />
                      <Route path="/project/:id/production/*" element={<ProductionWorkspacePage />} />
                      <Route path="/project/:id/*" element={<LegacyProjectRedirect target="workspace" />} />
                    </>
                  )}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </div>
          </div>
        </div>
      </BrowserRouter>
      <ToastContainer />
    </>
  )
}
