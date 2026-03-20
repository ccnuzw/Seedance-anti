import { useState, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { IPC } from '@shared/ipc-channels'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { useToastStore } from '@renderer/stores/toastStore'
import EpisodeNav from '@renderer/components/layout/EpisodeNav'
import './ScriptEditorPage.css'

export default function ScriptEditorPage() {
  useProjectSync()
  const { currentProject, episodes, loadEpisodes } = useProjectStore()
  const { addToast } = useToastStore()
  const [currentEp, setCurrentEp] = useState(1)
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState(true)
  const [loading, setLoading] = useState(true)

  const epList = episodes.map(e => e.episodeNumber).sort((a, b) => a - b)

  // 确保 episodes 已加载
  useEffect(() => {
    if (currentProject && episodes.length === 0) {
      loadEpisodes(currentProject.id)
    }
  }, [currentProject])

  // 切换集数时加载剧本
  useEffect(() => {
    if (currentProject && currentEp > 0) {
      loadScript(currentEp)
    }
  }, [currentEp, currentProject])

  const loadScript = async (ep: number) => {
    if (!currentProject) return
    setLoading(true)
    try {
      const epStr = String(ep).padStart(3, '0')
      const filePath = `${currentProject.projectPath}/script/ep${epStr}.md`
      const text = await window.feicaiAPI.invoke(IPC.FILE_READ, filePath) as string | null
      if (!text) throw new Error('文件不存在')
      setContent(text)
    } catch {
      setContent('<!-- 剧本文件不存在，请先导入剧本到 script/ 目录 -->\n')
      addToast('warning', `EP${String(ep).padStart(3, '0')} 剧本文件不存在`)
    }
    setLoading(false)
    setSaved(true)
  }

  const handleSave = async () => {
    if (!currentProject) return
    try {
      const epStr = String(currentEp).padStart(3, '0')
      const filePath = `${currentProject.projectPath}/script/ep${epStr}.md`
      await window.feicaiAPI.invoke(IPC.FILE_WRITE, filePath, content)
      setSaved(true)
      addToast('success', '剧本已保存')
    } catch {
      addToast('error', '保存失败')
    }
  }

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
          {!saved && <span className="editor-unsaved badge badge-warning">未保存</span>}
        </div>
        <div className="editor-actions">
          <button className="btn btn-sm" onClick={() => loadScript(currentEp)}>↻ 重新加载</button>
          <button
            className="btn btn-sm btn-primary"
            onClick={handleSave}
            disabled={saved}
          >
            💾 保存 (⌘S)
          </button>
        </div>
      </div>

      {/* Monaco 编辑器 */}
      <div className="editor-container monaco-wrapper">
        <Editor
          height="100%"
          language="markdown"
          theme="vs-dark"
          value={content}
          onChange={handleEditorChange}
          loading={<div className="text-secondary" style={{ padding: 16 }}>编辑器加载中...</div>}
          options={{
            minimap: { enabled: false },
            fontSize: 16,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            lineNumbers: 'on',
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            padding: { top: 12, bottom: 12 },
            renderWhitespace: 'none',
            automaticLayout: true,
            tabSize: 2
          }}
        />
      </div>
    </div>
  )
}
