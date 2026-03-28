import { useNavigate } from 'react-router-dom'
import EmptyState from '@renderer/components/layout/EmptyState'
import CompactWritingIssuePanel from '@renderer/components/review-workspace/CompactWritingIssuePanel'
import ReviewFullWorkspace from '@renderer/components/review-workspace/ReviewFullWorkspace'
import { useReviewWorkspace, type ReviewPageVariant } from '@renderer/hooks/useReviewWorkspace'
import { buildProjectRoute } from '@renderer/project-routing'
import { DEFAULT_REVIEW_POLICY } from '@shared/types'
import './ReviewPage.css'

interface ReviewPageProps {
  embedded?: boolean
  variant?: ReviewPageVariant
  focusEpisode?: number | 'all'
}

export default function ReviewPage({
  embedded = false,
  variant = 'full',
  focusEpisode
}: ReviewPageProps) {
  const navigate = useNavigate()
  const workspace = useReviewWorkspace({ variant, focusEpisode })

  const {
    currentProject,
    isCompact,
    selectedEp,
    expandedReview,
    loading,
    artifactLoading,
    rollingBackArtifactId,
    reviewFailedData,
    adaptState,
    isRunning,
    epList,
    selectedReviewEntries,
    visibleArtifactGroups,
    artifactGroupEntries,
    qualityRows,
    visibleQualityRows,
    blockerRows,
    totalReviews,
    passCount,
    failCount,
    totalIssues,
    criticalCount,
    avgScore,
    scriptReadyCount,
    episodePassCount,
    focusedRow,
    recentCompactReviews,
    adaptBlockingReview,
    adaptBlockingHint,
    title,
    subtitle,
    openEpisodeScript,
    openEpisodePipeline,
    openStageWorkspace,
    handleSelectEpisode,
    handleToggleReview,
    handleRefreshHistoricalState,
    handleRefreshArtifacts,
    handleRollbackArtifact
  } = workspace

  if (!currentProject) {
    return <EmptyState icon="🛠️" title="请先选择一个项目" description="选择项目后才能查看质检与版本信息。" />
  }

  const reviewPolicy = { ...DEFAULT_REVIEW_POLICY, ...(currentProject.config.reviewPolicy || {}) }

  if (isCompact) {
    return (
      <CompactWritingIssuePanel
        qaMode={reviewPolicy.qaMode}
        scriptAutoRepairRounds={reviewPolicy.scriptAutoRepairRounds ?? 0}
        scriptPassScore={reviewPolicy.adaptScriptPassScore ?? currentProject.config.pipelineSettings?.passScore ?? 7}
        selectedEp={selectedEp}
        loading={loading}
        artifactLoading={artifactLoading}
        isRunning={isRunning}
        reviewFailedData={reviewFailedData ? { stage: reviewFailedData.stage, retryCount: reviewFailedData.retryCount } : null}
        blockerRows={blockerRows}
        avgScore={avgScore}
        totalIssues={totalIssues}
        focusedRow={focusedRow}
        recentCompactReviews={recentCompactReviews}
        expandedReview={expandedReview}
        adaptBlockingReview={adaptBlockingReview}
        adaptBlockingHint={adaptBlockingHint}
        onRefreshHistory={() => { void handleRefreshHistoricalState(true) }}
        onRefreshArtifacts={() => { void handleRefreshArtifacts(true) }}
        onOpenFullPage={() => navigate(buildProjectRoute(currentProject.id, 'production', 'tab=review'))}
        onOpenEpisodeScript={openEpisodeScript}
        onOpenStageWorkspace={openStageWorkspace}
        onToggleReview={handleToggleReview}
      />
    )
  }

  return (
    <ReviewFullWorkspace
      embedded={embedded}
      title={title}
      subtitle={subtitle}
      selectedEp={selectedEp}
      epList={epList}
      qualityRows={qualityRows}
      visibleQualityRows={visibleQualityRows}
      selectedReviewEntries={selectedReviewEntries}
      visibleArtifactGroups={visibleArtifactGroups}
      artifactGroupEntries={artifactGroupEntries}
      reviewFailedData={reviewFailedData ? {
        stage: reviewFailedData.stage,
        retryCount: reviewFailedData.retryCount,
        batchNum: reviewFailedData.batchNum
      } : null}
      adaptState={adaptState}
      isRunning={isRunning}
      loading={loading}
      artifactLoading={artifactLoading}
      rollingBackArtifactId={rollingBackArtifactId}
      blockerRows={blockerRows}
      totalReviews={totalReviews}
      passCount={passCount}
      failCount={failCount}
      totalIssues={totalIssues}
      criticalCount={criticalCount}
      avgScore={avgScore}
      scriptReadyCount={scriptReadyCount}
      episodePassCount={episodePassCount}
      expandedReview={expandedReview}
      adaptBlockingReview={adaptBlockingReview}
      adaptBlockingHint={adaptBlockingHint}
      onRefreshHistory={() => { void handleRefreshHistoricalState(true) }}
      onRefreshArtifacts={() => { void handleRefreshArtifacts(true) }}
      onSelectEpisode={handleSelectEpisode}
      onOpenEpisodeScript={openEpisodeScript}
      onOpenEpisodePipeline={openEpisodePipeline}
      onOpenStageWorkspace={openStageWorkspace}
      onToggleReview={handleToggleReview}
      onRollbackArtifact={(artifactId) => { void handleRollbackArtifact(artifactId) }}
    />
  )
}
