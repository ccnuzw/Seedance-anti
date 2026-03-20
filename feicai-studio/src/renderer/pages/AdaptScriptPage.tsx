import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useAdaptStore } from '@renderer/stores/adaptStore'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import { IPC } from '@shared/ipc-channels'
import SimpleMarkdown from '@renderer/components/SimpleMarkdown'
import EmptyState from '@renderer/components/layout/EmptyState'
import './AdaptScriptPage.css'

interface ScriptFile {
  episode: number
  filename: string
  title: string
  preview: string
  fullContent: string
  // 新增元数据
  sceneCount: number
  dialogCount: number
  charCount: number
}

function extractScriptMeta(content: string): { sceneCount: number; dialogCount: number; charCount: number } {
  // 场景标记：※ 开头
  const sceneCount = (content.match(/^※/gm) || []).length
  // 对白数量：角色名（情绪）：对白
  const dialogCount = (content.match(/^.+?[（(].+?[)）][：:]/gm) || []).length
  // 字数
  const charCount = content.replace(/\s/g, '').length
  return { sceneCount, dialogCount, charCount }
}

export default function AdaptScriptPage() {
  const navigate = useNavigate()
  const { currentProject } = useProjectStore()
  const { waterLevel, adaptState, isRunning, streamOutput, logs, error,
    fetchStatus, initAdapt, startScript, pause, abort, clearStream, reScript, revise,
    setupEventListeners } = useAdaptStore()
  const { getDefaultConfig } = useSettingsStore()
  const [scripts, setScripts] = useState<ScriptFile[]>([])
  const [selectedScript, setSelectedScript] = useState<string | null>(null)
  const [reviseTarget, setReviseTarget] = useState<number | null>(null)
  const [reviseNotes, setReviseNotes] = useState('')

  useEffect(() => {
    if (currentProject) {
      fetchStatus(currentProject.projectPath)
      loadScripts()
    }
  }, [currentProject])

  // 设置 IPC 事件监听（引用计数，页面卸载时清理）
  useEffect(() => {
    const cleanup = setupEventListeners()
    return cleanup
  }, [])

  const loadScripts = async () => {
    if (!currentProject) return
    try {
      const scriptDir = `${currentProject.projectPath}/script`
      // 先列出目录，只读取实际存在的文件
      const files = await window.feicaiAPI.invoke(IPC.FILE_READDIR, scriptDir) as string[]
      const epFiles = files
        .filter((f: string) => /^ep\d+\.md$/.test(f))
        .sort()

      const found: ScriptFile[] = []
      for (const filename of epFiles) {
        const epMatch = filename.match(/^ep(\d+)\.md$/)
        if (!epMatch) continue
        const epNum = parseInt(epMatch[1])
        try {
          const content = await window.feicaiAPI.invoke(
            IPC.FILE_READ, `${scriptDir}/${filename}`
          ) as string | null
          if (!content) continue
          const titleMatch = content.match(/# 第\d+集[：:](.+)/)
          const meta = extractScriptMeta(content)
          found.push({
            episode: epNum,
            filename,
            title: titleMatch?.[1]?.trim() || `第${epNum}集`,
            preview: content.substring(0, 200),
            fullContent: content,
            ...meta
          })
        } catch { /* 读取失败 */ }
      }
      setScripts(found)
    } catch { /* ignore */ }
  }

  const handleViewScript = async (script: ScriptFile) => {
    setSelectedScript(script.fullContent)
  }

  const handleCreateScript = async (count: number) => {
    if (!currentProject) return
    const llmConfig = getDefaultConfig('llm')
    if (!llmConfig) {
      alert('请先在设置中配置 LLM')
      return
    }
    if (adaptState === 'adapt_idle') {
      await initAdapt(currentProject.id, currentProject.projectPath, llmConfig)
    }
    clearStream()
    await startScript(count)
    await loadScripts()
  }

  const handleLaunchPipeline = (episode: number) => {
    if (!currentProject) return
    navigate(`/project/${currentProject.id}/pipeline?ep=${episode}`)
  }

  const handleReCreate = async (episode: number) => {
    if (!currentProject) return
    const llmConfig = getDefaultConfig('llm')
    if (!llmConfig) {
      alert('请先在设置中配置 LLM')
      return
    }
    if (adaptState === 'adapt_idle') {
      await initAdapt(currentProject.id, currentProject.projectPath, llmConfig)
    }
    clearStream()
    await reScript(episode)
    await loadScripts()
  }

  const handleRevise = async () => {
    if (!currentProject || !reviseTarget || !reviseNotes.trim()) return
    const llmConfig = getDefaultConfig('llm')
    if (!llmConfig) {
      alert('请先在设置中配置 LLM')
      return
    }
    if (adaptState === 'adapt_idle') {
      await initAdapt(currentProject.id, currentProject.projectPath, llmConfig)
    }
    clearStream()
    await revise(reviseTarget, reviseNotes)
    setReviseTarget(null)
    setReviseNotes('')
    await loadScripts()
  }

  if (!currentProject) {
    return <div className="adapt-script-page"><p>请先选择一个项目</p></div>
  }

  return (
    <div className="adapt-script-page">
      <div className="page-header">
        <h1 className="page-title">✍️ 剧本创作</h1>
        <div className="flex gap-sm">
          <button
            className="btn btn-primary"
            disabled={isRunning || (waterLevel?.unusedPlots || 0) === 0}
            onClick={() => handleCreateScript(1)}
          >
            ✍️ 创作一批
          </button>
          <button
            className="btn"
            disabled={isRunning || (waterLevel?.unusedPlots || 0) === 0}
            onClick={() => handleCreateScript(3)}
          >
            ✍️ × 3 批量
          </button>
          {isRunning && (
            <>
              <button className="btn" onClick={pause}>⏸</button>
              <button className="btn" onClick={abort}>⏹</button>
            </>
          )}
        </div>
      </div>

      {/* 状态信息 */}
      <div className="water-level-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="water-level-card">
          <div className="wl-value wl-primary">{waterLevel?.unusedPlots || 0}</div>
          <div className="wl-label">可用剧情点</div>
        </div>
        <div className="water-level-card">
          <div className="wl-value wl-success">{scripts.length}</div>
          <div className="wl-label">已创作剧本</div>
        </div>
        <div className="water-level-card">
          <div className="wl-value wl-primary">{waterLevel?.completedEpisodes || 0}</div>
          <div className="wl-label">已完成集数</div>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="card card-error mb-lg">
          <p className="text-error">❌ {error}</p>
        </div>
      )}

      {/* 修订对话框 */}
      {reviseTarget !== null && (
        <div className="card mb-lg p-lg">
          <h3 className="mb-md">📝 修订第{reviseTarget}集</h3>
          <textarea
            value={reviseNotes}
            onChange={e => setReviseNotes(e.target.value)}
            placeholder="输入修改意见，例如：把第二场景的对话改得更紧凑，加强悬念感"
            style={{
              width: '100%', minHeight: '100px', padding: 'var(--spacing-sm)',
              borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
              background: 'var(--card-bg)', color: 'var(--text-primary)', resize: 'vertical',
              fontFamily: 'inherit', fontSize: 'var(--font-size-sm)'
            }}
          />
          <div className="flex gap-sm mt-sm">
            <button className="btn btn-primary" disabled={!reviseNotes.trim() || isRunning} onClick={handleRevise}>
              ✅ 提交修订
            </button>
            <button className="btn" onClick={() => { setReviseTarget(null); setReviseNotes('') }}>
              取消
            </button>
          </div>
        </div>
      )}

      {/* LLM 流式输出 */}
      {(streamOutput || isRunning) && (
        <>
          <h3 className="mb-sm">📝 LLM 输出</h3>
          <div className="stream-output" style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--spacing-md)',
            maxHeight: '300px',
            overflow: 'auto',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--font-size-sm)',
            whiteSpace: 'pre-wrap',
            marginBottom: 'var(--spacing-lg)'
          }}>
            {streamOutput}
          </div>
        </>
      )}

      {/* 剧本预览（Markdown 渲染） */}
      {selectedScript && (
        <>
          <div className="flex justify-between items-center mb-sm">
            <h3>📖 剧本预览</h3>
            <button className="btn btn-sm" onClick={() => setSelectedScript(null)}>✕ 关闭</button>
          </div>
          <div className="script-preview-enhanced">
            <SimpleMarkdown content={selectedScript} scriptMode />
          </div>
        </>
      )}

      {/* 剧本卡片列表 */}
      <h3 className="mb-md">
        📚 已创作剧本 ({scripts.length})
      </h3>

      {scripts.length === 0 ? (
        <EmptyState
          icon="📝"
          title="暂无已创作剧本"
          description={(waterLevel?.unusedPlots || 0) > 0
            ? '有可用剧情点，点击「创作一批」开始'
            : '暂无可用剧情点，请先在拆解页面执行拆解'}
        />
      ) : (
        <div className="script-list">
          {scripts.map(script => (
            <div key={script.episode} className="script-card" onClick={() => handleViewScript(script)}>
              <div className="script-card-header">
                <span className="script-card-num">EP{String(script.episode).padStart(3, '0')}</span>
                <div className="flex gap-xs">
                  <button
                    className="btn btn-sm"
                    title="修订"
                    disabled={isRunning}
                    onClick={(e) => { e.stopPropagation(); setReviseTarget(script.episode) }}
                  >
                    📝
                  </button>
                  <button
                    className="btn btn-sm"
                    title="重新创作"
                    disabled={isRunning}
                    onClick={(e) => { e.stopPropagation(); handleReCreate(script.episode) }}
                  >
                    🔄
                  </button>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={(e) => { e.stopPropagation(); handleLaunchPipeline(script.episode) }}
                  >
                    ▶ 管线
                  </button>
                </div>
              </div>
              <div className="script-card-title">{script.title}</div>

              {/* 元数据标签 */}
              <div className="script-meta-tags">
                <span className="meta-tag meta-tag-scene">📍 {script.sceneCount} 场景</span>
                <span className="meta-tag meta-tag-dialog">💬 {script.dialogCount} 对白</span>
                <span className="meta-tag meta-tag-chars">📝 {script.charCount} 字</span>
              </div>

              <div className="script-card-meta">
                {script.preview.substring(0, 80)}...
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
