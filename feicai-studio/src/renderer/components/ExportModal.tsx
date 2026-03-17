import { useState } from 'react'
import { IPC } from '@shared/ipc-channels'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'
import './ExportModal.css'

type ExportFormat = 'markdown' | 'json' | 'csv'

interface ExportModalProps {
  open: boolean
  onClose: () => void
}

const FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string; desc: string }> = [
  { value: 'markdown', label: '📄 Markdown', desc: '完整 Markdown 文档' },
  { value: 'json', label: '📋 JSON', desc: '结构化数据（便于程序处理）' },
  { value: 'csv', label: '📊 CSV', desc: '表格格式（便于 Excel 打开）' }
]

export default function ExportModal({ open, onClose }: ExportModalProps) {
  const { currentProject, episodes } = useProjectStore()
  const addToast = useToastStore(s => s.addToast)

  const [format, setFormat] = useState<ExportFormat>('markdown')
  const [epStart, setEpStart] = useState(1)
  const [epEnd, setEpEnd] = useState(episodes.length || 30)
  const [exporting, setExporting] = useState(false)

  if (!open) return null

  const handleExportPrompts = async () => {
    if (!currentProject) return
    setExporting(true)
    try {
      const range: number[] = []
      for (let i = epStart; i <= epEnd; i++) range.push(i)

      const result = await window.feicaiAPI.invoke(IPC.EXPORT_PROMPTS, {
        projectPath: currentProject.projectPath,
        projectName: currentProject.name,
        episodeRange: range,
        format
      }) as { success?: boolean; canceled?: boolean; path?: string; error?: string }

      if (result.canceled) {
        // 用户取消
      } else if (result.success) {
        addToast('success', `提示词已导出到 ${result.path}`)
        onClose()
      } else {
        addToast('error', result.error || '导出失败')
      }
    } catch {
      addToast('error', '导出失败')
    }
    setExporting(false)
  }

  const handleExportAll = async () => {
    if (!currentProject) return
    setExporting(true)
    try {
      const result = await window.feicaiAPI.invoke(IPC.EXPORT_ALL, {
        projectPath: currentProject.projectPath,
        projectName: currentProject.name
      }) as { success?: boolean; canceled?: boolean; path?: string; error?: string }

      if (result.canceled) {
        // 用户取消
      } else if (result.success) {
        addToast('success', `全部产出已导出到 ${result.path}`)
        onClose()
      } else {
        addToast('error', result.error || '导出失败')
      }
    } catch {
      addToast('error', '导出失败')
    }
    setExporting(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content export-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📦 导出</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* 提示词导出 */}
          <div className="export-section">
            <h3>📐 导出提示词</h3>

            <div className="export-row">
              <label className="text-secondary">集数范围</label>
              <div className="export-range">
                <input
                  type="number"
                  className="input input-sm"
                  min={1}
                  max={episodes.length || 30}
                  value={epStart}
                  onChange={e => setEpStart(parseInt(e.target.value) || 1)}
                />
                <span className="text-secondary">~</span>
                <input
                  type="number"
                  className="input input-sm"
                  min={1}
                  max={episodes.length || 30}
                  value={epEnd}
                  onChange={e => setEpEnd(parseInt(e.target.value) || 30)}
                />
              </div>
            </div>

            <div className="export-row">
              <label className="text-secondary">格式</label>
              <div className="export-formats">
                {FORMAT_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`btn btn-sm ${format === opt.value ? 'btn-primary' : ''}`}
                    onClick={() => setFormat(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              className="btn btn-primary"
              onClick={handleExportPrompts}
              disabled={exporting}
            >
              {exporting ? '⏳ 导出中...' : '📄 导出提示词'}
            </button>
          </div>

          <hr className="export-divider" />

          {/* 全部导出 */}
          <div className="export-section">
            <h3>📁 导出全部产出</h3>
            <p className="text-secondary export-desc">
              将 outputs/ 和 assets/ 目录完整复制到指定位置
            </p>
            <button
              className="btn"
              onClick={handleExportAll}
              disabled={exporting}
            >
              {exporting ? '⏳ 导出中...' : '📁 选择目录并导出'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
