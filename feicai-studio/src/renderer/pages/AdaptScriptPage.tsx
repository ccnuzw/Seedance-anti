import { useNavigate } from 'react-router-dom'
import EmptyState from '@renderer/components/layout/EmptyState'
import CurrentEpisodeEditor from '@renderer/components/script-workspace/CurrentEpisodeEditor'
import ScriptBatchDrawer from '@renderer/components/script-workspace/ScriptBatchDrawer'
import ScriptGenerationControl from '@renderer/components/script-workspace/ScriptGenerationControl'
import ScriptQueueBoard from '@renderer/components/script-workspace/ScriptQueueBoard'
import ScriptWorkspaceHeader from '@renderer/components/script-workspace/ScriptWorkspaceHeader'
import ScriptWorkspaceSidebar from '@renderer/components/script-workspace/ScriptWorkspaceSidebar'
import { useScriptWorkspace } from '@renderer/hooks/useScriptWorkspace'
import { buildProjectRoute } from '@renderer/project-routing'
import { formatAdaptState } from '@renderer/components/script-workspace/scriptWorkspaceView'
import './AdaptScriptPage.css'

interface AdaptScriptPageProps {
  embedded?: boolean
}

export default function AdaptScriptPage({ embedded = false }: AdaptScriptPageProps) {
  const navigate = useNavigate()
  const workspace = useScriptWorkspace()

  const {
    currentProject,
    episodes,
    waterLevel,
    adaptState,
    isRunning,
    streamOutput,
    recentLogs,
    error,
    reviewFailedData,
    activeReviewResult,
    supportsGeneration,
    availableEpisodes,
    currentEp,
    currentScript,
    episodeQueue,
    pendingPlotEpisodeSet,
    pendingPlotForCurrent,
    selectedEpisodeRecord,
    selectedEpisodeHasScript,
    directorStageState,
    directorStatusHint,
    directorOutput,
    directorOutputLoading,
    editorContent,
    liveMeta,
    liveTitle,
    saved,
    loading,
    saving,
    previewOpen,
    reviseTarget,
    reviseNotes,
    batchDrawerOpen,
    batchDraftCount,
    maxBatchCount,
    generationStatusText,
    batchActionLabel,
    batchConstraintText,
    strategyChips,
    streamRef,
    clearStream,
    handleCreateScript,
    handleReCreate,
    handleGenerateEpisode,
    handleRevise,
    handleFix,
    handlePause,
    handleAbort,
    handleStartDirectorAnalysis,
    handleViewDirectorOutput,
    handleReload,
    handleSave,
    handleEpisodeSelect,
    handleEditorChange,
    handleTogglePreview,
    handleOpenRevise,
    handleReviseNotesChange,
    handleCancelRevise,
    handleOpenBatchDrawer,
    handleCloseBatchDrawer,
    handleBatchDraftCountChange,
    handleSubmitBatchCreate
  } = workspace

  const handleGoToSource = () => {
    if (!currentProject) return
    navigate(buildProjectRoute(currentProject.id, 'source', 'tab=plan'))
  }

  const handleLaunchPipeline = (episode: number) => {
    if (!currentProject) return
    navigate(buildProjectRoute(currentProject.id, 'production', `tab=pipeline&ep=${episode}`))
  }

  if (!currentProject) {
    return <EmptyState icon="✍️" title="请先选择一个项目" description="选择项目后才能进入分集剧本工作区。" />
  }

  if (availableEpisodes.length === 0) {
    return (
      <div className="adapt-script-page">
        <EmptyState
          icon="📚"
          title="当前项目还没有集数数据"
          description="请先在项目配置中确认集数，或等待项目状态同步完成。"
        />
      </div>
    )
  }

  return (
    <div className="adapt-script-page">
      {!embedded && (
        <ScriptWorkspaceHeader
          reviewBlocked={!!reviewFailedData}
          isRunning={isRunning}
          supportsGeneration={supportsGeneration}
          onFix={() => { void handleFix() }}
          onPause={() => { void handlePause() }}
          onAbort={() => { void handleAbort() }}
        />
      )}

      <div className="as-control-shell">
        <ScriptGenerationControl
          stageLabel={formatAdaptState(adaptState)}
          generationStatusText={generationStatusText}
          assignedEpisodes={waterLevel?.assignedEpisodes || 0}
          scriptEpisodes={waterLevel?.scriptEpisodes ?? episodeQueue.filter((episode) => episode.hasScript).length}
          pendingScriptEpisodes={waterLevel?.pendingScriptEpisodes || 0}
          unusedPlots={waterLevel?.unusedPlots || 0}
          supportsGeneration={supportsGeneration}
          isRunning={isRunning}
          isReviewBlocked={!!reviewFailedData}
          batchActionLabel={batchActionLabel}
          batchConstraintText={batchConstraintText}
          strategyChips={strategyChips}
          onCreateNext={() => { void handleCreateScript(1) }}
          onOpenBatchDrawer={handleOpenBatchDrawer}
          onGoToSource={handleGoToSource}
          variant={embedded ? 'compact' : 'default'}
        />
      </div>

      {embedded ? (
        <div className="as-embedded-flow">
          <ScriptQueueBoard
            episodes={episodeQueue}
            currentEp={currentEp}
            supportsGeneration={supportsGeneration}
            isRunning={isRunning}
            availableEpisodeCount={availableEpisodes.length}
            scriptEpisodeCount={waterLevel?.scriptEpisodes ?? episodeQueue.filter((episode) => episode.hasScript).length}
            currentTitle={liveTitle}
            liveMeta={liveMeta}
            hasCurrentScript={!!currentScript}
            pendingPlotForCurrent={pendingPlotForCurrent}
            saved={saved}
            loading={loading}
            selectedEpisodeHasScript={selectedEpisodeRecord?.hasScript ?? false}
            pendingPlotEpisodeSet={pendingPlotEpisodeSet}
            onEpisodeSelect={handleEpisodeSelect}
            onGenerateEpisode={(episode) => { void handleGenerateEpisode(episode) }}
            layout="embedded"
          />

          <CurrentEpisodeEditor
            currentEp={currentEp}
            liveTitle={liveTitle}
            liveMeta={liveMeta}
            currentScript={currentScript ? { filename: currentScript.filename } : null}
            pendingPlotForCurrent={pendingPlotForCurrent}
            selectedEpisodeHasScript={selectedEpisodeHasScript}
            directorStageLabel={directorStageState.label}
            directorStageTone={directorStageState.tone}
            directorStatusHint={directorStatusHint}
            hasDirectorOutput={!!directorOutput.trim()}
            directorOutputLoading={directorOutputLoading}
            saved={saved}
            loading={loading}
            saving={saving}
            isRunning={isRunning}
            supportsGeneration={supportsGeneration}
            previewOpen={previewOpen}
            editorContent={editorContent}
            reviseTarget={reviseTarget}
            reviseNotes={reviseNotes}
            onEditorChange={handleEditorChange}
            onReload={handleReload}
            onTogglePreview={handleTogglePreview}
            onSave={() => { void handleSave() }}
            onGenerateCurrent={() => { void handleGenerateEpisode(currentEp) }}
            onRecreateCurrent={() => { void handleReCreate(currentEp) }}
            onOpenRevise={handleOpenRevise}
            onLaunchPipeline={() => handleLaunchPipeline(currentEp)}
            onStartDirectorAnalysis={() => { void handleStartDirectorAnalysis() }}
            onViewDirectorOutput={() => { void handleViewDirectorOutput() }}
            onReviseNotesChange={handleReviseNotesChange}
            onSubmitRevise={() => { void handleRevise() }}
            onCancelRevise={handleCancelRevise}
          />

          <div className="card as-director-output-card">
            <div className="as-section-head">
              <div>
                <h3>导演分析结果</h3>
                <p className="text-secondary text-xs">
                  对应输出文件：outputs/ep{String(currentEp).padStart(3, '0')}/01-director-analysis.md
                </p>
              </div>
              <span className={`status-chip tone-${directorStageState.tone}`}>{directorStageState.label}</span>
            </div>
            {directorOutputLoading ? (
              <div className="text-secondary">正在读取导演分析结果…</div>
            ) : directorOutput.trim() ? (
              <pre className="as-director-output-pre">{directorOutput}</pre>
            ) : (
              <div className={`as-director-output-empty tone-${directorStageState.tone}`}>
                {directorStageState.key === 'failed'
                  ? `导演阶段未产出可查看结果。${directorStatusHint}`
                  : directorStageState.key === 'analyzing' || directorStageState.key === 'reviewing'
                    ? '导演阶段正在运行中，结果文件生成后会显示在这里。'
                    : '当前还没有导演分析结果。你可以先在上方点击“启动导演分析（~start）”。'}
              </div>
            )}
          </div>

          <ScriptWorkspaceSidebar
            isRunning={isRunning}
            previewOpen={previewOpen}
            editorContent={editorContent}
            reviewResult={activeReviewResult}
            streamOutput={streamOutput}
            recentLogs={recentLogs}
            error={error}
            streamRef={streamRef}
            onClearStream={clearStream}
          />
        </div>
      ) : (
        <div className="as-workbench-grid">
          <aside className="as-rail-column">
            <ScriptQueueBoard
              episodes={episodeQueue}
              currentEp={currentEp}
              supportsGeneration={supportsGeneration}
              isRunning={isRunning}
              availableEpisodeCount={availableEpisodes.length}
              scriptEpisodeCount={waterLevel?.scriptEpisodes ?? episodeQueue.filter((episode) => episode.hasScript).length}
              currentTitle={liveTitle}
              liveMeta={liveMeta}
              hasCurrentScript={!!currentScript}
              pendingPlotForCurrent={pendingPlotForCurrent}
              saved={saved}
              loading={loading}
              selectedEpisodeHasScript={selectedEpisodeRecord?.hasScript ?? false}
              pendingPlotEpisodeSet={pendingPlotEpisodeSet}
              onEpisodeSelect={handleEpisodeSelect}
              onGenerateEpisode={(episode) => { void handleGenerateEpisode(episode) }}
              layout="rail"
            />
          </aside>

          <section className="as-editor-column">
            <CurrentEpisodeEditor
              currentEp={currentEp}
              liveTitle={liveTitle}
              liveMeta={liveMeta}
              currentScript={currentScript ? { filename: currentScript.filename } : null}
              pendingPlotForCurrent={pendingPlotForCurrent}
              selectedEpisodeHasScript={selectedEpisodeHasScript}
              directorStageLabel={directorStageState.label}
              directorStageTone={directorStageState.tone}
              directorStatusHint={directorStatusHint}
              hasDirectorOutput={!!directorOutput.trim()}
              directorOutputLoading={directorOutputLoading}
              saved={saved}
              loading={loading}
              saving={saving}
              isRunning={isRunning}
              supportsGeneration={supportsGeneration}
              previewOpen={previewOpen}
              editorContent={editorContent}
              reviseTarget={reviseTarget}
              reviseNotes={reviseNotes}
              onEditorChange={handleEditorChange}
              onReload={handleReload}
              onTogglePreview={handleTogglePreview}
              onSave={() => { void handleSave() }}
              onGenerateCurrent={() => { void handleGenerateEpisode(currentEp) }}
              onRecreateCurrent={() => { void handleReCreate(currentEp) }}
              onOpenRevise={handleOpenRevise}
              onLaunchPipeline={() => handleLaunchPipeline(currentEp)}
              onStartDirectorAnalysis={() => { void handleStartDirectorAnalysis() }}
              onViewDirectorOutput={() => { void handleViewDirectorOutput() }}
              onReviseNotesChange={handleReviseNotesChange}
              onSubmitRevise={() => { void handleRevise() }}
              onCancelRevise={handleCancelRevise}
            />
            <div className="card as-director-output-card">
              <div className="as-section-head">
                <div>
                  <h3>导演分析结果</h3>
                  <p className="text-secondary text-xs">
                    对应输出文件：outputs/ep{String(currentEp).padStart(3, '0')}/01-director-analysis.md
                  </p>
                </div>
                <span className={`status-chip tone-${directorStageState.tone}`}>{directorStageState.label}</span>
              </div>
              {directorOutputLoading ? (
                <div className="text-secondary">正在读取导演分析结果…</div>
              ) : directorOutput.trim() ? (
                <pre className="as-director-output-pre">{directorOutput}</pre>
              ) : (
                <div className={`as-director-output-empty tone-${directorStageState.tone}`}>
                  {directorStageState.key === 'failed'
                    ? `导演阶段未产出可查看结果。${directorStatusHint}`
                    : directorStageState.key === 'analyzing' || directorStageState.key === 'reviewing'
                      ? '导演阶段正在运行中，结果文件生成后会显示在这里。'
                      : '当前还没有导演分析结果。你可以先在上方点击“启动导演分析（~start）”。'}
                </div>
              )}
            </div>
            <ScriptWorkspaceSidebar
              isRunning={isRunning}
              previewOpen={previewOpen}
              editorContent={editorContent}
              reviewResult={activeReviewResult}
              streamOutput={streamOutput}
              recentLogs={recentLogs}
              error={error}
              streamRef={streamRef}
              onClearStream={clearStream}
            />
          </section>
        </div>
      )}

      <ScriptBatchDrawer
        open={batchDrawerOpen}
        count={batchDraftCount}
        maxCount={maxBatchCount}
        pendingScriptEpisodes={waterLevel?.pendingScriptEpisodes || 0}
        unusedPlots={waterLevel?.unusedPlots || 0}
        isRunning={isRunning}
        isReviewBlocked={!!reviewFailedData}
        onCountChange={handleBatchDraftCountChange}
        onClose={handleCloseBatchDrawer}
        onSubmit={() => { void handleSubmitBatchCreate() }}
      />
    </div>
  )
}
