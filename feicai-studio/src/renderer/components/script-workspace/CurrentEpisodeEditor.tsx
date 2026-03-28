import { Suspense, lazy } from 'react'

const MonacoMarkdownEditor = lazy(() => import('@renderer/components/editor/MonacoMarkdownEditor'))

interface LiveMeta {
  sceneCount: number
  dialogCount: number
  charCount: number
}

interface CurrentScriptInfo {
  filename: string
}

interface CurrentEpisodeEditorProps {
  currentEp: number
  liveTitle: string
  liveMeta: LiveMeta
  currentScript: CurrentScriptInfo | null
  pendingPlotForCurrent: boolean
  selectedEpisodeHasScript: boolean
  directorStageLabel: string
  directorStageTone: 'default' | 'info' | 'warning' | 'success' | 'danger'
  directorStatusHint: string
  hasDirectorOutput: boolean
  directorOutputLoading: boolean
  saved: boolean
  loading: boolean
  saving: boolean
  isRunning: boolean
  supportsGeneration: boolean
  previewOpen: boolean
  editorContent: string
  reviseTarget: number | null
  reviseNotes: string
  onEditorChange: (value: string) => void
  onReload: () => void
  onTogglePreview: () => void
  onSave: () => void
  onGenerateCurrent: () => void
  onRecreateCurrent: () => void
  onOpenRevise: () => void
  onLaunchPipeline: () => void
  onStartDirectorAnalysis: () => void
  onViewDirectorOutput: () => void
  onReviseNotesChange: (value: string) => void
  onSubmitRevise: () => void
  onCancelRevise: () => void
}

export default function CurrentEpisodeEditor({
  currentEp,
  liveTitle,
  liveMeta,
  currentScript,
  pendingPlotForCurrent,
  selectedEpisodeHasScript,
  directorStageLabel,
  directorStageTone,
  directorStatusHint,
  hasDirectorOutput,
  directorOutputLoading,
  saved,
  loading,
  saving,
  isRunning,
  supportsGeneration,
  previewOpen,
  editorContent,
  reviseTarget,
  reviseNotes,
  onEditorChange,
  onReload,
  onTogglePreview,
  onSave,
  onGenerateCurrent,
  onRecreateCurrent,
  onOpenRevise,
  onLaunchPipeline,
  onStartDirectorAnalysis,
  onViewDirectorOutput,
  onReviseNotesChange,
  onSubmitRevise,
  onCancelRevise
}: CurrentEpisodeEditorProps) {
  const draftStateLabel = currentScript ? '已生成剧本' : pendingPlotForCurrent ? '待补生成' : '待撰写'
  const sourceStateLabel = selectedEpisodeHasScript ? '已生成文件' : pendingPlotForCurrent ? '剧情已拆好' : '尚未拆到剧情'
  const generateActionLabel = pendingPlotForCurrent ? '补生成当前集' : '直接生成当前集'

  return (
    <>
      {reviseTarget !== null && (
        <div className="as-revise-card card">
          <div className="as-section-head">
            <h3>修订第 {String(reviseTarget).padStart(3, '0')} 集</h3>
            <button className="btn btn-sm" onClick={onCancelRevise}>
              关闭
            </button>
          </div>
          <textarea
            className="as-revise-textarea"
            value={reviseNotes}
            onChange={(event) => onReviseNotesChange(event.target.value)}
            placeholder="输入修订意见，例如：压缩第二场戏节奏、强化反转铺垫、补充人物动机。"
          />
          <div className="as-revise-actions">
            <button className="btn btn-primary" disabled={!reviseNotes.trim() || isRunning} onClick={onSubmitRevise}>
              提交修订
            </button>
            <button className="btn" onClick={onCancelRevise}>
              取消
            </button>
          </div>
        </div>
      )}

      <div className={`as-editor-card card ${currentScript ? 'is-ready' : 'is-empty'}`}>
        <div className="as-editor-head">
          <div className="as-editor-head-top">
            <div className="as-editor-title-group">
              <div className="as-editor-title-row">
                <h3>EP{String(currentEp).padStart(3, '0')} · {liveTitle}</h3>
                {currentScript && <span className="as-editor-file">{currentScript.filename}</span>}
              </div>
              <div className="as-editor-status-row">
                <span className={`as-editor-chip ${currentScript ? 'is-ready' : 'is-empty'}`}>{draftStateLabel}</span>
                <span className="as-editor-chip">{sourceStateLabel}</span>
              </div>
            </div>
            <div className="as-editor-utility-actions">
              <button className="btn btn-sm" onClick={onReload} disabled={loading || saving}>
                重新加载
              </button>
              <button className="btn btn-sm" onClick={onTogglePreview}>
                {previewOpen ? '收起预览' : '打开预览'}
              </button>
              <button className="btn btn-sm btn-primary" onClick={onSave} disabled={saved || saving || loading}>
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>

          <div className="as-editor-toolbar">
            <div className="as-editor-meta">
              <span className="as-editor-chip">场景 {liveMeta.sceneCount}</span>
              <span className="as-editor-chip">对白 {liveMeta.dialogCount}</span>
              <span className="as-editor-chip">字数 {liveMeta.charCount}</span>
            </div>
            <div className="as-editor-toolbar-note text-secondary text-xs">
              编辑完成后保存，再决定是继续修订还是送入制作。
            </div>
          </div>

          <div className={`as-director-stage-panel tone-${directorStageTone}`}>
            <div className="as-director-stage-copy">
              <div className="as-director-stage-title-row">
                <strong>导演阶段</strong>
                <span className={`status-chip tone-${directorStageTone}`}>{directorStageLabel}</span>
                {directorOutputLoading && <span className="text-secondary text-xs">读取结果中…</span>}
              </div>
              <p className="text-secondary">{directorStatusHint}</p>
            </div>
            <div className="as-director-stage-actions">
              <button
                className="btn btn-sm btn-primary"
                disabled={!currentScript || !saved || loading || saving || isRunning}
                onClick={onStartDirectorAnalysis}
              >
                启动导演分析（~start）
              </button>
              <button
                className="btn btn-sm"
                disabled={!hasDirectorOutput && !directorOutputLoading}
                onClick={onViewDirectorOutput}
              >
                查看导演结果
              </button>
            </div>
          </div>
        </div>

        <div className="as-editor-actions">
          <div className="as-editor-actions-main">
            {supportsGeneration && (
              <>
                {!currentScript && (
                  <button className="btn btn-sm" disabled={isRunning} onClick={onGenerateCurrent}>
                    {generateActionLabel}
                  </button>
                )}
                {currentScript && (
                  <button className="btn btn-sm" disabled={isRunning} onClick={onRecreateCurrent}>
                    重新生成当前集
                  </button>
                )}
                {currentScript && (
                  <button className="btn btn-sm" disabled={isRunning} onClick={onOpenRevise}>
                    按意见修订
                  </button>
                )}
              </>
            )}
          </div>
          <div className="as-editor-actions-primary">
            <button
              className="btn btn-sm btn-primary"
              disabled={!currentScript || !saved || loading || saving}
              onClick={onLaunchPipeline}
            >
              送入制作管线
            </button>
          </div>
        </div>

        <div className="as-editor-shell">
          <div className="as-editor-container monaco-wrapper">
            <Suspense fallback={<div className="text-secondary" style={{ padding: 16 }}>编辑器模块加载中...</div>}>
              <MonacoMarkdownEditor value={editorContent} onChange={(value) => value !== undefined && onEditorChange(value)} />
            </Suspense>
          </div>
        </div>
      </div>
    </>
  )
}
