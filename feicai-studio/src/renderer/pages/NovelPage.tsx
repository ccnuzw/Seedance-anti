import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useAdaptStore } from '@renderer/stores/adaptStore'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import { useToastStore } from '@renderer/stores/toastStore'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { platformAPI } from '@renderer/platform/api'
import EmptyState from '@renderer/components/layout/EmptyState'
import { IPC } from '@shared/ipc-channels'
import { NOVEL_GENRES } from '@shared/types'
import './NovelPage.css'

interface NovelPageProps {
  embedded?: boolean
}

interface ChapterContent {
  chapterNum: number
  content: string
  title: string
}

interface ScanResult {
  totalChapters: number
  chapterRange: [number, number]
  chapterFiles: string[]
}

interface ScanChaptersOptions {
  preserveOnError?: boolean
}

function getParentDir(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return lastSlash >= 0 ? filePath.slice(0, lastSlash) : filePath
}

export default function NovelPage({ embedded = false }: NovelPageProps) {
  useProjectSync()
  const navigate = useNavigate()
  const { currentProject } = useProjectStore()
  const { novelInfo, waterLevel, fetchStatus, initProject, setupEventListeners } = useAdaptStore()
  const { getDefaultConfig } = useSettingsStore()
  const { addToast } = useToastStore()
  const [importing, setImporting] = useState(false)
  const [novelTitle, setNovelTitle] = useState('')
  const [novelGenre, setNovelGenre] = useState('')
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [readerOpen, setReaderOpen] = useState(false)
  const [readerChapter, setReaderChapter] = useState<ChapterContent | null>(null)
  const [readerLoading, setReaderLoading] = useState(false)
  const [currentChapterNum, setCurrentChapterNum] = useState(0)
  const scanTokenRef = useRef(0)
  const readerTokenRef = useRef(0)
  const webImportInputRef = useRef<HTMLInputElement | null>(null)
  const isWebPreview = platformAPI.isWebPreview

  useEffect(() => {
    scanTokenRef.current += 1
    readerTokenRef.current += 1
    setImporting(false)
    setNovelTitle('')
    setNovelGenre('')
    setScanResult(null)
    setReaderOpen(false)
    setReaderChapter(null)
    setReaderLoading(false)
    setCurrentChapterNum(0)
    if (currentProject) {
      void fetchStatus(currentProject.projectPath)
      void scanChapters(currentProject.id, currentProject.projectPath)
      if (currentProject.novelTitle) setNovelTitle(currentProject.novelTitle)
      if (currentProject.novelGenre) setNovelGenre(currentProject.novelGenre)
    }
  }, [currentProject?.id, currentProject?.projectPath, fetchStatus])

  useEffect(() => {
    const cleanup = setupEventListeners()
    return cleanup
  }, [setupEventListeners])

  const scanChapters = async (
    projectId?: string,
    projectPath?: string,
    options?: ScanChaptersOptions
  ): Promise<boolean> => {
    if (!projectId || !projectPath) return false
    const requestToken = ++scanTokenRef.current
    try {
      const result = await platformAPI.invoke(
        IPC.NOVEL_SCAN,
        `${projectPath}/novel`
      ) as ScanResult
      if (scanTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === projectId) {
        setScanResult(result)
      }
      return true
    } catch {
      if (scanTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === projectId) {
        if (!options?.preserveOnError) {
          setScanResult(null)
        }
      }
      return false
    }
  }

  const refreshNovelState = async (projectId: string, projectPath: string) => {
    const refreshed = await scanChapters(projectId, projectPath, { preserveOnError: true })
    await fetchStatus(projectPath)
    if (!refreshed) {
      addToast('warning', '源稿已更新，但章节列表刷新失败')
    }
  }

  const handleImport = async () => {
    if (!currentProject) return
    if (isWebPreview) {
      webImportInputRef.current?.click()
      return
    }
    setImporting(true)
    try {
      const dirPath = await platformAPI.invoke(IPC.FILE_SELECT_DIR) as string | null
      if (!dirPath) return
      const projectAtStart = currentProject
      const result = await platformAPI.invoke(IPC.NOVEL_IMPORT, {
        sourcePath: dirPath,
        projectPath: projectAtStart.projectPath
      }) as { imported: number }
      addToast('success', `已导入 ${result.imported} 个章节文件`)
      if (useProjectStore.getState().currentProject?.id === projectAtStart.id) {
        await refreshNovelState(projectAtStart.id, projectAtStart.projectPath)
      }
    } catch (error) {
      addToast('error', `导入失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setImporting(false)
    }
  }

  const importWebFiles = async (files: File[]) => {
    if (!currentProject) return
    const txtFiles = files.filter((file) => file.name.toLowerCase().endsWith('.txt'))
    if (txtFiles.length === 0) {
      addToast('error', '请至少选择一个 .txt 章节文件')
      return
    }
    setImporting(true)
    try {
      const chapters = await Promise.all(txtFiles.map(async (file, index) => {
        const text = await file.text()
        const match = file.name.match(/(\d+)/)
        const chapterNum = match ? Number.parseInt(match[1], 10) : index + 1
        return {
          chapterNum,
          title: file.name.replace(/\.txt$/i, ''),
          content: text
        }
      }))
      chapters.sort((a, b) => a.chapterNum - b.chapterNum)
      const result = await platformAPI.invoke(IPC.NOVEL_IMPORT, {
        projectPath: currentProject.projectPath,
        chapters
      }) as { imported: number }
      addToast('success', `已导入 ${result.imported} 个章节文件`)
      if (useProjectStore.getState().currentProject?.id === currentProject.id) {
        await refreshNovelState(currentProject.id, currentProject.projectPath)
      }
    } catch (error) {
      addToast('error', `导入失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setImporting(false)
    }
  }

  const handleWebFileInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    await importWebFiles(files)
  }

  const handleInitProject = async () => {
    if (!currentProject || !novelTitle.trim() || !novelGenre) return
    const llmConfig = getDefaultConfig('llm')
    if (!llmConfig) {
      addToast('error', '请先在设置中配置 LLM')
      return
    }
    const success = await initProject(novelTitle, novelGenre, currentProject.projectPath, llmConfig)
    if (!success) return
    addToast('success', `项目源稿已初始化：《${novelTitle}》 · ${novelGenre}`)
    await fetchStatus(currentProject.projectPath)
  }

  const openReader = async (chapterNum: number) => {
    if (!currentProject) return
    const requestToken = ++readerTokenRef.current
    const projectAtStart = currentProject
    setReaderOpen(true)
    setReaderLoading(true)
    setCurrentChapterNum(chapterNum)
    try {
      const chapter = await platformAPI.invoke(
        IPC.NOVEL_READ_CHAPTER,
        projectAtStart.projectPath,
        chapterNum
      ) as ChapterContent | null
      if (readerTokenRef.current !== requestToken || useProjectStore.getState().currentProject?.id !== projectAtStart.id) {
        return
      }
      if (!chapter) throw new Error('章节不存在')
      setReaderChapter(chapter)
    } catch {
      if (readerTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === projectAtStart.id) {
        setReaderChapter({
          chapterNum,
          content: '无法加载章节内容',
          title: `第${chapterNum}章`
        })
      }
    } finally {
      if (readerTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === projectAtStart.id) {
        setReaderLoading(false)
      }
    }
  }

  const closeReader = () => {
    readerTokenRef.current += 1
    setReaderOpen(false)
    setReaderChapter(null)
    setReaderLoading(false)
  }

  const navigateChapter = (delta: number) => {
    const newNum = currentChapterNum + delta
    const totalCh = scanResult?.totalChapters || 0
    if (newNum >= 1 && newNum <= totalCh) {
      void openReader(newNum)
    }
  }

  const handleDropImport = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.classList.remove('drag-over')
    if (!currentProject) return
    const files = Array.from(event.dataTransfer.files)
    const txtFiles = files.filter((file) => file.name.endsWith('.txt'))
    if (txtFiles.length === 0) {
      addToast('error', '请拖入 `.txt` 格式的章节文件')
      return
    }
    setImporting(true)
    try {
      if (isWebPreview) {
        await importWebFiles(txtFiles)
        return
      }
      const firstPath = (txtFiles[0] as File & { path?: string }).path
      const dirPath = firstPath ? getParentDir(firstPath) : null
      if (!dirPath) throw new Error('无法解析拖入目录')
      const result = await platformAPI.invoke(IPC.NOVEL_IMPORT, {
        sourcePath: dirPath,
        projectPath: currentProject.projectPath
      }) as { imported: number }
      addToast('success', `已导入 ${result.imported} 个章节文件`)
      if (useProjectStore.getState().currentProject?.id === currentProject.id) {
        await refreshNovelState(currentProject.id, currentProject.projectPath)
      }
    } catch (error) {
      addToast('error', `导入失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setImporting(false)
    }
  }

  const processedChapters = waterLevel?.processedChapters || 0
  const totalChapters = scanResult?.totalChapters || novelInfo?.totalChapters || 0
  const needsInit = !novelInfo?.title && !currentProject?.novelTitle
  const sourceReady = totalChapters > 0
  const progressPct = totalChapters > 0 ? Math.round((processedChapters / totalChapters) * 100) : 0
  const nextAction = useMemo(() => {
    if (!sourceReady) {
      return {
        title: '先导入章节源稿',
        description: '当前还没有可用章节文件。先把源稿导入进项目，再做初始化和后续规划。',
        action: '导入源稿',
        onClick: handleImport
      }
    }
    if (needsInit) {
      return {
        title: '补齐源稿信息',
        description: '当前章节已经进来，但项目还没登记书名和类型。补完后系统才能生成稳定的规划文件。',
        action: '完成初始化',
        onClick: handleInitProject
      }
    }
    if (processedChapters < totalChapters) {
      return {
        title: '进入改编规划继续拆解',
        description: `当前仅拆解了 ${processedChapters}/${totalChapters} 章，建议继续补齐剧情库存。`,
        action: '进入改编规划',
        onClick: () => navigate(`/project/${currentProject?.id}/source?tab=plan`)
      }
    }
    return {
      title: '源稿输入已经完整',
      description: '源稿已具备，可以继续进入改编规划或分集剧本工作区推进后续生产。',
      action: '进入改编规划',
      onClick: () => navigate(`/project/${currentProject?.id}/source?tab=plan`)
    }
  }, [currentProject?.id, needsInit, navigate, processedChapters, sourceReady, totalChapters])

  if (!currentProject) {
    return <EmptyState icon="📖" title="请先选择一个项目" description="选择项目后才能进入小说源稿页面。" />
  }

  return (
    <div className="novel-page">
      {!embedded && (
        <div className="novel-header">
          <div className="novel-header-copy">
            <h1 className="page-title">📖 小说源稿</h1>
            <p className="text-secondary">先确认源稿输入是否完整、可读、可追溯，后面的规划和创作才不会失真。</p>
          </div>
          <div className="novel-header-actions">
            <button className="btn" onClick={() => navigate(`/project/${currentProject.id}/source?tab=plan`)}>
              📊 改编规划
            </button>
            <button className="btn btn-primary" onClick={handleImport} disabled={importing}>
              {importing ? '导入中...' : isWebPreview ? '📄 导入章节文件' : '📁 导入章节'}
            </button>
          </div>
        </div>
      )}
      {isWebPreview && (
        <input
          ref={webImportInputRef}
          type="file"
          accept=".txt,text/plain"
          multiple
          style={{ display: 'none' }}
          onChange={(event) => { void handleWebFileInput(event) }}
        />
      )}

      <div className="novel-hero-grid">
        <div className="card novel-next-step">
          <div className="novel-section-head">
            <h3>推荐下一步</h3>
            <span className="text-secondary text-xs">{sourceReady ? '源稿已导入' : '等待导入'}</span>
          </div>
          <div className="novel-next-step-body">
            <strong>{nextAction.title}</strong>
            <p className="text-secondary">{nextAction.description}</p>
            <div className="novel-next-step-actions">
              <button className="btn btn-primary" onClick={nextAction.onClick} disabled={importing}>
                {nextAction.action}
              </button>
              <button className="btn" onClick={() => navigate(`/project/${currentProject.id}/workspace`)}>
                返回总控台
              </button>
            </div>
          </div>
        </div>

        <div className="card novel-readiness">
          <div className="novel-section-head">
            <h3>源稿准备度</h3>
            <span className="text-secondary text-xs">看输入是否足够支撑后续规划。</span>
          </div>
          <div className="novel-readiness-score">{sourceReady ? (needsInit ? '70%' : `${Math.max(progressPct, 85)}%`) : '20%'}</div>
          <div className="novel-readiness-list">
            <div className="novel-readiness-row">
              <span className="novel-readiness-label">章节导入</span>
              <div className="novel-mini-progress"><div style={{ width: `${sourceReady ? 100 : 0}%` }} /></div>
            </div>
            <div className="novel-readiness-row">
              <span className="novel-readiness-label">项目初始化</span>
              <div className="novel-mini-progress"><div style={{ width: `${needsInit ? 0 : 100}%` }} /></div>
            </div>
            <div className="novel-readiness-row">
              <span className="novel-readiness-label">拆解覆盖</span>
              <div className="novel-mini-progress"><div style={{ width: `${progressPct}%` }} /></div>
            </div>
          </div>
        </div>
      </div>

      <div className="water-level-grid">
        <div className="water-level-card">
          <div className="wl-value wl-primary">{novelInfo?.title || novelTitle || '未登记'}</div>
          <div className="wl-label">书名</div>
        </div>
        <div className="water-level-card">
          <div className="wl-value wl-primary">{novelInfo?.genre || novelGenre || '未登记'}</div>
          <div className="wl-label">类型</div>
        </div>
        <div className="water-level-card">
          <div className="wl-value wl-primary">{totalChapters}</div>
          <div className="wl-label">已导入章节</div>
        </div>
        <div className="water-level-card">
          <div className={`wl-value ${processedChapters > 0 ? 'wl-success' : 'wl-warning'}`}>{processedChapters}</div>
          <div className="wl-label">已拆解章节</div>
        </div>
      </div>

      {needsInit && (
        <div className="card novel-init-card">
          <div className="novel-section-head">
            <h3>初始化源稿项目</h3>
            <span className="text-secondary text-xs">给系统一个统一的书名和类型，后续规划文件才有稳定上下文。</span>
          </div>
          <div className="novel-init-grid">
            <div className="form-group">
              <label className="text-secondary font-label">小说名称</label>
              <input
                type="text"
                className="input"
                value={novelTitle}
                onChange={(event) => setNovelTitle(event.target.value)}
                placeholder="例如：神文觉醒"
              />
            </div>
            <div className="form-group">
              <label className="text-secondary font-label">小说类型</label>
              <select className="input" value={novelGenre} onChange={(event) => setNovelGenre(event.target.value)}>
                <option value="">选择类型</option>
                {NOVEL_GENRES.map((genre) => <option key={genre} value={genre}>{genre}</option>)}
              </select>
            </div>
            <div className="novel-init-actions">
              <button className="btn btn-primary" disabled={!novelTitle.trim() || !novelGenre} onClick={handleInitProject}>
                完成初始化
              </button>
            </div>
          </div>
        </div>
      )}

      {totalChapters > 0 && (
        <div className="card novel-progress-card">
          <div className="novel-section-head">
            <h3>章节拆解进度</h3>
            <span className="text-secondary text-xs">{processedChapters}/{totalChapters} 章已进入规划库存</span>
          </div>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="text-secondary progress-text">
            当前拆解覆盖 {progressPct}% ，剩余 {Math.max(totalChapters - processedChapters, 0)} 章待进入规划。
          </div>
        </div>
      )}

      {!sourceReady && (
        <div
          className="novel-drop-zone"
          onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add('drag-over') }}
          onDragLeave={(event) => { event.currentTarget.classList.remove('drag-over') }}
          onDrop={(event) => { void handleDropImport(event) }}
        >
          <div className="empty-icon-xl">📚</div>
          <h3>把章节源稿放进项目</h3>
          <p className="text-secondary">
            {isWebPreview
              ? '将 `.txt` 章节文件拖进这里，或点击按钮选择多个章节文件。'
              : '将 `.txt` 章节文件拖进这里，或者直接点上方按钮选择目录导入。'}
          </p>
          <p className="text-secondary text-xs text-muted">推荐使用 `chapter-0001.txt` 这类顺序命名，后续拆解和阅读会更稳定。</p>
          <button className="btn btn-primary mt-md" onClick={handleImport} disabled={importing}>
            {importing ? '导入中...' : isWebPreview ? '选择章节文件' : '选择章节目录'}
          </button>
        </div>
      )}

      {scanResult && scanResult.totalChapters > 0 && (
        <div className="card novel-chapter-card">
          <div className="novel-section-head">
            <h3>章节目录</h3>
            <span className="text-secondary text-xs">
              范围 {scanResult.chapterRange[0]} - {scanResult.chapterRange[1]} · 点击章节可直接阅读原文
            </span>
          </div>
          <div className="chapter-list">
            {scanResult.chapterFiles.slice(0, 200).map((file) => {
              const match = file.match(/chapter-(\d{4})\.txt/)
              const chapterNum = match ? Number.parseInt(match[1], 10) : 0
              const isProcessed = chapterNum <= processedChapters
              return (
                <div
                  key={file}
                  className="chapter-item chapter-item-clickable"
                  onClick={() => void openReader(chapterNum)}
                >
                  <span className="chapter-num">第{chapterNum}章</span>
                  <span className="chapter-file text-secondary">{file}</span>
                  <span className={`chapter-status ${isProcessed ? 'processed' : 'pending'}`}>
                    {isProcessed ? '已拆解' : '待拆解'}
                  </span>
                  <span className="chapter-read-btn">阅读原文</span>
                </div>
              )
            })}
            {scanResult.totalChapters > 200 && (
              <div className="chapter-item text-secondary justify-center">
                共 {scanResult.totalChapters} 章，当前先展示前 200 章。
              </div>
            )}
          </div>
        </div>
      )}

      {readerOpen && (
        <div className="reader-overlay" onClick={closeReader}>
          <div className="reader-panel" onClick={(event) => event.stopPropagation()}>
            <div className="reader-header">
              <div className="reader-nav">
                <button className="btn btn-sm" onClick={() => navigateChapter(-1)} disabled={currentChapterNum <= 1}>
                  ◀ 上一章
                </button>
                <span className="reader-title">
                  第{currentChapterNum}章
                  {readerChapter && !readerLoading && <span className="reader-subtitle"> {readerChapter.title}</span>}
                </span>
                <button
                  className="btn btn-sm"
                  onClick={() => navigateChapter(1)}
                  disabled={currentChapterNum >= (scanResult?.totalChapters || 0)}
                >
                  下一章 ▶
                </button>
              </div>
              <button className="btn btn-sm reader-close" onClick={closeReader}>✕</button>
            </div>
            <div className="reader-body">
              {readerLoading ? (
                <div className="reader-loading">加载中...</div>
              ) : readerChapter ? (
                <div className="reader-content">{readerChapter.content}</div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
