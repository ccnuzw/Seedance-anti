import { useState, useEffect, useCallback } from 'react'
import { IPC } from '@shared/ipc-channels'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { useToastStore } from '@renderer/stores/toastStore'
import EpisodeNav from '@renderer/components/layout/EpisodeNav'
import './PromptPage.css'

interface ParsedPrompt {
  index: number
  title: string
  content: string
  duration: number
  references: Array<{ referenceTag: string; assetType: string }>
}

export default function PromptPage() {
  useProjectSync()
  const { currentProject, episodes, loadEpisodes } = useProjectStore()
  const addToast = useToastStore(s => s.addToast)
  const [currentEp, setCurrentEp] = useState(1)
  const [prompts, setPrompts] = useState<ParsedPrompt[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [rawMd, setRawMd] = useState('')
  const [viewTab, setViewTab] = useState<'prompts' | 'director' | 'art'>('prompts')
  const [tabContent, setTabContent] = useState('')
  const [tabLoading, setTabLoading] = useState(false)

  const epList = episodes.map(e => e.episodeNumber).sort((a, b) => a - b)

  useEffect(() => {
    if (currentProject && episodes.length === 0) {
      loadEpisodes(currentProject.id)
    }
  }, [currentProject])

  useEffect(() => {
    if (currentProject && currentEp > 0) {
      loadPrompts(currentEp)
    }
  }, [currentEp, currentProject])

  const getFilePath = (ep: number, type: 'prompts' | 'director' | 'art' = 'prompts') => {
    if (!currentProject) return ''
    const epStr = String(ep).padStart(2, '0')
    const fileMap = {
      prompts: '02-seedance-prompts.md',
      director: '01-director-analysis.md',
      art: '01.5-art-design-output.md'
    }
    return `${currentProject.projectPath}/outputs/ep${epStr}/${fileMap[type]}`
  }

  const loadPrompts = async (ep: number) => {
    if (!currentProject) return
    setLoading(true)
    setSelectedIndex(null)
    setIsEditing(false)
    try {
      const raw = await window.feicaiAPI.invoke(IPC.FILE_READ, getFilePath(ep, 'prompts')) as string
      setRawMd(raw)
      setPrompts(parsePromptsFromMarkdown(raw))
    } catch {
      setRawMd('')
      setPrompts([])
    }
    setLoading(false)
  }

  const loadTabContent = async (ep: number, tab: 'director' | 'art') => {
    if (!currentProject) return
    setTabLoading(true)
    try {
      const raw = await window.feicaiAPI.invoke(IPC.FILE_READ, getFilePath(ep, tab)) as string
      setTabContent(raw)
    } catch {
      setTabContent('')
    }
    setTabLoading(false)
  }

  useEffect(() => {
    if (viewTab !== 'prompts' && currentProject && currentEp > 0) {
      loadTabContent(currentEp, viewTab)
    }
  }, [viewTab, currentEp, currentProject])

  const handleSave = useCallback(async () => {
    if (!currentProject) return
    try {
      await window.feicaiAPI.invoke(IPC.FILE_WRITE, getFilePath(currentEp, 'prompts'), rawMd)
      setPrompts(parsePromptsFromMarkdown(rawMd))
      setIsEditing(false)
      addToast('success', '提示词已保存')
    } catch {
      addToast('error', '保存失败')
    }
  }, [currentProject, currentEp, rawMd, addToast])

  const handleReReview = useCallback(async () => {
    if (!currentProject) return
    try {
      await window.feicaiAPI.invoke(IPC.PIPELINE_START, {
        projectId: currentProject.id,
        projectPath: currentProject.projectPath,
        episodeNum: currentEp,
        projectName: currentProject.name,
        visualStyle: currentProject.visualStyle,
        targetMedium: currentProject.targetMedium,
        startStage: 'storyboard',
        singleStage: true
      })
      addToast('info', '已启动分镜重新审核')
    } catch {
      addToast('error', '启动审核失败')
    }
  }, [currentProject, currentEp, addToast])

  const handleEpClick = (ep: number) => {
    setCurrentEp(ep)
  }

  const actualPrompts = prompts.filter(p => p.index > 0)
  const totalDuration = actualPrompts.reduce((sum, p) => sum + p.duration, 0)
  const durationOk = totalDuration >= 90 && totalDuration <= 120

  return (
    <div className="prompt-page">
      {/* 集数卡片导航 */}
      <EpisodeNav
        episodes={episodes}
        currentEp={currentEp}
        onSelect={handleEpClick}
      />

      {/* 产物 Tab 切换 */}
      <div className="prompt-tabs">
        <button className={`tab-btn ${viewTab === 'prompts' ? 'active' : ''}`} onClick={() => setViewTab('prompts')}>
          📐 提示词
        </button>
        <button className={`tab-btn ${viewTab === 'director' ? 'active' : ''}`} onClick={() => setViewTab('director')}>
          🎬 导演分析
        </button>
        <button className={`tab-btn ${viewTab === 'art' ? 'active' : ''}`} onClick={() => setViewTab('art')}>
          🎨 服化道设计
        </button>
      </div>

      {/* 产物内容 */}
      {viewTab === 'prompts' ? (
        <>
      {/* 统计头部 */}
      <div className="prompt-header">
        <div className="prompt-header-info">
          <h2>📐 EP{String(currentEp).padStart(2, '0')} 提示词</h2>
          <div className="prompt-stats text-secondary">
            {actualPrompts.length} 条提示词
          </div>
        </div>
        <div className="prompt-actions">
          {!isEditing ? (
            <>
              <button className="btn btn-sm" onClick={() => setIsEditing(true)} disabled={prompts.length === 0}>
                ✏️ 编辑
              </button>
              <button className="btn btn-sm" onClick={handleReReview} disabled={prompts.length === 0}>
                🔄 重新审核
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-sm btn-primary" onClick={handleSave}>
                💾 保存
              </button>
              <button className="btn btn-sm" onClick={() => { setIsEditing(false); loadPrompts(currentEp) }}>
                ❌ 取消
              </button>
            </>
          )}
        </div>
        <div className="prompt-duration-bar">
          <div className="duration-label">
            <span className={durationOk ? 'text-success' : 'text-warning'}>
              ⏱ {totalDuration}s
            </span>
            <span className="text-secondary"> / 90-120s</span>
          </div>
          <div className="duration-track">
            <div
              className={`duration-fill ${durationOk ? 'ok' : 'warn'}`}
              style={{ width: `${Math.min((totalDuration / 120) * 100, 100)}%` }}
            />
            <div className="duration-marker" style={{ left: '75%' }} />
            <div className="duration-marker" style={{ left: '100%' }} />
          </div>
        </div>
      </div>

      {/* 提示词内容 */}
      {isEditing ? (
        <div className="prompt-editor">
          <textarea
            className="prompt-editor-textarea"
            value={rawMd}
            onChange={e => setRawMd(e.target.value)}
            spellCheck={false}
          />
        </div>
      ) : (
      <div className="prompt-cards">
        {loading ? (
          <div className="prompt-empty text-secondary">加载中...</div>
        ) : prompts.length === 0 ? (
          <div className="prompt-empty text-secondary">
            该集暂无提示词。请先在流水线中执行分镜阶段。
          </div>
        ) : (
          prompts.map((prompt) => {
            const isRefTable = prompt.index === 0
            return (
            <div
              key={prompt.index}
              className={`card prompt-card ${isRefTable ? 'prompt-card-ref-table' : ''} ${selectedIndex === prompt.index ? 'selected' : ''}`}
              onClick={() => setSelectedIndex(prompt.index)}
            >
              <div className="prompt-card-header">
                <span className={`prompt-index ${isRefTable ? 'prompt-index-ref' : ''}`}>
                  {isRefTable ? '📋 P00' : `P${String(prompt.index).padStart(2, '0')}`}
                </span>
                <span className="prompt-title text-secondary">{prompt.title}</span>
                {!isRefTable && (
                <span className={`prompt-duration badge ${prompt.duration > 10 ? 'badge-warning' : 'badge-info'}`}>
                  {prompt.duration}s
                </span>
                )}
              </div>
              <div className="prompt-card-body">
                <p className="prompt-content">{prompt.content}</p>
              </div>
              {prompt.references.length > 0 && (
                <div className="prompt-refs">
                  {prompt.references.map((ref, i) => (
                    <span
                      key={i}
                      className={`prompt-ref-tag ${ref.assetType === 'character' ? 'ref-char' : 'ref-scene'}`}
                    >
                      {ref.referenceTag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            )
          })
        )}
      </div>
      )}
        </>
      ) : (
        /* 导演分析 / 服化道 Markdown 查看 */
        <div className="product-viewer">
          <div className="product-viewer-header">
            <h2>{viewTab === 'director' ? '🎬' : '🎨'} EP{String(currentEp).padStart(2, '0')} {viewTab === 'director' ? '导演分析' : '服化道设计'}</h2>
          </div>
          {tabLoading ? (
            <div className="prompt-empty text-secondary">加载中...</div>
          ) : tabContent ? (
            <pre className="product-content">{tabContent}</pre>
          ) : (
            <div className="prompt-empty text-secondary">
              该集暂无{viewTab === 'director' ? '导演分析' : '服化道设计'}产物。请先在流水线中执行对应阶段。
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function parsePromptsFromMarkdown(raw: string): ParsedPrompt[] {
  const prompts: ParsedPrompt[] = []
  const sections = raw.split(/^## /m).slice(1)

  sections.forEach((section, idx) => {
    const lines = section.trim().split('\n')
    const title = lines[0]?.trim() || `提示词 ${idx + 1}`

    const durationMatch = section.match(/时长[：:]\s*(\d+)\s*[秒s]/i)
      || section.match(/(\d+)\s*[秒s]/i)
    const duration = durationMatch ? parseInt(durationMatch[1]) : 5

    const contentLines = lines.slice(1)
      .filter(l => !l.startsWith('**') && l.trim().length > 0)
    const content = contentLines.join('\n').trim()

    const references: ParsedPrompt['references'] = []
    const refMatches = section.matchAll(/@(图片\d+|场景图\d+)/g)
    for (const m of refMatches) {
      references.push({
        referenceTag: m[0],
        assetType: m[1].startsWith('场景') ? 'scene' : 'character'
      })
    }

    if (content.length > 0) {
      prompts.push({ index: idx, title, content, duration, references })
    }
  })

  return prompts
}
