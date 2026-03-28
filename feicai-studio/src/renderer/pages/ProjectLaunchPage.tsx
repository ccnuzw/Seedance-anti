import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { IPC } from '@shared/ipc-channels'
import { NOVEL_GENRES, type EpisodeOutlineItem } from '@shared/types'
import { buildProjectRoute } from '@renderer/project-routing'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useAdaptStore } from '@renderer/stores/adaptStore'
import { useToastStore } from '@renderer/stores/toastStore'
import { platformAPI } from '@renderer/platform/api'
import EmptyState from '@renderer/components/layout/EmptyState'
import './ProjectLaunchPage.css'

const MonacoMarkdownEditor = lazy(() => import('@renderer/components/editor/MonacoMarkdownEditor'))

interface ChapterContent {
  chapterNum: number
  title: string
  content: string
}

interface ScanResult {
  totalChapters: number
  chapterRange: [number, number]
  chapterFiles: string[]
}

function getParentDir(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return lastSlash >= 0 ? filePath.slice(0, lastSlash) : filePath
}

function buildDefaultOutline(totalEpisodes: number, existing: EpisodeOutlineItem[]): EpisodeOutlineItem[] {
  const count = Math.max(totalEpisodes || 1, existing.length || 1)
  const map = new Map(existing.map((item) => [item.episodeNumber, item]))
  return Array.from({ length: count }, (_, index) => {
    const episodeNumber = index + 1
    return map.get(episodeNumber) || {
      episodeNumber,
      title: episodeNumber === 1 ? '故事开场' : `第 ${episodeNumber} 集`,
      summary: ''
    }
  })
}

export default function ProjectLaunchPage() {
  useProjectSync()
  const navigate = useNavigate()
  const { currentProject, episodes, loadEpisodes, saveProjectConfig, syncEpisodeStatus } = useProjectStore()
  const { novelInfo, waterLevel, fetchStatus } = useAdaptStore()
  const { addToast } = useToastStore()
  const webImportInputRef = useRef<HTMLInputElement | null>(null)
  const scriptLoadTokenRef = useRef(0)
  const chapterReadTokenRef = useRef(0)
  const [baseSaving, setBaseSaving] = useState(false)
  const [importingNovel, setImportingNovel] = useState(false)
  const [outlineSaving, setOutlineSaving] = useState(false)
  const [scriptSaving, setScriptSaving] = useState(false)
  const [scriptLoading, setScriptLoading] = useState(false)
  const [selectedEpisode, setSelectedEpisode] = useState(1)
  const [projectName, setProjectName] = useState('')
  const [novelTitle, setNovelTitle] = useState('')
  const [novelGenre, setNovelGenre] = useState('')
  const [targetMedium, setTargetMedium] = useState('')
  const [visualStyle, setVisualStyle] = useState('')
  const [outlines, setOutlines] = useState<EpisodeOutlineItem[]>([])
  const [scriptContent, setScriptContent] = useState('')
  const [scriptSaved, setScriptSaved] = useState(true)
  const [latestMessage, setLatestMessage] = useState<string | null>(null)
  const [chapterPreview, setChapterPreview] = useState<ChapterContent | null>(null)
  const [chapterPreviewLoading, setChapterPreviewLoading] = useState(false)

  const isWebPreview = platformAPI.isWebPreview
  const totalChapters = waterLevel?.totalChapters || novelInfo?.totalChapters || 0
  const processedChapters = waterLevel?.processedChapters || 0
  const hasNovelBinding = totalChapters > 0 || !!currentProject?.novelTitle
  const episodeOptions = useMemo(() => buildDefaultOutline(currentProject?.totalEpisodes || 1, outlines), [currentProject?.totalEpisodes, outlines])
  const currentOutline = episodeOptions.find((item) => item.episodeNumber === selectedEpisode) || episodeOptions[0]

  useEffect(() => {
    if (!currentProject) return
    setProjectName(currentProject.name || '')
    setNovelTitle(currentProject.novelTitle || currentProject.config.novelTitle || '')
    setNovelGenre(currentProject.novelGenre || currentProject.config.novelGenre || '')
    setTargetMedium(currentProject.targetMedium || currentProject.config.targetMedium || '')
    setVisualStyle(currentProject.visualStyle || currentProject.config.visualStyle || '')
    setOutlines(buildDefaultOutline(currentProject.totalEpisodes, currentProject.config.episodeOutlines || []))
    setSelectedEpisode(1)
    setLatestMessage(null)
    void fetchStatus(currentProject.projectPath)
    void loadEpisodes(currentProject.id)
  }, [currentProject?.id, currentProject?.updatedAt, fetchStatus, loadEpisodes])

  const loadScript = useCallback(async (episodeNumber: number) => {
    if (!currentProject) return
    const requestToken = ++scriptLoadTokenRef.current
    setScriptLoading(true)
    try {
      const content = await platformAPI.invoke(
        IPC.SCRIPT_READ_EPISODE,
        currentProject.projectPath,
        episodeNumber
      ) as string | null
      if (requestToken !== scriptLoadTokenRef.current) return
      setScriptContent(content || `# EP${String(episodeNumber).padStart(2, '0')}\n\n## 剧本正文\n\n`)
      setScriptSaved(true)
    } catch (error) {
      if (requestToken !== scriptLoadTokenRef.current) return
      setScriptContent(`# EP${String(episodeNumber).padStart(2, '0')}\n\n## 剧本正文\n\n`)
      setScriptSaved(true)
      addToast('warning', `剧本读取失败，已创建空白草稿：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (requestToken === scriptLoadTokenRef.current) {
        setScriptLoading(false)
      }
    }
  }, [currentProject, addToast])

  useEffect(() => {
    if (!currentProject) return
    void loadScript(selectedEpisode)
  }, [currentProject?.id, currentProject?.projectPath, selectedEpisode, loadScript])

  const refreshNovelState = useCallback(async () => {
    if (!currentProject) return
    await fetchStatus(currentProject.projectPath)
  }, [currentProject, fetchStatus])

  const handleSaveBaseInfo = async () => {
    if (!currentProject) return
    setBaseSaving(true)
    try {
      await saveProjectConfig(currentProject.projectPath, {
        projectName,
        novelTitle,
        novelGenre,
        targetMedium,
        visualStyle
      })
      setLatestMessage('项目基础信息已保存')
      addToast('success', '项目基础信息已保存')
    } catch (error) {
      addToast('error', `项目信息保存失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBaseSaving(false)
    }
  }

  const importWebFiles = async (files: File[]) => {
    if (!currentProject) return
    const txtFiles = files.filter((file) => file.name.toLowerCase().endsWith('.txt'))
    if (txtFiles.length === 0) {
      addToast('error', '请至少选择一个 .txt 文件')
      return
    }
    setImportingNovel(true)
    try {
      const chapters = await Promise.all(txtFiles.map(async (file, index) => {
        const text = await file.text()
        const match = file.name.match(/(\d+)/)
        return {
          chapterNum: match ? Number.parseInt(match[1], 10) : index + 1,
          title: file.name.replace(/\.txt$/i, ''),
          content: text
        }
      }))
      await platformAPI.invoke(IPC.NOVEL_IMPORT, {
        projectPath: currentProject.projectPath,
        chapters
      })
      await refreshNovelState()
      setLatestMessage(`已导入 ${chapters.length} 个章节文件`)
      addToast('success', `已导入 ${chapters.length} 个章节文件`)
    } catch (error) {
      addToast('error', `小说导入失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setImportingNovel(false)
    }
  }

  const handleImportNovel = async () => {
    if (!currentProject) return
    if (isWebPreview) {
      webImportInputRef.current?.click()
      return
    }
    setImportingNovel(true)
    try {
      const dirPath = await platformAPI.invoke(IPC.FILE_SELECT_DIR) as string | null
      if (!dirPath) return
      const result = await platformAPI.invoke(IPC.NOVEL_IMPORT, {
        sourcePath: dirPath,
        projectPath: currentProject.projectPath
      }) as { imported: number }
      await refreshNovelState()
      setLatestMessage(`已导入 ${result.imported} 个章节文件`)
      addToast('success', `已导入 ${result.imported} 个章节文件`)
    } catch (error) {
      addToast('error', `小说导入失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setImportingNovel(false)
    }
  }

  const handleDropNovel = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files)
    if (isWebPreview) {
      await importWebFiles(files)
      return
    }
    if (!currentProject) return
    const txtFiles = files.filter((file) => file.name.toLowerCase().endsWith('.txt'))
    if (txtFiles.length === 0) {
      addToast('error', '请拖入 txt 小说文件')
      return
    }
    setImportingNovel(true)
    try {
      const firstPath = (txtFiles[0] as File & { path?: string }).path
      const dirPath = firstPath ? getParentDir(firstPath) : null
      if (!dirPath) throw new Error('无法解析拖入目录')
      const result = await platformAPI.invoke(IPC.NOVEL_IMPORT, {
        sourcePath: dirPath,
        projectPath: currentProject.projectPath
      }) as { imported: number }
      await refreshNovelState()
      setLatestMessage(`已导入 ${result.imported} 个章节文件`)
      addToast('success', `已导入 ${result.imported} 个章节文件`)
    } catch (error) {
      addToast('error', `小说导入失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setImportingNovel(false)
    }
  }

  const handleWebImportInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    await importWebFiles(files)
  }

  const handleSaveOutlines = async () => {
    if (!currentProject) return
    setOutlineSaving(true)
    try {
      await saveProjectConfig(currentProject.projectPath, {
        totalEpisodes: Math.max(outlines.length, currentProject.totalEpisodes || 1),
        episodeOutlines: outlines
      })
      await syncEpisodeStatus()
      setLatestMessage('剧集大纲已保存')
      addToast('success', '剧集大纲已保存')
    } catch (error) {
      addToast('error', `剧集大纲保存失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setOutlineSaving(false)
    }
  }

  const handleAddEpisode = () => {
    const nextEpisode = outlines.length + 1
    const next = [...outlines, { episodeNumber: nextEpisode, title: `第 ${nextEpisode} 集`, summary: '' }]
    setOutlines(next)
    setSelectedEpisode(nextEpisode)
    setLatestMessage(`已新增 EP${String(nextEpisode).padStart(2, '0')} 大纲草稿，记得保存`)
  }

  const updateCurrentOutline = (patch: Partial<EpisodeOutlineItem>) => {
    setOutlines((prev) => buildDefaultOutline(Math.max(prev.length, currentProject?.totalEpisodes || 1), prev).map((item) => (
      item.episodeNumber === selectedEpisode
        ? { ...item, ...patch }
        : item
    )))
  }

  const handleOpenChapterPreview = async () => {
    if (!currentProject || !totalChapters) return
    const requestToken = ++chapterReadTokenRef.current
    setChapterPreviewLoading(true)
    try {
      const chapter = await platformAPI.invoke(IPC.NOVEL_READ_CHAPTER, currentProject.projectPath, 1) as ChapterContent | null
      if (requestToken !== chapterReadTokenRef.current) return
      setChapterPreview(chapter)
    } catch {
      if (requestToken !== chapterReadTokenRef.current) return
      setChapterPreview(null)
    } finally {
      if (requestToken === chapterReadTokenRef.current) {
        setChapterPreviewLoading(false)
      }
    }
  }

  const handleSaveScript = async () => {
    if (!currentProject) return
    setScriptSaving(true)
    try {
      await platformAPI.invoke(IPC.SCRIPT_SAVE_EPISODE, currentProject.projectPath, selectedEpisode, scriptContent)
      await syncEpisodeStatus()
      setScriptSaved(true)
      setLatestMessage(`EP${String(selectedEpisode).padStart(2, '0')} 剧本已保存到 script/`)
      addToast('success', `EP${String(selectedEpisode).padStart(2, '0')} 剧本已保存`)
    } catch (error) {
      addToast('error', `剧本保存失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setScriptSaving(false)
    }
  }

  if (!currentProject) {
    return <EmptyState icon="🧭" title="请先选择一个项目" description="选择项目后，才能开始立项、导入小说、整理大纲并编辑剧本。" />
  }

  return (
    <div className="project-launch-page section-page page-container page-wide">
      <div className="card project-launch-hero">
        <div>
          <h1>项目启动流程</h1>
          <p className="text-secondary">
            用一页完成从项目基础信息、小说导入、分集大纲到 EP01 剧本保存的最短路径，避免在多个工作区之间来回跳转。
          </p>
        </div>
        <div className="project-launch-hero-actions">
          <button className="btn" onClick={() => navigate('/')}>返回项目列表</button>
          <button className="btn" onClick={() => navigate(buildProjectRoute(currentProject.id, 'source'))}>打开内容准备</button>
          <button className="btn btn-primary" onClick={() => navigate(buildProjectRoute(currentProject.id, 'script'))}>打开完整剧本工作区</button>
        </div>
      </div>

      {isWebPreview && (
        <input ref={webImportInputRef} type="file" accept=".txt,text/plain" multiple style={{ display: 'none' }} onChange={handleWebImportInput} />
      )}

      <div className="project-launch-grid">
        <section className="card project-launch-section">
          <div className="project-launch-section-head">
            <div>
              <h2>1. 项目立项</h2>
              <p className="text-secondary">填写并确认项目基础信息，确保后续输入和输出都有统一上下文。</p>
            </div>
            <span className="badge badge-info">项目目录已绑定</span>
          </div>
          <div className="project-launch-form-grid">
            <label className="form-group">
              <span>项目名称</span>
              <input className="input" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
            </label>
            <label className="form-group">
              <span>原著 / 小说名</span>
              <input className="input" value={novelTitle} onChange={(e) => setNovelTitle(e.target.value)} placeholder="输入原著或小说名称" />
            </label>
            <label className="form-group">
              <span>目标媒介</span>
              <input className="input" value={targetMedium} onChange={(e) => setTargetMedium(e.target.value)} placeholder="如：短剧 / 漫改视频 / 剧情短片" />
            </label>
            <label className="form-group">
              <span>风格</span>
              <input className="input" value={visualStyle} onChange={(e) => setVisualStyle(e.target.value)} placeholder="如：古风写实 / 悬疑都市" />
            </label>
            <label className="form-group">
              <span>题材类型</span>
              <input className="input" list="project-launch-genre-options" value={novelGenre} onChange={(e) => setNovelGenre(e.target.value)} placeholder="选择或输入题材" />
              <datalist id="project-launch-genre-options">
                {NOVEL_GENRES.map((genre) => <option key={genre} value={genre} />)}
              </datalist>
            </label>
            <div className="project-launch-static-block">
              <span className="text-secondary">项目路径</span>
              <strong>{currentProject.projectPath}</strong>
            </div>
          </div>
          <div className="project-launch-actions">
            <button className="btn btn-primary" onClick={handleSaveBaseInfo} disabled={baseSaving}>
              {baseSaving ? '保存中...' : '保存基础信息'}
            </button>
          </div>
        </section>

        <section className="card project-launch-section">
          <div className="project-launch-section-head">
            <div>
              <h2>2. 小说导入</h2>
              <p className="text-secondary">支持选择目录导入 txt 章节，导入后可快速确认是否已经绑定到当前项目。</p>
            </div>
            <span className={`badge ${hasNovelBinding ? 'badge-success' : 'badge-warning'}`}>{hasNovelBinding ? '已绑定小说' : '待导入'}</span>
          </div>
          <div className="project-launch-stats">
            <div className="project-launch-stat-card">
              <span className="text-secondary">书名</span>
              <strong>{novelInfo?.title || novelTitle || '未设置'}</strong>
            </div>
            <div className="project-launch-stat-card">
              <span className="text-secondary">章节数</span>
              <strong>{totalChapters}</strong>
            </div>
            <div className="project-launch-stat-card">
              <span className="text-secondary">已拆解章节</span>
              <strong>{processedChapters}</strong>
            </div>
          </div>
          <div className="project-launch-dropzone" onDragOver={(e) => e.preventDefault()} onDrop={handleDropNovel}>
            <strong>拖入小说 txt 文件，或使用按钮导入</strong>
            <p className="text-secondary">导入成功后会写入当前项目的 `novel/` 目录。</p>
            <div className="project-launch-actions">
              <button className="btn btn-primary" onClick={handleImportNovel} disabled={importingNovel}>
                {importingNovel ? '导入中...' : '导入小说'}
              </button>
              <button className="btn" onClick={() => void handleOpenChapterPreview()} disabled={!totalChapters || chapterPreviewLoading}>
                {chapterPreviewLoading ? '读取中...' : '预览首章'}
              </button>
            </div>
          </div>
          {chapterPreview && (
            <div className="project-launch-preview card">
              <div className="project-launch-preview-head">
                <strong>{chapterPreview.title}</strong>
                <span className="text-secondary">第 {chapterPreview.chapterNum} 章</span>
              </div>
              <pre>{chapterPreview.content.slice(0, 800)}</pre>
            </div>
          )}
        </section>
      </div>

      <div className="project-launch-grid project-launch-grid--bottom">
        <section className="card project-launch-section">
          <div className="project-launch-section-head">
            <div>
              <h2>3. 剧集大纲</h2>
              <p className="text-secondary">先把 ep01 / ep02 等剧情概要收进项目配置里，后续可以继续在完整规划页细化。</p>
            </div>
            <button className="btn btn-sm" onClick={handleAddEpisode}>+ 新增集数</button>
          </div>
          <div className="project-outline-layout">
            <div className="project-outline-list">
              {episodeOptions.map((item) => (
                <button
                  key={item.episodeNumber}
                  className={`project-outline-item ${selectedEpisode === item.episodeNumber ? 'is-active' : ''}`}
                  onClick={() => setSelectedEpisode(item.episodeNumber)}
                >
                  <strong>EP{String(item.episodeNumber).padStart(2, '0')}</strong>
                  <span>{item.title || '未命名'}</span>
                  <small className="text-secondary">{item.summary ? item.summary.slice(0, 40) : '待填写剧情概要'}</small>
                </button>
              ))}
            </div>
            <div className="project-outline-editor">
              <label className="form-group">
                <span>当前集标题</span>
                <input className="input" value={currentOutline?.title || ''} onChange={(e) => updateCurrentOutline({ title: e.target.value })} />
              </label>
              <label className="form-group">
                <span>剧情概要</span>
                <textarea className="input project-outline-textarea" value={currentOutline?.summary || ''} onChange={(e) => updateCurrentOutline({ summary: e.target.value })} placeholder="输入本集剧情概要、主要冲突、人物推进与结尾钩子" />
              </label>
              <div className="project-launch-actions">
                <button className="btn btn-primary" onClick={handleSaveOutlines} disabled={outlineSaving}>
                  {outlineSaving ? '保存中...' : '保存剧集大纲'}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="card project-launch-section">
          <div className="project-launch-section-head">
            <div>
              <h2>4. EP01 / 当前集剧本编辑</h2>
              <p className="text-secondary">直接读写 `script/ep01-*.md` / `script/ep001.md` 对应文件，先保证最关键的剧本落盘闭环。</p>
            </div>
            <div className="project-launch-episode-switcher">
              {episodeOptions.slice(0, Math.max(episodeOptions.length, 1)).map((item) => (
                <button key={item.episodeNumber} className={`btn btn-sm ${selectedEpisode === item.episodeNumber ? 'btn-primary' : ''}`} onClick={() => setSelectedEpisode(item.episodeNumber)}>
                  EP{String(item.episodeNumber).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>
          <div className="project-launch-script-toolbar">
            <span className="text-secondary">当前文件：EP{String(selectedEpisode).padStart(2, '0')} · {scriptContent.split('\n').length} 行</span>
            {!scriptSaved && <span className="badge badge-warning">未保存</span>}
            {episodes.some((episode) => episode.episodeNumber === selectedEpisode && episode.hasScript) && <span className="badge badge-success">已存在剧本文件</span>}
          </div>
          <div className="project-launch-script-editor">
            <Suspense fallback={<div className="text-secondary" style={{ padding: 16 }}>编辑器加载中...</div>}>
              <MonacoMarkdownEditor value={scriptContent} onChange={(value) => {
                setScriptContent(value || '')
                setScriptSaved(false)
              }} />
            </Suspense>
          </div>
          <div className="project-launch-actions">
            <button className="btn" onClick={() => void loadScript(selectedEpisode)} disabled={scriptLoading || scriptSaving}>重新加载</button>
            <button className="btn btn-primary" onClick={handleSaveScript} disabled={scriptSaving || scriptLoading || scriptSaved}>
              {scriptSaving ? '保存中...' : `保存 EP${String(selectedEpisode).padStart(2, '0')} 剧本`}
            </button>
          </div>
        </section>
      </div>

      <section className="card project-launch-status-card">
        <div>
          <h3>5. 关键操作反馈</h3>
          <p className="text-secondary">确保每个关键动作都有明确结果，避免“点完没反应”。</p>
        </div>
        <div className="project-launch-status-list">
          <span className="status-chip">项目：{currentProject.name}</span>
          <span className="status-chip">小说：{hasNovelBinding ? '已导入' : '未导入'}</span>
          <span className="status-chip">大纲：{outlines.some((item) => item.summary.trim()) ? '已有内容' : '待填写'}</span>
          <span className="status-chip">剧本：{episodes.some((episode) => episode.episodeNumber === selectedEpisode && episode.hasScript) || scriptSaved ? '可保存 / 已保存' : '编辑中'}</span>
          {latestMessage && <span className="status-chip is-success">{latestMessage}</span>}
        </div>
      </section>
    </div>
  )
}
