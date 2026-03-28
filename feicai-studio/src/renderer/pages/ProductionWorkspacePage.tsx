import { memo, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import EmptyState from '@renderer/components/layout/EmptyState'
import SectionTabs, { type SectionTabItem } from '@renderer/components/layout/SectionTabs'
import { useProductionWorkspace, type ProductionTab } from '@renderer/hooks/useProductionWorkspace'
import { buildProjectRoute } from '@renderer/project-routing'
import AssetPage from './AssetPage'
import BatchPage from './BatchPage'
import PipelinePage from './PipelinePage'
import PromptPage from './PromptPage'
import ReviewPage from './ReviewPage'
import { platformAPI } from '@renderer/platform/api'
import './SectionPage.css'
import './ProductionWorkspacePage.css'

const ProductionMainContent = memo(function ProductionMainContent({ activeTab }: { activeTab: ProductionTab }) {
  if (activeTab === 'assets') return <AssetPage />
  if (activeTab === 'prompts') return <PromptPage embedded />
  if (activeTab === 'review') return <ReviewPage embedded />
  return <PipelinePage />
})

export default function ProductionWorkspacePage() {
  const navigate = useNavigate()
  const isWebPreview = platformAPI.isWebPreview
  const hasRemoteRuntime = platformAPI.capabilities.pipelineRuntime
  const {
    currentProject,
    activeTab,
    currentEpisode,
    currentEpisodeRecord,
    currentEpisodeStatusLabel,
    isRunning,
    state,
    context,
    scriptReadyCount,
    promptReadyCount,
    inProductionCount,
    completedCount,
    runningLogEntries,
    activeBatchRuns,
    batchDrawerOpen,
    currentProgressEpisode,
    currentPipelineStateLabel,
    artStageLabel,
    artReviewSummary,
    latestArtReview,
    artActionRunning,
    canStartArtStage,
    handleChangeTab,
    handleOpenBatchDrawer,
    handleCloseBatchDrawer,
    handleStartArtDesign
  } = useProductionWorkspace()

  const tabs = useMemo<SectionTabItem[]>(() => [
    { key: 'pipeline', label: '制作流程', hint: '导演到分镜' },
    { key: 'assets', label: '素材资产', hint: '角色与场景' },
    { key: 'prompts', label: '提示词', hint: '分镜产物与引用' },
    { key: 'review', label: '审核问题', hint: '制作质检与版本' }
  ], [])

  if (!currentProject) {
    return <EmptyState icon="🎬" title="请先选择一个项目" description="选择项目后，才能推进制作流程、提示词和审核收口。" />
  }

  if (currentProject.sourceType === 'novel' && currentProject.phase === 'writing') {
    return (
      <div className="section-page page-container page-wide">
        <div className="card section-page-lock">
          <h1>画面制作</h1>
          <p className="text-secondary">
            当前项目仍处于写作阶段。建议先在剧本创作里补齐剧本与问题，再通过交付导出检查是否进入制作。
          </p>
          <div className="section-page-lock-actions">
            <button className="btn btn-primary" onClick={() => navigate(buildProjectRoute(currentProject.id, 'delivery'))}>
              打开交付导出
            </button>
            <button className="btn" onClick={() => navigate(buildProjectRoute(currentProject.id, 'script'))}>
              回到剧本创作
            </button>
          </div>
        </div>
      </div>
    )
  }

  const productionGuidance = currentEpisodeRecord?.hasScript
    ? isRunning
      ? `当前正在推进 EP${String(context?.episodeNum || currentEpisode).padStart(3, '0')}，建议优先等待本轮阶段稳定，再切换到其他上下文。`
      : promptReadyCount < scriptReadyCount
        ? '当前仍有已成稿但未产出提示词的集数，建议优先补齐制作产物，再进入导出收尾。'
        : '当前制作基础较完整，可以围绕当前集继续检查提示词、审核结果与批量任务。'
    : '当前集缺少剧本，建议先回到剧本创作补齐成稿，再进入正式制作。'
  const productionRiskItems = [
    !currentEpisodeRecord?.hasScript ? '当前集缺剧本' : null,
    isRunning ? '存在运行中制作任务' : null,
    promptReadyCount < scriptReadyCount ? `还有 ${scriptReadyCount - promptReadyCount} 集待补提示词` : null,
    activeBatchRuns.length > 0 ? `最近有 ${activeBatchRuns.length} 个批量任务在队列中` : null
  ].filter((item): item is string => !!item)

  const artStageTone = artStageLabel.includes('失败')
    ? 'is-danger'
    : artStageLabel.includes('审核') || artStageLabel.includes('生成中')
      ? 'is-warning'
      : artStageLabel.includes('完成')
        ? 'is-success'
        : 'is-default'

  return (
    <div className="section-page page-container page-wide production-workspace-page">
      {isWebPreview && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--color-warning)' }}>
          <strong>{hasRemoteRuntime ? '网页远程制作模式' : '网页预览模式'}</strong>
          <p className="text-secondary" style={{ margin: '8px 0 0' }}>
            {hasRemoteRuntime
              ? '当前制作区已接入远程运行时。你可以在网页里直接推进制作流程、批量任务、提示词与审核记录。'
              : '当前浏览器本地模式主要用于浏览制作结构。真正的后台制作运行建议切换到远程 HTTP 或桌面端。'}
          </p>
        </div>
      )}
      <div className="card section-page-header production-workspace-header">
        <div className="section-page-copy">
          <h1>画面制作</h1>
          <p className="text-secondary">
            把制作流程、素材、提示词、审核和批量任务收在同一入口里，让制作动作跟着当前集数和当前运行上下文走。
          </p>
          <SectionTabs tabs={tabs} activeKey={activeTab} onChange={(key) => handleChangeTab(key as ProductionTab)} />
        </div>
        <div className="section-page-actions">
          <button className="btn" onClick={() => navigate(buildProjectRoute(currentProject.id, 'settings', 'tab=flow'))}>
            制作参数
          </button>
          <button className="btn" onClick={handleOpenBatchDrawer}>
            批量任务
          </button>
          <button className="btn btn-primary" onClick={() => navigate(buildProjectRoute(currentProject.id, 'delivery'))}>
            交付检查
          </button>
        </div>
      </div>

      <div className={`card action-guidance ${isRunning ? 'tone-warning' : currentEpisodeRecord?.hasScript ? 'tone-default' : 'tone-danger'}`}>
        <div className="production-side-head">
          <h3>制作动作提示</h3>
          <span className="text-secondary text-xs">
            {!currentEpisodeRecord?.hasScript ? '先补剧本再制作' : isRunning ? '先等待当前运行稳定' : '优先围绕当前集推进'}
          </span>
        </div>
        <p className="text-secondary">{productionGuidance}</p>
        {productionRiskItems.length > 0 && (
          <div className="action-guidance-list">
            {productionRiskItems.map((item) => (
              <span key={item} className="action-guidance-chip">{item}</span>
            ))}
          </div>
        )}
      </div>

      <div className="card production-art-quickstart">
        <div className="production-art-quickstart-head">
          <div>
            <h3>EP{String(currentEpisode).padStart(3, '0')} 服化道阶段</h3>
            <p className="text-secondary">从已完成导演分析的当前集，直接启动服化道设计（~design），并在这里看到运行、审核与结果状态。</p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => void handleStartArtDesign()}
            disabled={!canStartArtStage || artActionRunning}
          >
            {artActionRunning ? '启动中…' : '🎨 启动服化道设计（~design）'}
          </button>
        </div>
        <div className="production-art-quickstart-grid">
          <div className="production-art-status-block">
            <span className="production-summary-label">服化道状态</span>
            <strong>{artStageLabel}</strong>
            <div className="production-summary-meta">
              <span className={`status-chip ${artStageTone}`}>{artStageLabel}</span>
              <span className="status-chip">当前集状态：{currentEpisodeStatusLabel}</span>
              <span className="status-chip">流水线：{currentPipelineStateLabel}</span>
            </div>
          </div>
          <div className="production-art-status-block">
            <span className="production-summary-label">进入条件</span>
            <strong>{currentEpisodeRecord?.hasDirectorAnalysis ? '导演已完成' : '待导演完成'}</strong>
            <div className="production-summary-meta">
              <span className={`status-chip ${currentEpisodeRecord?.hasDirectorAnalysis ? 'is-success' : 'is-warning'}`}>
                {currentEpisodeRecord?.hasDirectorAnalysis ? '导演分析已就绪' : '缺少导演分析'}
              </span>
              <span className={`status-chip ${currentEpisodeRecord?.hasArtDesign ? 'is-success' : 'is-default'}`}>
                {currentEpisodeRecord?.hasArtDesign ? '服化道产物已生成' : '服化道产物未生成'}
              </span>
              <span className={`status-chip ${currentProgressEpisode?.hasAssetUpdates ? 'is-success' : 'is-default'}`}>
                {currentProgressEpisode?.hasAssetUpdates ? '已新增人物/场景提示词' : '等待新增提示词'}
              </span>
            </div>
          </div>
        </div>
        {artReviewSummary && (
          <div className={`production-art-feedback ${latestArtReview?.result === 'FAIL' ? 'is-warning' : 'is-success'}`}>
            <strong>{latestArtReview?.result === 'FAIL' ? '审核反馈 / 修改建议' : '审核结果'}</strong>
            <span>{artReviewSummary}</span>
          </div>
        )}
        {latestArtReview?.result === 'FAIL' && latestArtReview.issues.length > 0 && (
          <div className="production-art-issues">
            {latestArtReview.issues.slice(0, 3).map((issue, index) => (
              <div key={`${issue.description}-${index}`} className="production-art-issue-item">
                <strong>{issue.description}</strong>
                {issue.suggestion && <span className="text-secondary">建议：{issue.suggestion}</span>}
              </div>
            ))}
          </div>
        )}
        <div className="production-art-actions">
          <button className="btn" onClick={() => navigate(buildProjectRoute(currentProject.id, 'prompts', `ep=${currentEpisode}&tab=art`))}>
            查看服化道产物
          </button>
          <button className="btn" onClick={() => navigate(buildProjectRoute(currentProject.id, 'prompts', `ep=${currentEpisode}&tab=assets`))}>
            查看新增人物/场景提示词
          </button>
          <button className="btn" onClick={() => navigate(buildProjectRoute(currentProject.id, 'production', `ep=${currentEpisode}&tab=review`))}>
            打开审核问题
          </button>
        </div>
      </div>

      <div className="production-summary-grid">
        <div className="card production-summary-card production-summary-card--focus">
          <span className="production-summary-label">当前制作集</span>
          <strong>EP{String(currentEpisode).padStart(3, '0')}</strong>
          <div className="production-summary-meta">
            <span className={`status-chip ${currentEpisodeRecord?.hasSeedancePrompts ? 'is-success' : 'is-default'}`}>
              {currentEpisodeRecord?.hasSeedancePrompts ? '提示词已完成' : '提示词待生成'}
            </span>
            <span className={`status-chip ${currentEpisodeRecord?.hasScript ? 'is-success' : 'is-warning'}`}>
              {currentEpisodeRecord?.hasScript ? '剧本已就绪' : '缺剧本'}
            </span>
            <span className="status-chip">{currentEpisodeStatusLabel}</span>
          </div>
        </div>
        <div className="card production-summary-card">
          <span className="production-summary-label">可制作集数</span>
          <strong>{scriptReadyCount}</strong>
          <span className="text-secondary text-xs">已有剧本文件，可进入制作流程</span>
        </div>
        <div className="card production-summary-card">
          <span className="production-summary-label">提示词完成</span>
          <strong>{promptReadyCount}</strong>
          <span className="text-secondary text-xs">已有分镜提示词产物的集数</span>
        </div>
        <div className="card production-summary-card">
          <span className="production-summary-label">制作中</span>
          <strong>{inProductionCount}</strong>
          <span className="text-secondary text-xs">处于导演 / 美术 / 分镜阶段</span>
        </div>
        <div className="card production-summary-card">
          <span className="production-summary-label">已完成</span>
          <strong>{completedCount}</strong>
          <span className="text-secondary text-xs">已完成整集制作的数量</span>
        </div>
      </div>

      <div className="production-workspace-layout">
        <section className="production-workspace-main">
          <ProductionMainContent activeTab={activeTab} />
        </section>

        <aside className="production-workspace-side">
          <div className="card production-side-card">
            <div className="production-side-head">
              <h3>当前运行</h3>
              <span className={`status-chip ${isRunning ? 'is-warning' : 'is-success'}`}>
                {isRunning ? '运行中' : '空闲'}
              </span>
            </div>
            <div className="production-side-stack">
              <div className="production-side-row">
                <span className="text-secondary">引擎状态</span>
                <strong>{state}</strong>
              </div>
              <div className="production-side-row">
                <span className="text-secondary">运行集数</span>
                <strong>{context?.episodeNum ? `EP${String(context.episodeNum).padStart(3, '0')}` : '—'}</strong>
              </div>
              <div className="production-side-row">
                <span className="text-secondary">当前阶段</span>
                <strong>{context?.currentStage || '—'}</strong>
              </div>
            </div>
          </div>

          <div className="card production-side-card">
            <div className="production-side-head">
              <h3>最近批量任务</h3>
              <button className="btn btn-sm" onClick={handleOpenBatchDrawer}>
                打开
              </button>
            </div>
            {activeBatchRuns.length === 0 ? (
              <div className="text-secondary">当前没有最近的批量任务记录。</div>
            ) : (
              <div className="production-side-list">
                {activeBatchRuns.map((run) => (
                  <button
                    key={run.runId}
                    className="production-side-item"
                    onClick={handleOpenBatchDrawer}
                  >
                    <strong>EP{String(run.episodeNum).padStart(3, '0')}</strong>
                    <span className="text-secondary">{run.batchLabel || run.currentStage}</span>
                    <span className="text-secondary">{run.status}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card production-side-card">
            <div className="production-side-head">
              <h3>运行日志</h3>
              <span className="text-secondary text-xs">
                {activeTab === 'pipeline' ? `${runningLogEntries.length} 条` : '切回制作流程可查看'}
              </span>
            </div>
            {activeTab !== 'pipeline' ? (
              <div className="text-secondary">当前已切到其他功能区，运行日志预览已暂停，避免运行中持续刷新影响交互。</div>
            ) : runningLogEntries.length === 0 ? (
              <div className="text-secondary">执行日志会跟随当前制作运行出现在这里。</div>
            ) : (
              <div className="production-side-list">
                {runningLogEntries.map((log) => (
                  <div key={log.id} className="production-side-log">
                    <span className="text-secondary">
                      {new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                    </span>
                    <strong>{log.message}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {batchDrawerOpen && (
        <div className="production-batch-drawer-backdrop" onClick={handleCloseBatchDrawer}>
          <div className="production-batch-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="production-side-head">
              <div>
                <h3>批量任务</h3>
                <p className="text-secondary">制作侧批量执行、计划实例化和队列控制都收在这里。</p>
              </div>
              <button className="btn btn-sm" onClick={handleCloseBatchDrawer}>
                关闭
              </button>
            </div>
            <BatchPage embedded />
          </div>
        </div>
      )}
    </div>
  )
}
