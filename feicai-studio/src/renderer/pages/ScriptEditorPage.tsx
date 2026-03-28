import { Suspense, lazy, useState, useEffect, useRef, useCallback } from 'react'
import { IPC } from '@shared/ipc-channels'
import { platformAPI } from '@renderer/platform/api'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { useToastStore } from '@renderer/stores/toastStore'
import EpisodeNav from '@renderer/components/layout/EpisodeNav'
import './ScriptEditorPage.css'

const MonacoMarkdownEditor = lazy(() => import('@renderer/components/editor/MonacoMarkdownEditor'))

interface LoadScriptOptions {
  preserveOnError?: boolean
}

export default function ScriptEditorPage() {
  useProjectSync()
  const { currentProject, episodes, loadEpisodes, syncEpisodeStatus } = useProjectStore()
  const { addToast } = useToastStore()
  const [currentEp, setCurrentEp] = useState(1)
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const scriptLoadTokenRef = useRef(0)

  const epList = episodes.map(e => e.episodeNumber).sort((a, b) => a - b)

  // 确保 episodes 已加载
  useEffect(() => {
    if (currentProject && episodes.length === 0) {
      loadEpisodes(currentProject.id)
    }
  }, [currentProject?.id, episodes.length, loadEpisodes])

  useEffect(() => {
    scriptLoadTokenRef.current += 1
    setContent('')
    setSaved(true)
    setLoading(true)
    if (epList.length > 0) {
      setCurrentEp((prev) => (epList.includes(prev) ? prev : epList[0]))
    } else {
      setCurrentEp(1)
    }
  }, [currentProject?.id, episodes.length])

  // 切换集数时加载剧本
  useEffect(() => {
    if (currentProject && currentEp > 0) {
      loadScript(currentProject.id, currentProject.projectPath, currentEp)
    }
  }, [currentEp, currentProject?.id, currentProject?.projectPath])

  const loadScript = useCallback(async (
    projectId?: string,
    projectPath?: string,
    ep?: number,
    options?: LoadScriptOptions
  ): Promise<boolean> => {
    if (!projectId || !projectPath || !ep) return false
    const requestToken = ++scriptLoadTokenRef.current
    let loaded = false
    setLoading(true)
    try {
      const text = await platformAPI.invoke(
        IPC.SCRIPT_READ_EPISODE,
        projectPath,
        ep
      ) as string | null
      if (scriptLoadTokenRef.current !== requestToken || useProjectStore.getState().currentProject?.id !== projectId) {
        return false
      }
      if (!text) throw new Error('文件不存在')
      setContent(text)
      loaded = true
    } catch {
      if (scriptLoadTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === projectId) {
        if (options?.preserveOnError) return false
        setContent('<!-- 剧本文件不存在，请先导入剧本到 script/ 目录 -->\n')
        addToast('warning', `EP${String(ep).padStart(3, '0')} 剧本文件不存在`)
      }
    } finally {
      if (scriptLoadTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === projectId) {
        setLoading(false)
        setSaved(true)
      }
    }
    return loaded
  }, [addToast])

  const handleReload = useCallback(async () => {
    const reloaded = await loadScript(currentProject?.id, currentProject?.projectPath, currentEp, { preserveOnError: true })
    if (!reloaded) {
      addToast('warning', `EP${String(currentEp).padStart(3, '0')} 重新加载失败，已保留当前内容`)
    }
  }, [currentProject, currentEp, loadScript, addToast])

  const handleSave = useCallback(async () => {
    if (!currentProject || saving) return
    setSaving(true)
    try {
      await platformAPI.invoke(
        IPC.SCRIPT_SAVE_EPISODE,
        currentProject.projectPath,
        currentEp,
        content
      )
      setSaved(true)
      addToast('success', '剧本已保存')
      if (useProjectStore.getState().currentProject?.id === currentProject.id) {
        await syncEpisodeStatus()
      }
    } catch (e) {
      addToast('error', `保存失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }, [currentProject, currentEp, content, saving, syncEpisodeStatus, addToast])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey
      if (isMeta && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!saved) handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saved, handleSave])

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      setContent(value)
      setSaved(false)
    }
  }

  const handleEpSwitch = (ep: number) => {
    if (!saved) {
      if (!confirm(`EP${String(currentEp).padStart(3, '0')} 有未保存的修改，确定切换？`)) return
    }
    setCurrentEp(ep)
  }

  return (
    <div className="script-editor-page">
      {/* 集数卡片导航 */}
      <EpisodeNav
        episodes={episodes}
        currentEp={currentEp}
        onSelect={handleEpSwitch}
        isDone={(ep) => ep.hasScript}
      />

      {/* 工具栏 */}
      <div className="editor-toolbar">
        <div className="editor-info">
          <span className="editor-episode">📖 EP{String(currentEp).padStart(3, '0')}</span>
          <span className="text-secondary">{content.split('\n').length} 行</span>
          {loading && <span className="text-secondary">加载中...</span>}
          {!saved && <span className="editor-unsaved badge badge-warning">未保存</span>}
        </div>
        <div className="editor-actions">
          <button className="btn btn-sm" onClick={handleReload} disabled={loading || saving}>↻ 重新加载</button>
          <button
            className="btn btn-sm btn-primary"
            onClick={handleSave}
            disabled={saved || saving || loading}
          >
            {saving ? '⏳ 保存中...' : '💾 保存 (⌘S)'}
          </button>
        </div>
      </div>

      {/* Monaco 编辑器 */}
      <div className="editor-container monaco-wrapper">
        <Suspense fallback={<div className="text-secondary" style={{ padding: 16 }}>编辑器模块加载中...</div>}>
          <MonacoMarkdownEditor
            value={content}
            onChange={handleEditorChange}
          />
        </Suspense>
      </div>
    </div>
  )
}
