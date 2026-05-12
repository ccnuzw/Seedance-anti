import { useProjectPageController } from '@renderer/hooks/useProjectPageController'
import ProjectIntegrityCard from '@renderer/components/project/ProjectIntegrityCard'
import ProjectPipelineSettingsPanel from '@renderer/components/project/ProjectPipelineSettingsPanel'
import ProjectEpisodeCollection from '@renderer/components/project/ProjectEpisodeCollection'
import './ProjectPage.css'

export default function ProjectPage() {
  const controller = useProjectPageController()
  const waterline = controller.plotBreakdownSummary
  const waterlineStatusLabel =
    waterline?.waterlineStatus === 'ready'
      ? '库存充足'
      : waterline?.waterlineStatus === 'low'
        ? '即将用尽'
        : waterline?.waterlineStatus === 'empty'
          ? '需要拆解'
          : '已完成'
  const chapterRangeLabel =
    waterline?.chapterStart && waterline?.chapterEnd
      ? `第 ${waterline.chapterStart}-${waterline.chapterEnd} 章`
      : '尚未拆解'
  const targetRangeLabel = waterline?.targetChapterLimit
    ? `第 1-${waterline.targetChapterLimit} 章`
    : '未设置'
  const nextChapterRangeLabel =
    waterline?.nextChapterStart && waterline?.nextChapterEnd
      ? `第 ${waterline.nextChapterStart}-${waterline.nextChapterEnd} 章`
      : '无待拆批次'
  const remainingBatchLabel =
    waterline?.remainingBatchCount != null
      ? `${waterline.remainingBatchCount} 批`
      : '未统计'

  if (!controller.currentProject) {
    return (
      <>
        <div className="project-empty-state">
          <div className="empty-icon">📂</div>
          <h2>选择一个项目</h2>
          <p className="text-secondary">从仪表盘选择现有项目，或导入新项目</p>
          <button
            className="btn btn-primary"
            onClick={controller.handleImportProject}
            disabled={controller.importing}
          >
            {controller.importing ? '⏳ 导入中...' : '📁 导入 FEICAI 项目'}
          </button>
        </div>
        {controller.pendingImport?.detected.integrity && (
          <ProjectIntegrityCard
            title="🧪 导入前体检"
            report={controller.pendingImport.detected.integrity}
            onConfirm={
              controller.pendingImport.config
                ? controller.confirmImportProject
                : undefined
            }
            onCancel={() => controller.setPendingImport(null)}
            confirmLabel="继续导入"
          />
        )}
      </>
    )
  }

  return (
    <div className="project-page">
      <div className="project-header">
        <div className="project-info">
          <h1 className="project-name">🎬 {controller.currentProject.name}</h1>
          <div className="project-meta text-secondary">
            <span>{controller.currentProject.visualStyle}</span>
            <span className="meta-sep">·</span>
            <span>{controller.currentProject.targetMedium}</span>
            <span className="meta-sep">·</span>
            <span>{controller.currentProject.totalEpisodes} 集</span>
          </div>
        </div>
        <div className="project-actions">
          <button
            className="btn"
            onClick={() => void controller.handleRefreshStatus()}
          >
            ↻ 刷新状态
          </button>
          <button
            className="btn btn-primary"
            onClick={() =>
              controller.navigate(
                `/project/${controller.currentProject?.id}/pipeline`
              )
            }
          >
            ▶ 流水线
          </button>
        </div>
      </div>

      <ProjectPipelineSettingsPanel
        entryLabel={controller.entryLabel}
        showSettings={controller.showSettings}
        setShowSettings={controller.setShowSettings}
        setPsLoaded={controller.setPsLoaded}
        ps={controller.ps}
        setPs={controller.setPs}
        projectDraft={controller.projectDraft}
        setProjectDraft={controller.setProjectDraft}
        visualStyles={controller.visualStyles}
        targetMediums={controller.targetMediums}
        psSaving={controller.psSaving}
        onReset={controller.handleResetSettings}
        onSave={() => {
          void controller.handleSaveSettings()
        }}
      />

      <div className="card plot-breakdown-waterline">
        <div className="pipeline-settings-header">
          <div>
            <h3>剧情库存水位</h3>
            <p className="waterline-subtitle">
              {waterline?.exists
                ? waterline.nextActionLabel
                : '尚未创建库存，先执行剧情拆解生成 plot-breakdown.md'}
            </p>
          </div>
          <span
            className={`waterline-status waterline-status--${waterline?.waterlineStatus || 'empty'}`}
          >
            {waterlineStatusLabel}
          </span>
        </div>
        <div className="waterline-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={() =>
              controller.navigate(
                `/project/${controller.currentProject?.id}/batch?mode=smart_next`
              )
            }
            disabled={!waterline || waterline.nextActionMode === 'done'}
          >
            🧭 智能下一步
          </button>
          <button
            className="btn btn-sm"
            onClick={() =>
              controller.navigate(
                `/project/${controller.currentProject?.id}/batch?mode=story_until_ready`
              )
            }
            disabled={!waterline || waterline.unprocessedChapterCount === 0}
          >
            📚 拆到库存充足
          </button>
          <button
            className="btn btn-sm"
            onClick={() =>
              controller.navigate(
                `/project/${controller.currentProject?.id}/batch?mode=script_until_empty`
              )
            }
            disabled={!waterline || waterline.unusedEntries === 0}
          >
            📖 生成到库存用完
          </button>
        </div>
        <div className="plot-breakdown-stats">
          <div className="project-health-stat">
            <span className="text-secondary">剧情点总数</span>
            <strong>{waterline?.totalEntries ?? 0}</strong>
          </div>
          <div className="project-health-stat">
            <span className="text-secondary">未用剧情点</span>
            <strong>{waterline?.unusedEntries ?? 0}</strong>
          </div>
          <div className="project-health-stat">
            <span className="text-secondary">已用剧情点</span>
            <strong>{waterline?.usedEntries ?? 0}</strong>
          </div>
          <div className="project-health-stat">
            <span className="text-secondary">可生成剧本</span>
            <strong>{waterline?.readyEpisodeCount ?? 0} 集</strong>
          </div>
        </div>
        <div className="status-dashboard-grid">
          <div className="status-dashboard-item">
            <div className="status-dashboard-label">拆解进度</div>
            <strong>{waterline?.breakdownProgressPct ?? 0}%</strong>
            <div className="status-progress-bar">
              <span
                style={{ width: `${waterline?.breakdownProgressPct ?? 0}%` }}
              />
            </div>
          </div>
          <div className="status-dashboard-item">
            <div className="status-dashboard-label">剧本消耗进度</div>
            <strong>{waterline?.scriptProgressPct ?? 0}%</strong>
            <div className="status-progress-bar">
              <span style={{ width: `${waterline?.scriptProgressPct ?? 0}%` }} />
            </div>
          </div>
          <div className="status-dashboard-item">
            <div className="status-dashboard-label">剩余批次</div>
            <strong>{remainingBatchLabel}</strong>
            <p>{nextChapterRangeLabel}</p>
          </div>
          <div className="status-dashboard-item">
            <div className="status-dashboard-label">建议动作</div>
            <strong>{waterlineStatusLabel}</strong>
            <p>{waterline?.nextActionLabel || '暂无建议'}</p>
          </div>
        </div>
        <div className="waterline-detail-grid">
          <div className="waterline-detail">
            <span>已拆章节</span>
            <strong>{chapterRangeLabel}</strong>
          </div>
          <div className="waterline-detail">
            <span>目标范围</span>
            <strong>{targetRangeLabel}</strong>
          </div>
          <div className="waterline-detail">
            <span>未拆章节</span>
            <strong>
              {waterline?.unprocessedChapterCount == null
                ? '未统计'
                : `${waterline.unprocessedChapterCount} 章`}
            </strong>
          </div>
          <div className="waterline-detail">
            <span>下一批次</span>
            <strong>第 {waterline?.nextBatchNumber ?? 1} 批</strong>
          </div>
          <div className="waterline-detail">
            <span>源章节总数</span>
            <strong>{waterline?.totalSourceChapters ?? 0} 章</strong>
          </div>
          <div className="waterline-detail">
            <span>超出目标</span>
            <strong>{waterline?.overflowChapterCount ?? 0} 章</strong>
          </div>
        </div>
      </div>

      <div className="card chapter-scan-panel">
        <div className="pipeline-settings-header">
          <div>
            <h3>章节扫描</h3>
            <p className="waterline-subtitle">
              对齐旧版 /scan：确认目标范围、下一批章节和超出目标章节。
            </p>
          </div>
          <button
            className="btn btn-sm"
            onClick={() => void controller.handleRefreshStatus()}
          >
            ↻ 重新扫描
          </button>
        </div>
        <div className="chapter-scan-grid">
          <div className="chapter-scan-row">
            <span>源章节总数</span>
            <strong>{waterline?.totalSourceChapters ?? 0} 章</strong>
          </div>
          <div className="chapter-scan-row">
            <span>目标处理范围</span>
            <strong>{targetRangeLabel}</strong>
          </div>
          <div className="chapter-scan-row">
            <span>已拆章节范围</span>
            <strong>{chapterRangeLabel}</strong>
          </div>
          <div className="chapter-scan-row">
            <span>下一批章节</span>
            <strong>{nextChapterRangeLabel}</strong>
          </div>
          <div className="chapter-scan-row">
            <span>目标内剩余</span>
            <strong>
              {waterline?.unprocessedChapterCount == null
                ? '未统计'
                : `${waterline.unprocessedChapterCount} 章`}
            </strong>
          </div>
          <div className="chapter-scan-row">
            <span>超出目标</span>
            <strong>{waterline?.overflowChapterCount ?? 0} 章</strong>
          </div>
        </div>
      </div>

      <ProjectEpisodeCollection
        currentProject={controller.currentProject}
        episodes={controller.episodes}
        viewMode={controller.viewMode}
        setViewMode={controller.setViewMode}
        progressPct={controller.progress.progressPct}
        completedCount={controller.progress.completedCount}
        navigateToPipeline={(episodeNumber) =>
          controller.navigate(
            `/project/${controller.currentProject?.id}/pipeline${episodeNumber ? `?ep=${episodeNumber}` : ''}`
          )
        }
      />
    </div>
  )
}
