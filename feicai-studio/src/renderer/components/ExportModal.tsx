import { useEffect, useMemo, useState } from 'react'
import { IPC } from '@shared/ipc-channels'
import { platformAPI } from '@renderer/platform/api'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'
import { BUILTIN_EXPORT_PROFILES, resolveBuiltinExportProfile } from '@shared/template-catalog'
import './ExportModal.css'

type ExportFormat = 'markdown' | 'json' | 'csv'

interface ExportModalProps {
  open: boolean
  onClose: () => void
  initialProfileId?: string
}

interface ExportResult {
  success?: boolean
  canceled?: boolean
  path?: string
  error?: string
  count?: number
}

const FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string; desc: string }> = [
  { value: 'markdown', label: '📄 Markdown', desc: '完整 Markdown 文档' },
  { value: 'json', label: '📋 JSON', desc: '结构化数据（便于程序处理）' },
  { value: 'csv', label: '📊 CSV', desc: '表格格式（便于 Excel 打开）' }
]

export default function ExportModal({ open, onClose, initialProfileId }: ExportModalProps) {
  const { currentProject, episodes } = useProjectStore()
  const addToast = useToastStore(s => s.addToast)
  const episodeNumbers = useMemo(
    () => episodes.map((ep) => ep.episodeNumber).sort((a, b) => a - b),
    [episodes]
  )
  const minEpisode = episodeNumbers[0] || 1
  const maxEpisode = episodeNumbers[episodeNumbers.length - 1] || 30

  const [format, setFormat] = useState<ExportFormat>('markdown')
  const [epStart, setEpStart] = useState(minEpisode)
  const [epEnd, setEpEnd] = useState(maxEpisode)
  const [profileId, setProfileId] = useState('export:review-pack')
  const [exporting, setExporting] = useState(false)
  const selectedProfile = useMemo(
    () => resolveBuiltinExportProfile(profileId),
    [profileId]
  )

  useEffect(() => {
    if (!open) {
      setExporting(false)
      return
    }
    const nextProfileId = initialProfileId || currentProject?.config.exportProfileId || 'export:review-pack'
    const nextProfile = resolveBuiltinExportProfile(nextProfileId)
    setFormat(nextProfile?.format || 'markdown')
    setEpStart(minEpisode)
    setEpEnd(maxEpisode)
    setProfileId(nextProfileId)
    setExporting(false)
  }, [open, currentProject?.id, currentProject?.config.exportProfileId, initialProfileId, minEpisode, maxEpisode])

  if (!open) return null

  const buildEpisodeRange = (): number[] => {
    const start = Math.max(minEpisode, Math.min(epStart, epEnd))
    const end = Math.min(maxEpisode, Math.max(epStart, epEnd))
    return episodeNumbers.filter((ep) => ep >= start && ep <= end)
  }

  const buildEpisodeRangeForProfile = (rangeMode: 'all' | 'selected'): number[] => {
    if (rangeMode === 'all') return episodeNumbers
    return buildEpisodeRange()
  }

  const finishExport = (result: ExportResult, successMessage: string) => {
    if (result.canceled) return
    if (result.success) {
      const suffix = result.path ? ` ${result.path}` : ''
      const countPrefix = typeof result.count === 'number' ? `已导出 ${result.count} 项，` : ''
      addToast('success', `${countPrefix}${successMessage}${suffix}`)
      onClose()
      return
    }
    addToast('error', result.error || '导出失败')
  }

  const handleExportPrompts = async () => {
    if (!currentProject) return
    setExporting(true)
    try {
      const range = buildEpisodeRange()
      if (range.length === 0) {
        addToast('error', '请选择有效的集数范围')
        return
      }

      const result = await platformAPI.invoke(IPC.EXPORT_PROMPTS, {
        projectPath: currentProject.projectPath,
        projectName: currentProject.name,
        episodeRange: range,
        format
      }) as ExportResult
      finishExport(result, '提示词已导出到')
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  const handleExportAll = async () => {
    if (!currentProject) return
    setExporting(true)
    try {
      const result = await platformAPI.invoke(IPC.EXPORT_ALL, {
        projectPath: currentProject.projectPath,
        projectName: currentProject.name
      }) as ExportResult
      finishExport(result, '全部产出已导出到')
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  const handleExportScripts = async (range = buildEpisodeRange(), successMessage = '剧本合集已导出到') => {
    if (!currentProject) return
    setExporting(true)
    try {
      if (range.length === 0) {
        addToast('error', '请选择有效的集数范围')
        return
      }

      const result = await platformAPI.invoke(IPC.EXPORT_SCRIPTS, {
        projectPath: currentProject.projectPath,
        projectName: currentProject.name,
        episodeRange: range
      }) as ExportResult
      finishExport(result, successMessage)
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  const handleExportByProfile = async () => {
    const profile = resolveBuiltinExportProfile(profileId)
    if (!profile || !currentProject) return

    if (profile.action === 'bundle') {
      await handleExportAll()
      return
    }

    const range = buildEpisodeRangeForProfile(profile.rangeMode)
    if (range.length === 0) {
      addToast('error', '当前模板没有可导出的有效集数范围')
      return
    }

    if (profile.action === 'scripts') {
      await handleExportScripts(range, `模板「${profile.label}」已导出到`)
      return
    }

    setFormat(profile.format || 'markdown')
    setExporting(true)
    try {
      const result = await platformAPI.invoke(IPC.EXPORT_PROMPTS, {
        projectPath: currentProject.projectPath,
        projectName: currentProject.name,
        episodeRange: range,
        format: profile.format || 'markdown'
      }) as ExportResult
      finishExport(result, `模板「${profile.label}」已导出到`)
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => { if (!exporting) onClose() }}>
      <div className="modal-content export-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📦 导出</h2>
          <button className="modal-close" onClick={onClose} disabled={exporting}>✕</button>
        </div>

        <div className="modal-body">
          <div className="export-section export-profile-section">
            <h3>🧩 导出模板</h3>
            <p className="text-secondary export-desc">
              用预设模板快速导出审阅包、数据包、剧本总稿或完整交付包。
            </p>
            <div className="export-profile-list">
              {BUILTIN_EXPORT_PROFILES.map((profile) => (
                <button
                  key={profile.id}
                  className={`export-profile-card ${profileId === profile.id ? 'is-active' : ''}`}
                  onClick={() => {
                    setProfileId(profile.id)
                    if (profile.format) setFormat(profile.format)
                  }}
                >
                  <strong>{profile.label}</strong>
                  <span>{profile.description}</span>
                </button>
              ))}
            </div>
            {selectedProfile && (
              <div className="export-profile-meta text-secondary">
                <span>动作：{selectedProfile.action === 'bundle' ? '完整交付包' : selectedProfile.action === 'scripts' ? '剧本总稿' : '提示词导出'}</span>
                <span>范围：{selectedProfile.rangeMode === 'all' ? '全量' : '当前选择集数'}</span>
                {selectedProfile.format && <span>格式：{selectedProfile.format.toUpperCase()}</span>}
              </div>
            )}
            <button className="btn btn-primary" onClick={handleExportByProfile} disabled={exporting}>
              {exporting ? '⏳ 导出中...' : '🚀 按模板导出'}
            </button>
          </div>

          <hr className="export-divider" />

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
                  max={maxEpisode}
                  value={epStart}
                  onChange={e => setEpStart(parseInt(e.target.value) || 1)}
                />
                <span className="text-secondary">~</span>
                <input
                  type="number"
                  className="input input-sm"
                  min={1}
                  max={maxEpisode}
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

          {/* 剧本合集导出 */}
          <div className="export-section">
            <h3>📖 导出合并剧本</h3>
            <p className="text-secondary export-desc">
              将所有分散的单集剧本（epXX.md）首尾相接，融合成一份连贯的总剧本。
            </p>
            <button
              className="btn btn-primary"
              onClick={handleExportScripts}
              disabled={exporting}
            >
              {exporting ? '⏳ 拼接合并中...' : '📖 导出合集成稿'}
            </button>
          </div>

          <hr className="export-divider" />

          {/* 全部导出 */}
          <div className="export-section">
            <h3>📁 导出全部产出</h3>
            <p className="text-secondary export-desc">
              导出当前交付包：包含当前版本产物、artifact manifest、审核快照与运行来源信息，便于归档和交接。
            </p>
            <button
              className="btn"
              onClick={handleExportAll}
              disabled={exporting}
            >
              {exporting ? '⏳ 打包中...' : '📁 选择目录备份全站资产'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
