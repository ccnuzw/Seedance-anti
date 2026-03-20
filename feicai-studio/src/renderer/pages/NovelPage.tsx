import { useEffect, useState } from 'react'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useAdaptStore } from '@renderer/stores/adaptStore'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import { useToastStore } from '@renderer/stores/toastStore'
import { IPC } from '@shared/ipc-channels'
import { NOVEL_GENRES } from '@shared/types'
import './NovelPage.css'

interface ChapterContent {
  chapterNum: number
  content: string
  title: string
}

export default function NovelPage() {
  const { currentProject } = useProjectStore()
  const { novelInfo, waterLevel, fetchStatus, initProject, setupEventListeners } = useAdaptStore()
  const { getDefaultConfig } = useSettingsStore()
  const { addToast } = useToastStore()
  const [importing, setImporting] = useState(false)
  const [novelTitle, setNovelTitle] = useState('')
  const [novelGenre, setNovelGenre] = useState('')
  const [scanResult, setScanResult] = useState<{
    totalChapters: number
    chapterRange: [number, number]
    chapterFiles: string[]
  } | null>(null)

  // 新增：阅读器状态
  const [readerOpen, setReaderOpen] = useState(false)
  const [readerChapter, setReaderChapter] = useState<ChapterContent | null>(null)
  const [readerLoading, setReaderLoading] = useState(false)
  const [currentChapterNum, setCurrentChapterNum] = useState(0)

  useEffect(() => {
    if (currentProject) {
      fetchStatus(currentProject.projectPath)
      scanChapters()
    }
  }, [currentProject])

  // 设置 IPC 事件监听（引用计数，页面卸载时清理）
  useEffect(() => {
    const cleanup = setupEventListeners()
    return cleanup
  }, [])

  const scanChapters = async () => {
    if (!currentProject) return
    try {
      const result = await window.feicaiAPI.invoke(
        IPC.NOVEL_SCAN,
        `${currentProject.projectPath}/novel`
      ) as { totalChapters: number; chapterRange: [number, number]; chapterFiles: string[] }
      setScanResult(result)
    } catch {
      setScanResult(null)
    }
  }

  const handleImport = async () => {
    if (!currentProject) return
    setImporting(true)
    try {
      const dirPath = await window.feicaiAPI.invoke(IPC.FILE_SELECT_DIR) as string | null
      if (dirPath) {
        const result = await window.feicaiAPI.invoke(IPC.NOVEL_IMPORT, {
          sourcePath: dirPath,
          projectPath: currentProject.projectPath
        }) as { imported: number }
        addToast('success', `✅ 成功导入 ${result.imported} 个章节`)
        await scanChapters()
        await fetchStatus(currentProject.projectPath)
      }
    } catch (e) {
      addToast('error', `导入失败: ${e instanceof Error ? e.message : String(e)}`)
    }
    setImporting(false)
  }

  const handleInitProject = async () => {
    if (!currentProject || !novelTitle.trim() || !novelGenre) return
    const llmConfig = getDefaultConfig('llm')
    if (!llmConfig) {
      addToast('error', '请先在设置中配置 LLM')
      return
    }
    await initProject(novelTitle, novelGenre, currentProject.projectPath, llmConfig)
    addToast('success', `✅ 项目已初始化：《${novelTitle}》· ${novelGenre}`)
    await fetchStatus(currentProject.projectPath)
  }

  // 新增：打开阅读器
  const openReader = async (chapterNum: number) => {
    if (!currentProject) return
    setReaderOpen(true)
    setReaderLoading(true)
    setCurrentChapterNum(chapterNum)
    try {
      const chapterStr = String(chapterNum).padStart(4, '0')
      const content = await window.feicaiAPI.invoke(
        IPC.FILE_READ,
        `${currentProject.projectPath}/novel/chapter-${chapterStr}.txt`
      ) as string | null
      if (!content) throw new Error('章节不存在')

      // 提取标题（通常是第一行）
      const firstLine = content.split('\n')[0]?.trim() || `第${chapterNum}章`

      setReaderChapter({
        chapterNum,
        content,
        title: firstLine
      })
    } catch {
      setReaderChapter({
        chapterNum,
        content: '无法加载章节内容',
        title: `第${chapterNum}章`
      })
    }
    setReaderLoading(false)
  }

  const closeReader = () => {
    setReaderOpen(false)
    setReaderChapter(null)
  }

  const navigateChapter = (delta: number) => {
    const newNum = currentChapterNum + delta
    const totalCh = scanResult?.totalChapters || 0
    if (newNum >= 1 && newNum <= totalCh) {
      openReader(newNum)
    }
  }

  if (!currentProject) {
    return <div className="novel-page"><p>请先选择一个项目</p></div>
  }

  const processedChapters = waterLevel?.processedChapters || 0
  const totalChapters = scanResult?.totalChapters || novelInfo?.totalChapters || 0
  const needsInit = !novelInfo?.title

  return (
    <div className="novel-page">
      <div className="page-header">
        <h1 className="page-title">📖 小说管理</h1>
        <button className="btn btn-primary" onClick={handleImport} disabled={importing}>
          {importing ? '⏳ 导入中...' : '📁 导入小说章节'}
        </button>
      </div>

      {/* 初始化表单 */}
      {needsInit && (
        <div className="card mb-xl p-lg">
          <h3 className="mb-md">📝 初始化项目</h3>
          <p className="text-secondary mb-md">
            请先设置小说名称和类型，这将创建剧情拆解文件（plot-breakdown.md）
          </p>
          <div className="flex gap-md flex-wrap items-end">
            <div>
              <label className="text-secondary font-label">小说名称</label>
              <input
                type="text"
                value={novelTitle}
                onChange={e => setNovelTitle(e.target.value)}
                placeholder="例如：神文觉醒"
                style={{ width: '200px' }}
              />
            </div>
            <div>
              <label className="text-secondary font-label">小说类型</label>
              <select
                value={novelGenre}
                onChange={e => setNovelGenre(e.target.value)}
                style={{ width: '140px' }}
              >
                <option value="">选择类型</option>
                {NOVEL_GENRES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <button
              className="btn btn-primary"
              disabled={!novelTitle.trim() || !novelGenre}
              onClick={handleInitProject}
            >
              ✅ 确认初始化
            </button>
          </div>
        </div>
      )}

      {/* 统计卡片 */}
      <div className="novel-info-card">
        <div className="novel-stat">
          <div className="stat-value">{novelInfo?.title || '—'}</div>
          <div className="stat-label">书名</div>
        </div>
        <div className="novel-stat">
          <div className="stat-value">{novelInfo?.genre || '—'}</div>
          <div className="stat-label">类型</div>
        </div>
        <div className="novel-stat">
          <div className="stat-value">{totalChapters}</div>
          <div className="stat-label">总章节数</div>
        </div>
        <div className="novel-stat">
          <div className="stat-value">{processedChapters}</div>
          <div className="stat-label">已拆解章节</div>
        </div>
      </div>

      {/* 进度条 */}
      {totalChapters > 0 && (
        <div className="mb-lg">
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{ width: `${Math.round((processedChapters / totalChapters) * 100)}%` }}
            />
          </div>
          <div className="text-secondary progress-text">
            {processedChapters} / {totalChapters} 章已拆解 ({Math.round((processedChapters / totalChapters) * 100)}%)
          </div>
        </div>
      )}

      {/* 拖拽导入区域 */}
      {totalChapters === 0 && (
        <div
          className="novel-import-section novel-drop-zone"
          onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over') }}
          onDragLeave={e => { e.currentTarget.classList.remove('drag-over') }}
          onDrop={async e => {
            e.preventDefault()
            e.currentTarget.classList.remove('drag-over')
            if (!currentProject) return
            const files = Array.from(e.dataTransfer.files)
            const txtFiles = files.filter(f => f.name.endsWith('.txt'))
            if (txtFiles.length === 0) {
              addToast('error', '请拖入 .txt 格式的章节文件')
              return
            }
            setImporting(true)
            try {
              const firstPath = (txtFiles[0] as any).path as string
              const dirPath = firstPath.substring(0, firstPath.lastIndexOf('/'))
              const result = await window.feicaiAPI.invoke(IPC.NOVEL_IMPORT, {
                sourcePath: dirPath,
                projectPath: currentProject.projectPath
              }) as { imported: number }
              addToast('success', `✅ 成功导入 ${result.imported} 个章节`)
              await scanChapters()
              await fetchStatus(currentProject.projectPath)
            } catch (err) {
              addToast('error', `导入失败: ${err instanceof Error ? err.message : String(err)}`)
            }
            setImporting(false)
          }}
        >
          <div className="empty-icon-xl">📚</div>
          <h3>导入小说章节</h3>
          <p className="text-secondary">
            将 .txt 章节文件拖拽到此处，或点击按钮选择目录
          </p>
          <p className="text-secondary text-xs text-muted">
            支持 chapter-XXXX.txt 格式
          </p>
          <button className="btn btn-primary mt-md" onClick={handleImport} disabled={importing}>
            📁 选择目录
          </button>
        </div>
      )}

      {/* 章节列表 */}
      {scanResult && scanResult.totalChapters > 0 && (
        <>
          <h3 className="mb-md">
            章节列表 ({scanResult.chapterRange[0]}-{scanResult.chapterRange[1]})
            <span className="text-secondary text-xs ml-sm">
              点击章节可阅读原文
            </span>
          </h3>
          <div className="chapter-list">
            {scanResult.chapterFiles.slice(0, 200).map((file) => {
              const match = file.match(/chapter-(\d{4})\.txt/)
              const chapterNum = match ? parseInt(match[1]) : 0
              const isProcessed = chapterNum <= processedChapters
              return (
                <div
                  key={file}
                  className="chapter-item chapter-item-clickable"
                  onClick={() => openReader(chapterNum)}
                >
                  <span className="chapter-num">第{chapterNum}章</span>
                  <span className="text-secondary">{file}</span>
                  <span className={`chapter-status ${isProcessed ? 'processed' : 'pending'}`}>
                    {isProcessed ? '✅ 已拆解' : '⏳ 待拆解'}
                  </span>
                  <span className="chapter-read-btn">📖 阅读</span>
                </div>
              )
            })}
            {scanResult.totalChapters > 200 && (
              <div className="chapter-item text-secondary justify-center">
                ... 共 {scanResult.totalChapters} 章，仅显示前 200 章
              </div>
            )}
          </div>
        </>
      )}

      {/* 阅读器侧滑面板 */}
      {readerOpen && (
        <div className="reader-overlay" onClick={closeReader}>
          <div className="reader-panel" onClick={e => e.stopPropagation()}>
            <div className="reader-header">
              <div className="reader-nav">
                <button
                  className="btn btn-sm"
                  onClick={() => navigateChapter(-1)}
                  disabled={currentChapterNum <= 1}
                >
                  ◀ 上一章
                </button>
                <span className="reader-title">
                  第{currentChapterNum}章
                  {readerChapter && !readerLoading && (
                    <span className="reader-subtitle"> {readerChapter.title}</span>
                  )}
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
                <div className="reader-content">
                  {readerChapter.content}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
