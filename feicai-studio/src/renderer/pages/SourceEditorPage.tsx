import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useDocumentEditorActions } from '@renderer/hooks/useDocumentEditorActions'
import { useProjectTextFile } from '@renderer/hooks/useProjectTextFile'
import {
  inspectProjectDirectory,
  listSourceChapters,
  migrateLegacyNovelDirectory
} from '@renderer/services/project-service'
import { useToastStore } from '@renderer/stores/toastStore'
import DocumentWorkflowPage from '@renderer/components/editor/DocumentWorkflowPage'
import { buildDefaultSourceTemplate } from '@shared/project-bootstrap'
import { normalizeProjectConfig } from '@shared/project-config'
import {
  describeProjectArtifact,
  resolveProjectArtifactPath
} from '@shared/path-resolver'
import { useShallow } from 'zustand/react/shallow'
import type { SourceChapterItem } from '@shared/ipc-contracts'
import './ScriptEditorPage.css'

type SourceViewMode = 'full' | 'chapter'

export default function SourceEditorPage() {
  const { currentProject, syncEpisodeStatus } = useProjectStore(
    useShallow((s) => ({
      currentProject: s.currentProject,
      syncEpisodeStatus: s.syncEpisodeStatus
    }))
  )
  const { addToast } = useToastStore()
  const navigate = useNavigate()
  const [legacyNovelDetected, setLegacyNovelDetected] = useState(false)
  const [migratingLegacyNovel, setMigratingLegacyNovel] = useState(false)
  const [sourceViewMode, setSourceViewMode] = useState<SourceViewMode>('full')
  const [sourceChapters, setSourceChapters] = useState<SourceChapterItem[]>([])
  const [selectedChapterPath, setSelectedChapterPath] = useState('')
  const [loadingChapters, setLoadingChapters] = useState(false)

  const config = normalizeProjectConfig(currentProject?.config)
  const sourcePath = currentProject
    ? resolveProjectArtifactPath(
        currentProject.projectPath,
        'sourceNovel',
        currentProject.config
      )
    : ''
  const emptySourceTemplate = buildDefaultSourceTemplate(
    currentProject?.name || '未命名项目'
  )
  const activeSourcePath =
    sourceViewMode === 'chapter' && selectedChapterPath
      ? selectedChapterPath
      : sourcePath
  const selectedChapter = sourceChapters.find(
    (chapter) => chapter.filePath === selectedChapterPath
  )
  const sourceDescription =
    sourceViewMode === 'chapter' && selectedChapter
      ? `${selectedChapter.title} · 独立章节文件`
      : config.entryStage === 'script'
        ? '当前项目从剧本起步，此页为可选补充'
        : '作为剧情拆解的上游输入'

  const {
    content,
    setContent,
    saved,
    reload: loadSource,
    save
  } = useProjectTextFile({
    enabled: !!currentProject,
    filePath: activeSourcePath,
    emptyContent: emptySourceTemplate,
    onLoadMissing: () => {
      addToast(
        'info',
        `尚未发现 ${describeProjectArtifact('sourceNovel', currentProject?.config)}，已为你准备默认模板`
      )
    },
    onSaveSuccess: async () => {
      await syncEpisodeStatus()
      addToast(
        'success',
        sourceViewMode === 'chapter' ? '章节原文已保存' : '小说原文已保存'
      )
    }
  })

  const {
    importMarkdown: handleImportMarkdown,
    saveDocument: handleSave,
    ensureSaved
  } = useDocumentEditorActions({
    setContent,
    save,
    addToast
  })

  useEffect(() => {
    if (!currentProject) {
      setLegacyNovelDetected(false)
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const detected = await inspectProjectDirectory(
          currentProject.projectPath
        )
        const sourceCheck = detected.integrity?.checks.find(
          (check) => check.id === 'source_novel'
        )
        const legacyNovel = !!sourceCheck?.repairActions?.some(
          (action) => action.id === 'migrate_legacy_novel'
        )
        if (!cancelled) {
          setLegacyNovelDetected(legacyNovel)
        }
      } catch {
        if (!cancelled) {
          setLegacyNovelDetected(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [currentProject?.id, currentProject?.projectPath])

  useEffect(() => {
    if (!currentProject) {
      setSourceChapters([])
      setSelectedChapterPath('')
      setSourceViewMode('full')
      return
    }

    let cancelled = false
    setLoadingChapters(true)
    ;(async () => {
      try {
        const chapters = await listSourceChapters(currentProject.id)
        if (cancelled) return
        setSourceChapters(chapters)
        setSelectedChapterPath((current) => {
          if (
            current &&
            chapters.some((chapter) => chapter.filePath === current)
          ) {
            return current
          }
          return chapters[0]?.filePath || ''
        })
        if (chapters.length > 0) {
          setSourceViewMode('chapter')
        }
      } catch {
        if (!cancelled) {
          setSourceChapters([])
          setSelectedChapterPath('')
        }
      } finally {
        if (!cancelled) {
          setLoadingChapters(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [currentProject?.id])

  const reloadSourceChapters = async () => {
    if (!currentProject) return
    setLoadingChapters(true)
    try {
      const chapters = await listSourceChapters(currentProject.id)
      setSourceChapters(chapters)
      setSelectedChapterPath((current) => {
        if (
          current &&
          chapters.some((chapter) => chapter.filePath === current)
        ) {
          return current
        }
        return chapters[0]?.filePath || ''
      })
      if (chapters.length === 0) {
        setSourceViewMode('full')
      }
      addToast('success', `已加载 ${chapters.length} 个章节文件`)
    } catch {
      addToast('error', '章节列表加载失败')
    } finally {
      setLoadingChapters(false)
    }
  }

  const handleSourceViewModeChange = async (nextMode: SourceViewMode) => {
    if (nextMode === sourceViewMode) return
    const savedOk = await ensureSaved(saved)
    if (!savedOk) return
    setSourceViewMode(nextMode)
  }

  const handleChapterSelect = async (filePath: string) => {
    if (!filePath || filePath === selectedChapterPath) return
    const savedOk = await ensureSaved(saved)
    if (!savedOk) return
    setSelectedChapterPath(filePath)
    setSourceViewMode('chapter')
  }

  const handleMigrateLegacyNovel = async () => {
    if (!currentProject) return
    setMigratingLegacyNovel(true)
    try {
      const result = await migrateLegacyNovelDirectory(
        currentProject.projectPath
      )
      if (!result.success) {
        addToast('error', result.message)
        return
      }
      await loadSource()
      await syncEpisodeStatus()
      setLegacyNovelDetected(false)
      await reloadSourceChapters()
      addToast(result.migrated ? 'success' : 'info', result.message)
    } catch {
      addToast('error', '迁移失败')
    } finally {
      setMigratingLegacyNovel(false)
    }
  }

  return (
    <DocumentWorkflowPage
      title="📚 小说原文"
      lineCount={content.split('\n').length}
      description={sourceDescription}
      saved={saved}
      content={content}
      onContentChange={setContent}
      toolbarVariant="source"
      workflow={{
        title: '准备小说原文',
        description:
          config.entryStage === 'script'
            ? '当前项目从剧本起步，原文可作为补充资料维护。'
            : '这里只维护小说原文和章节资料；生成哪一集剧情请到剧情拆解页选择。',
        steps: [
          {
            id: 'source',
            label: '小说原文',
            description:
              sourceViewMode === 'chapter'
                ? '正在编辑章节文件'
                : '正在编辑整本原文',
            state: content.trim() ? 'done' : 'active',
            stateLabel: content.trim() ? '已填写' : '待填写'
          },
          {
            id: 'chapters',
            label: '章节资料',
            description:
              sourceChapters.length > 0
                ? `已检测到 ${sourceChapters.length} 个章节文件`
                : '可使用整本原文，也可维护 source/chapters',
            state: sourceChapters.length > 0 ? 'done' : 'ready',
            stateLabel: sourceChapters.length > 0 ? '已分章' : '可选'
          },
          {
            id: 'story',
            label: '剧情拆解',
            description:
              config.entryStage === 'script'
                ? '当前项目通常跳过此步'
                : '在剧情页选择目标集数并生成剧情',
            state: config.entryStage === 'script' ? 'blocked' : 'ready',
            stateLabel: config.entryStage === 'script' ? '可跳过' : '去剧情页'
          }
        ],
        primaryAction: {
          label: '保存原文',
          onClick: handleSave,
          disabled: saved,
          variant: 'primary'
        },
        secondaryActions: [
          {
            label: '导入 Markdown',
            onClick: handleImportMarkdown
          },
          {
            label: '前往剧情',
            onClick: () =>
              currentProject && navigate(`/project/${currentProject.id}/story`)
          }
        ]
      }}
      sidePanel={
        sourceChapters.length > 0 ? (
          <div className="source-chapter-panel">
            <div className="source-chapter-panel-header">
              <div>
                <div className="source-chapter-panel-title">章节文件</div>
                <div className="source-chapter-panel-meta">
                  {sourceChapters.length} 章 · source/chapters
                </div>
              </div>
              <button
                className="btn btn-sm"
                onClick={reloadSourceChapters}
                disabled={loadingChapters}
                title="重新读取章节目录"
              >
                ↻
              </button>
            </div>
            <div className="source-chapter-list">
              {sourceChapters.map((chapter) => (
                <button
                  key={chapter.filePath}
                  className={`source-chapter-item${
                    chapter.filePath === selectedChapterPath ? ' active' : ''
                  }`}
                  onClick={() => handleChapterSelect(chapter.filePath)}
                  title={chapter.fileName}
                >
                  <span className="source-chapter-index">
                    {String(chapter.index).padStart(2, '0')}
                  </span>
                  <span className="source-chapter-name">{chapter.title}</span>
                </button>
              ))}
            </div>
          </div>
        ) : undefined
      }
      toolbarActions={
        <div className="source-toolbar">
          {sourceChapters.length > 0 && (
            <div className="source-toolbar-group">
              <span className="source-toolbar-label">范围</span>
              <div className="editor-segmented">
                <button
                  className={sourceViewMode === 'full' ? 'active' : ''}
                  onClick={() => handleSourceViewModeChange('full')}
                >
                  整本
                </button>
                <button
                  className={sourceViewMode === 'chapter' ? 'active' : ''}
                  onClick={() => handleSourceViewModeChange('chapter')}
                >
                  章节
                </button>
              </div>
            </div>
          )}
          {sourceChapters.length > 0 && sourceViewMode === 'chapter' && (
            <label className="source-toolbar-field source-toolbar-chapter">
              <span className="source-toolbar-label">章节</span>
              <select
                className="input input-sm source-chapter-select"
                value={selectedChapterPath}
                onChange={(e) => handleChapterSelect(e.target.value)}
              >
                {sourceChapters.map((chapter) => (
                  <option key={chapter.filePath} value={chapter.filePath}>
                    {String(chapter.index).padStart(2, '0')} · {chapter.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="source-toolbar-actions">
            <button className="btn btn-sm" onClick={handleImportMarkdown}>
              导入 Markdown
            </button>
            {legacyNovelDetected && (
              <button
                className="btn btn-sm btn-primary"
                onClick={handleMigrateLegacyNovel}
                disabled={migratingLegacyNovel}
              >
                {migratingLegacyNovel ? '迁移中...' : '迁移旧版目录'}
              </button>
            )}
            <button className="btn btn-sm" onClick={loadSource}>
              重新加载
            </button>
          </div>
        </div>
      }
    />
  )
}
