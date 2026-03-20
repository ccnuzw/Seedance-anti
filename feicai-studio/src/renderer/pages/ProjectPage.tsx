import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useAdaptStore } from '@renderer/stores/adaptStore'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { useToastStore } from '@renderer/stores/toastStore'
import { IPC } from '@shared/ipc-channels'
import type { Episode, PipelineSettings } from '@shared/types'
import { DEFAULT_PIPELINE_SETTINGS } from '@shared/types'
import EmptyState from '@renderer/components/layout/EmptyState'
import './ProjectPage.css'

const STATUS_MAP: Record<string, { label: string; emoji: string; cls: string }> = {
  idle: { label: '等待', emoji: '⏳', cls: 'badge-info' },
  director: { label: '导演分析中', emoji: '🎬', cls: 'badge-warning' },
  art: { label: '服化道中', emoji: '🎨', cls: 'badge-warning' },
  storyboard: { label: '分镜中', emoji: '📐', cls: 'badge-warning' },
  complete: { label: '已完成', emoji: '✅', cls: 'badge-success' }
}

export default function ProjectPage() {
  useProjectSync()
  const navigate = useNavigate()
  const { currentProject, episodes, syncEpisodeStatus, updatePhase } = useProjectStore()
  const { waterLevel, novelInfo, fetchStatus } = useAdaptStore()
  const { addToast } = useToastStore()
  const [importing, setImporting] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card')
  const [ps, setPs] = useState<PipelineSettings>({ ...DEFAULT_PIPELINE_SETTINGS })
  const [psLoaded, setPsLoaded] = useState(false)
  const [psSaving, setPsSaving] = useState(false)

  useEffect(() => {
    if (currentProject) {
      syncEpisodeStatus()
      // 获取编剧管线状态
      if (currentProject.sourceType === 'novel') {
        fetchStatus(currentProject.projectPath)
      }
    }
  }, [currentProject])

  // 展开设置时加载 project-config.json
  useEffect(() => {
    if (!showSettings || !currentProject || psLoaded) return
    ;(async () => {
      try {
        const raw = await window.feicaiAPI.invoke(
          IPC.FILE_READ,
          `${currentProject.projectPath}/project-config.json`
        ) as string | null
        if (!raw) throw new Error('config not found')
        const config = JSON.parse(raw)
        setPs({ ...DEFAULT_PIPELINE_SETTINGS, ...(config.pipelineSettings || {}) })
      } catch {
        setPs({ ...DEFAULT_PIPELINE_SETTINGS })
      }
      setPsLoaded(true)
    })()
  }, [showSettings, currentProject, psLoaded])

  const handleSaveSettings = async () => {
    if (!currentProject) return
    setPsSaving(true)
    try {
      let config: Record<string, unknown> = {}
      try {
        const raw = await window.feicaiAPI.invoke(
          IPC.FILE_READ,
          `${currentProject.projectPath}/project-config.json`
        ) as string | null
        if (!raw) throw new Error('config not found')
        config = JSON.parse(raw)
      } catch { /* 文件不存在 */ }
      config.pipelineSettings = ps
      await window.feicaiAPI.invoke(
        IPC.FILE_WRITE,
        `${currentProject.projectPath}/project-config.json`,
        JSON.stringify(config, null, 2)
      )
      addToast('success', '流水线参数已保存')
    } catch {
      addToast('error', '保存失败')
    }
    setPsSaving(false)
  }

  const handleResetSettings = () => {
    setPs({ ...DEFAULT_PIPELINE_SETTINGS })
    addToast('info', '已恢复默认值（需保存生效）')
  }

  const handleImportProject = async () => {
    setImporting(true)
    const dirPath = await window.feicaiAPI.invoke(IPC.FILE_SELECT_DIR) as string | null
    if (dirPath) {
      try {
        const configRaw = await window.feicaiAPI.invoke(IPC.FILE_READ, `${dirPath}/project-config.json`) as string | null
        if (!configRaw) throw new Error('config not found')
        const config = JSON.parse(configRaw)
        const project = await useProjectStore.getState().createProject({
          name: config.projectName || '未命名项目',
          sourceType: 'script',
          phase: 'production',
          visualStyle: config.visualStyle || '',
          targetMedium: config.targetMedium || '',
          projectPath: dirPath,
          totalEpisodes: config.totalEpisodes || 0,
          config
        })
        useProjectStore.getState().setCurrentProject(project)
        addToast('success', `项目「${project.name}」导入成功`)
      } catch {
        addToast('error', '项目导入失败：请确认目录包含 project-config.json')
      }
    }
    setImporting(false)
  }

  const handleUpgradePhase = async () => {
    await updatePhase('production')
    addToast('success', '已进入制作阶段')
    syncEpisodeStatus()
  }

  if (!currentProject) {
    return (
      <EmptyState
        icon="📂"
        title="选择一个项目"
        description="从仪表盘选择现有项目，或导入新项目"
        action={{
          label: importing ? '⏳ 导入中...' : '📁 导入 FEICAI 项目',
          onClick: handleImportProject
        }}
      />
    )
  }

  const isWriting = currentProject.phase === 'writing'
  const isProduction = currentProject.phase === 'production'
  const isNovel = currentProject.sourceType === 'novel'

  const completedCount = episodes.filter(e => e.status === 'complete').length
  const progressPct = episodes.length > 0 ? Math.round((completedCount / episodes.length) * 100) : 0

  // 编剧进度
  const hasScripts = episodes.some(e => e.hasScript)
  const scriptCount = episodes.filter(e => e.hasScript).length

  // 全流程步骤
  const flowSteps = [
    { key: 'novel', label: '小说导入', icon: '📖', done: isNovel && !!novelInfo },
    { key: 'script', label: '剧本生成', icon: '✍️', done: hasScripts },
    { key: 'production', label: '视频提示词', icon: '🎬', done: completedCount > 0 },
  ]

  const sourceLabel = currentProject.sourceType === 'novel'
    ? '📖 网文改编'
    : currentProject.sourceType === 'original'
      ? '✍️ 原创剧本'
      : '📁 导入项目'

  return (
    <div className="project-page">
      {/* 项目头部 */}
      <div className="page-header-top">
        <div className="project-info">
          <h1 className="page-title-xl">🎬 {currentProject.name}</h1>
          <div className="project-meta text-secondary">
            <span className="project-source-badge">{sourceLabel}</span>
            <span className={`project-phase-badge ${isWriting ? 'phase-writing' : 'phase-production'}`}>
              {isWriting ? '📖 编剧阶段' : '🎬 制作阶段'}
            </span>
            {currentProject.visualStyle && (
              <><span className="meta-sep">·</span><span>{currentProject.visualStyle}</span></>
            )}
            {currentProject.targetMedium && (
              <><span className="meta-sep">·</span><span>{currentProject.targetMedium}</span></>
            )}
            {currentProject.totalEpisodes > 0 && (
              <><span className="meta-sep">·</span><span>{currentProject.totalEpisodes} 集</span></>
            )}
          </div>
        </div>
        <div className="page-actions">
          <button
            className={`btn ${showSettings ? 'btn-active' : ''}`}
            onClick={() => { setShowSettings(!showSettings); setPsLoaded(false) }}
          >
            ⚙️ 设置
          </button>
          {isProduction && (
            <button className="btn btn-primary" onClick={() => navigate(`/project/${currentProject.id}/pipeline`)}>
              ▶ 流水线
            </button>
          )}
          {isWriting && (
            <button className="btn btn-primary" onClick={() => navigate(`/project/${currentProject.id}/novel`)}>
              📖 编剧管线
            </button>
          )}
        </div>
      </div>

      {/* 全流程进度条（仅网文改编项目显示） */}
      {isNovel && (
        <div className="flow-progress-bar">
          {flowSteps.map((step, i) => (
            <div key={step.key} className="flow-step-wrapper">
              <div className={`flow-step ${step.done ? 'flow-done' : ''} ${
                (isWriting && step.key !== 'production') || (isProduction && step.key === 'production')
                  ? 'flow-current' : ''
              }`}>
                <span className="flow-icon">{step.done ? '✅' : step.icon}</span>
                <span className="flow-label">{step.label}</span>
              </div>
              {i < flowSteps.length - 1 && (
                <div className={`flow-connector ${step.done ? 'flow-connector-done' : ''}`} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* 流水线参数设置面板 */}
      {showSettings && (
        <div className="card pipeline-settings-panel">
          <div className="pipeline-settings-header">
            <h3>⚙️ 流水线参数</h3>
            <span className="text-secondary text-xs">
              调整后需点击「保存」生效，参数将写入 project-config.json
            </span>
          </div>
          <div className="pipeline-settings-grid">
            <div className="ps-item">
              <label>最大重试次数</label>
              <span className="ps-desc text-secondary">审核不通过时的自动重试上限</span>
              <input type="number" className="input input-sm" min={1} max={10} value={ps.maxRetries}
                onChange={e => setPs({ ...ps, maxRetries: Number(e.target.value) })} />
            </div>
            <div className="ps-item">
              <label>审核通过阈值</label>
              <span className="ps-desc text-secondary">评分 ≥ 此值即 PASS（1-10 分）</span>
              <input type="number" className="input input-sm" min={1} max={10} value={ps.passScore}
                onChange={e => setPs({ ...ps, passScore: Number(e.target.value) })} />
            </div>
            <div className="ps-item">
              <label>LLM 超时 (秒)</label>
              <span className="ps-desc text-secondary">无新数据超过此时间则中断</span>
              <input type="number" className="input input-sm" min={30} max={300} value={ps.llmTimeoutSec}
                onChange={e => setPs({ ...ps, llmTimeoutSec: Number(e.target.value) })} />
            </div>
            <div className="ps-item">
              <label>每集最短时长 (秒)</label>
              <span className="ps-desc text-secondary">生成提示词的最短总时长约束</span>
              <input type="number" className="input input-sm" min={30} max={600} value={ps.durationMin}
                onChange={e => setPs({ ...ps, durationMin: Number(e.target.value) })} />
            </div>
            <div className="ps-item">
              <label>每集最长时长 (秒)</label>
              <span className="ps-desc text-secondary">生成提示词的最长总时长约束</span>
              <input type="number" className="input input-sm" min={30} max={600} value={ps.durationMax}
                onChange={e => setPs({ ...ps, durationMax: Number(e.target.value) })} />
            </div>
            <div className="ps-item">
              <label>单条提示词上限 (秒)</label>
              <span className="ps-desc text-secondary">每条 Seedance 提示词的时长上限</span>
              <input type="number" className="input input-sm" min={4} max={15} value={ps.singlePromptMax}
                onChange={e => setPs({ ...ps, singlePromptMax: Number(e.target.value) })} />
            </div>
          </div>
          <div className="pipeline-settings-actions">
            <button className="btn btn-sm" onClick={handleResetSettings}>🔄 恢复默认</button>
            <button className="btn btn-sm btn-primary" onClick={handleSaveSettings} disabled={psSaving}>
              {psSaving ? '⏳ 保存中...' : '💾 保存'}
            </button>
          </div>
        </div>
      )}

      {/* 编剧阶段卡片 */}
      {isNovel && (
        <div className="card writing-stage-card">
          <div className="stage-card-header">
            <h3>📖 编剧阶段</h3>
            {isWriting && <span className="stage-badge stage-active">进行中</span>}
            {isProduction && <span className="stage-badge stage-done">已完成</span>}
          </div>
          <div className="writing-stats-grid">
            <div className="writing-stat">
              <span className="ws-icon">📚</span>
              <div className="ws-info">
                <span className="ws-value">{novelInfo?.title || currentProject.novelTitle || '—'}</span>
                <span className="ws-label text-secondary">小说标题</span>
              </div>
            </div>
            <div className="writing-stat">
              <span className="ws-icon">📊</span>
              <div className="ws-info">
                <span className="ws-value">
                  {waterLevel
                    ? `${waterLevel.processedChapters} / ${waterLevel.totalChapters}`
                    : novelInfo?.totalChapters || '—'}
                </span>
                <span className="ws-label text-secondary">章节拆解</span>
              </div>
            </div>
            <div className="writing-stat">
              <span className="ws-icon">🎯</span>
              <div className="ws-info">
                <span className="ws-value">{waterLevel?.totalPlots || '—'}</span>
                <span className="ws-label text-secondary">剧情点</span>
              </div>
            </div>
            <div className="writing-stat">
              <span className="ws-icon">✍️</span>
              <div className="ws-info">
                <span className="ws-value">{scriptCount > 0 ? scriptCount : '—'}</span>
                <span className="ws-label text-secondary">已生成剧本</span>
              </div>
            </div>
          </div>
          <div className="writing-actions">
            {isWriting && (
              <>
                <button className="btn btn-sm" onClick={() => navigate(`/project/${currentProject.id}/breakdown`)}>
                  📊 剧情拆解
                </button>
                <button className="btn btn-sm" onClick={() => navigate(`/project/${currentProject.id}/adapt-script`)}>
                  ✍️ 剧本创作
                </button>
                {hasScripts && (
                  <button className="btn btn-sm btn-primary" onClick={handleUpgradePhase}>
                    🚀 进入制作阶段
                  </button>
                )}
              </>
            )}
            {isProduction && (
              <button className="btn btn-sm" onClick={() => navigate(`/project/${currentProject.id}/adapt-script`)}>
                ✍️ 查看剧本
              </button>
            )}
          </div>
        </div>
      )}

      {/* 制作阶段 */}
      {isWriting && !hasScripts ? (
        <div className="card production-locked-card">
          <div className="production-locked-icon">🔒</div>
          <h3>制作阶段</h3>
          <p className="text-secondary">完成编剧管线（剧情拆解 → 剧本创作）后，将自动解锁制作管线</p>
        </div>
      ) : (
        <>
          {/* 进度概览 */}
          <div className="progress-section">
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="progress-text text-secondary">
              {completedCount} / {episodes.length} 集已完成 ({progressPct}%)
            </div>
          </div>

          {/* 视图切换 */}
          <div className="view-toggle">
            <button
              className={`view-toggle-btn ${viewMode === 'card' ? 'active' : ''}`}
              onClick={() => setViewMode('card')}
              title="卡片视图"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="1" width="6" height="6" rx="1" />
                <rect x="9" y="1" width="6" height="6" rx="1" />
                <rect x="1" y="9" width="6" height="6" rx="1" />
                <rect x="9" y="9" width="6" height="6" rx="1" />
              </svg>
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="列表视图"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="2" width="14" height="2" rx="0.5" />
                <rect x="1" y="7" width="14" height="2" rx="0.5" />
                <rect x="1" y="12" width="14" height="2" rx="0.5" />
              </svg>
            </button>
          </div>

          {/* 集数展示 */}
          {episodes.length === 0 ? (
            <EmptyState
              icon="📭"
              title="暂无集数数据"
              description={isWriting ? '请先完成编剧管线。' : '点击「流水线」开始处理。'}
            />
          ) : viewMode === 'card' ? (
            <div className="episode-grid">
              {episodes.map((ep) => {
                const status = STATUS_MAP[ep.status] || STATUS_MAP.idle
                const isComplete = ep.status === 'complete'
                return (
                  <div
                    key={ep.id}
                    className={`ep-card ${isComplete ? 'ep-card--done' : ''}`}
                    onClick={() => navigate(`/project/${currentProject.id}/pipeline?ep=${ep.episodeNumber}`)}
                  >
                    <div className={`ep-card-stripe ${isComplete ? 'stripe--done' : ''}`} />
                    <div className="ep-card-body">
                      <div className="ep-card-hero">
                        <span className="ep-num">{String(ep.episodeNumber).padStart(3, '0')}</span>
                        <div className="ep-card-hero-right">
                          <h3 className="ep-title">{ep.title || `第${ep.episodeNumber}集`}</h3>
                          <span className={`ep-status ${status.cls}`}>
                            {status.emoji} {status.label}
                          </span>
                        </div>
                      </div>
                      <div className="ep-artifacts-row">
                        <span className={`ep-artifact ${ep.hasScript ? 'on' : ''}`} title="剧本">📖 剧本</span>
                        <span className={`ep-artifact ${ep.hasDirectorAnalysis ? 'on' : ''}`} title="导演">🎬 导演</span>
                        <span className={`ep-artifact ${ep.hasArtDesign ? 'on' : ''}`} title="服化道">🎨 服化道</span>
                        <span className={`ep-artifact ${ep.hasSeedancePrompts ? 'on' : ''}`} title="提示词">📐 提示词</span>
                      </div>
                      <div className="ep-card-footer">
                        <span className="ep-meta">
                          {ep.totalPrompts != null ? `${ep.totalPrompts} 条提示词` : '—'}
                          <span className="ep-meta-dot">·</span>
                          {ep.totalDurationSeconds ? `${ep.totalDurationSeconds}s` : '—'}
                        </span>
                        <span className="ep-launch">启动 →</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="episode-table-wrapper">
              <table className="episode-table">
                <thead>
                  <tr>
                    <th>集数</th>
                    <th>标题</th>
                    <th>产物</th>
                    <th>状态</th>
                    <th>提示词数</th>
                    <th>总时长</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {episodes.map((ep) => {
                    const status = STATUS_MAP[ep.status] || STATUS_MAP.idle
                    return (
                      <tr key={ep.id} className="episode-row">
                        <td className="ep-number">EP{String(ep.episodeNumber).padStart(3, '0')}</td>
                        <td className="ep-title">{ep.title || '-'}</td>
                        <td>
                          <span className={`badge ${status.cls}`}>
                            {status.emoji} {status.label}
                          </span>
                        </td>
                        <td>
                          <div className="file-indicators">
                            <span className={`fi-dot ${ep.hasScript ? 'fi-script' : 'fi-missing'}`} title="剧本">📖</span>
                            <span className={`fi-dot ${ep.hasDirectorAnalysis ? 'fi-director' : 'fi-missing'}`} title="导演分析">🎬</span>
                            <span className={`fi-dot ${ep.hasArtDesign ? 'fi-art' : 'fi-missing'}`} title="服化道">🎨</span>
                            <span className={`fi-dot ${ep.hasSeedancePrompts ? 'fi-prompt' : 'fi-missing'}`} title="提示词">📐</span>
                          </div>
                        </td>
                        <td className="text-secondary">{ep.totalPrompts ?? '-'}</td>
                        <td className="text-secondary">
                          {ep.totalDurationSeconds ? `${ep.totalDurationSeconds}s` : '-'}
                        </td>
                        <td>
                          <button
                            className="btn btn-sm"
                            onClick={() => navigate(`/project/${currentProject.id}/pipeline?ep=${ep.episodeNumber}`)}
                          >
                            ▶
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
