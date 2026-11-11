import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import PipelineCommandCenter from '@renderer/components/pipeline/PipelineCommandCenter'
import PipelineCompleteBanner from '@renderer/components/pipeline/PipelineCompleteBanner'
import PipelineSectionHeader from '@renderer/components/pipeline/PipelineSectionHeader'
import LogPanel from '@renderer/components/layout/LogPanel'
import EpisodeNav from '@renderer/components/layout/EpisodeNav'
import LoadingSpinner from '@renderer/components/layout/LoadingSpinner'
import { usePipelinePageController } from '@renderer/hooks/usePipelinePageController'
import { DevProfiler } from '@renderer/dev/render-profiler'
import './PipelinePage.css'

const UnifiedWorkflowChain = lazy(
  () => import('@renderer/components/pipeline/UnifiedWorkflowChain')
)

export default function PipelinePage() {
  const controller = usePipelinePageController()

  if (!controller.currentProject) {
    return (
      <section
        className="pipeline-page pipeline-empty-state"
        aria-labelledby="pipeline-empty-title"
      >
        <h2 id="pipeline-empty-title">尚未取得项目数据</h2>
        <p className="text-secondary" role="status">
          制作总控需要已打开的项目。如果项目未能载入，请返回项目列表重新选择，检查项目是否仍然可用。
        </p>
        <Link className="btn btn-primary" to="/">
          返回项目列表
        </Link>
      </section>
    )
  }

  return (
    <DevProfiler id="PipelinePage">
      <div className="pipeline-page">
        {controller.episodeNav.episodes.length > 0 && (
          <EpisodeNav {...controller.episodeNav} />
        )}

        {controller.completionBanner.visible && (
          <PipelineCompleteBanner
            episodeNum={controller.completionBanner.episodeNum}
            totalElapsed={controller.completionBanner.totalElapsed}
            isEngineMatch={controller.completionBanner.isEngineMatch}
            hasNextEpisode={controller.completionBanner.hasNextEpisode}
            onNextEpisode={controller.completionBanner.onNextEpisode}
          />
        )}

        <PipelineCommandCenter {...controller.commandCenter} />

        <PipelineSectionHeader
          title="完整制作链"
          description="按当前入口查看适用阶段、有效审核、缺失项和可执行操作。"
          expanded={controller.advanced.visible}
          controls="pipeline-advanced-panel"
          buttonLabel={controller.advanced.toggleLabel}
          onToggle={controller.advanced.onToggle}
        />

        {controller.advanced.visible && (
          <div className="pipeline-advanced-panel" id="pipeline-advanced-panel">
            <Suspense
              fallback={<LoadingSpinner text="正在加载完整制作链..." />}
            >
              <UnifiedWorkflowChain {...controller.workflowBoard} />
            </Suspense>

            <PipelineSectionHeader
              title="执行日志"
              description="需要排查运行细节时再展开日志。"
              expanded={controller.logs.visible}
              controls="pipeline-log-section"
              buttonLabel={controller.logs.toggleLabel}
              onToggle={controller.logs.onToggle}
            />

            {controller.logs.visible && (
              <div className="pipeline-log-section" id="pipeline-log-section">
                <LogPanel isEngineMatch={controller.logs.isEngineMatch} />
              </div>
            )}
          </div>
        )}
      </div>
    </DevProfiler>
  )
}
