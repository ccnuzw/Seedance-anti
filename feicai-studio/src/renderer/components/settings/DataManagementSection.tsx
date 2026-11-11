import { useEffect, useState } from 'react'
import type { Project } from '@shared/types'
import type { DataManagementResult } from '@shared/data-management'

interface Props {
  onReset: () => void
}

export function DataManagementSection({ onReset }: Props) {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    window.feicaiAPI
      .listProjects()
      .then((items) => {
        if (!active) return
        setProjects(items)
        setProjectId(items[0]?.id || '')
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : '项目列表读取失败'
          )
      })
    return () => {
      active = false
    }
  }, [])

  async function run(
    action: () => Promise<DataManagementResult>,
    reload = false
  ): Promise<void> {
    if (busy) return
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const result = await action()
      setMessage(
        result.path ? `${result.message}：${result.path}` : result.message
      )
      if (!result.canceled) {
        if (reload) window.location.reload()
        else {
          const items = await window.feicaiAPI.listProjects()
          setProjects(items)
          if (result.projectId) setProjectId(result.projectId)
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '数据管理操作失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="settings-section">
      <div className="section-header">
        <h2>📂 数据管理</h2>
      </div>
      <div className="card">
        <div className="setting-row">
          <label className="setting-label" htmlFor="data-project">
            <span className="setting-name">项目备份与恢复</span>
            <span className="setting-desc text-secondary">
              完整保存原稿与产物；恢复到新目录，不覆盖原项目。运行任务期间不可操作。
            </span>
          </label>
          <div className="setting-control">
            <select
              id="data-project"
              value={projectId}
              disabled={busy || projects.length === 0}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {projects.length === 0 && <option value="">暂无项目</option>}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <button
              className="btn btn-sm"
              disabled={busy || !projectId}
              onClick={() =>
                void run(() => window.feicaiAPI.backupProject(projectId))
              }
            >
              备份项目
            </button>
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() => void run(() => window.feicaiAPI.restoreProject())}
            >
              恢复项目
            </button>
            <button
              className="btn btn-sm"
              disabled={busy || !projectId}
              onClick={() =>
                void run(() => window.feicaiAPI.rebuildProjectIndex(projectId))
              }
            >
              重建索引
            </button>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-label">
            <span className="setting-name">应用数据库</span>
            <span className="setting-desc text-secondary">
              保存项目索引、审核历史与本机加密凭据，不包含项目正文。仅支持同版本恢复。
            </span>
          </div>
          <div className="setting-control">
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() => void run(() => window.feicaiAPI.backupDatabase())}
            >
              备份数据库
            </button>
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() =>
                void run(() => window.feicaiAPI.restoreDatabase(), true)
              }
            >
              恢复数据库
            </button>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-label">
            <span className="setting-name">诊断与凭据</span>
            <span className="setting-desc text-secondary">
              诊断仅导出事件元数据，不含正文或 Key。清理凭据不会删除模型配置。
            </span>
          </div>
          <div className="setting-control">
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() =>
                void run(() => window.feicaiAPI.exportDiagnosticLogs())
              }
            >
              导出诊断
            </button>
            <button
              className="btn btn-sm btn-danger"
              disabled={busy}
              onClick={() =>
                void run(() => window.feicaiAPI.clearStoredCredentials(), true)
              }
            >
              清理凭据
            </button>
          </div>
        </div>
        {busy && <p role="status">正在处理，请勿移动项目文件或退出应用。</p>}
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="setting-row">
          <div className="setting-label">
            <span className="setting-name">重置外观设置</span>
            <span className="setting-desc text-secondary">
              恢复主题、缩放、侧边栏为默认值
            </span>
          </div>
          <div className="setting-control">
            <button
              className="btn btn-sm btn-danger"
              disabled={busy}
              onClick={onReset}
            >
              🔄 重置
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
