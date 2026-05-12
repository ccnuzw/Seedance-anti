import { lazy, Suspense } from 'react'
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
      <div className="pipeline-page" style={{ minHeight: '60vh' }}>
        <LoadingSpinner size="lg" text="正在恢复项目上下文..." />
      </div>
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
          description="展开后按同一种阶段样式查看从小说到导出的全流程、缺失项和可执行操作。"
          buttonLabel={controller.advanced.toggleLabel}
          onToggle={controller.advanced.onToggle}
        />

        {controller.advanced.visible && (
          <div className="pipeline-advanced-panel">
            <Suspense fallback={null}>
              <UnifiedWorkflowChain {...controller.workflowBoard} />
            </Suspense>

            <PipelineSectionHeader
              title="执行日志"
              description="需要排查运行细节时再展开日志。"
              buttonLabel={controller.logs.toggleLabel}
              onToggle={controller.logs.onToggle}
            />

            {controller.logs.visible && (
              <div className="pipeline-log-section">
                <LogPanel isEngineMatch={controller.logs.isEngineMatch} />
              </div>
            )}
          </div>
        )}
      </div>
    </DevProfiler>
  )
}
