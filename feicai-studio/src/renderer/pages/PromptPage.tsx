import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useArtifactDocument } from '@renderer/hooks/useArtifactDocument'
import { useAsyncAction } from '@renderer/hooks/useAsyncAction'
import { useEpisodeParam } from '@renderer/hooks/useEpisodeParam'
import { usePromptDocument } from '@renderer/hooks/usePromptDocument'
import { useLatestStageReview } from '@renderer/hooks/useLatestStageReview'
import {
  runStoryboardReview,
  startPipeline
} from '@renderer/services/workflow-actions'
import { useToastStore } from '@renderer/stores/toastStore'
import { useReviewFeedbackStore } from '@renderer/stores/reviewFeedbackStore'
import EpisodeNav from '@renderer/components/layout/EpisodeNav'
import PromptHeader from '@renderer/components/prompt/PromptHeader'
import PromptCardList from '@renderer/components/prompt/PromptCardList'
import ReviewFeedbackPanel from '@renderer/components/review/ReviewFeedbackPanel'
import { resolveEpisodeArtifactPath } from '@shared/path-resolver'
import {
  executeStoryboardReReviewAction,
  executeStoryboardReviewAction
} from '@renderer/utils/editor-workflow-actions'
import { DevProfiler } from '@renderer/dev/render-profiler'
import { useShallow } from 'zustand/react/shallow'
import './PromptPage.css'

export default function PromptPage() {
  const { currentProject, episodes, syncSingleEpisodeStatus } = useProjectStore(
    useShallow((s) => ({
      currentProject: s.currentProject,
      episodes: s.episodes,
      syncSingleEpisodeStatus: s.syncSingleEpisodeStatus
    }))
  )
  const addToast = useToastStore((s) => s.addToast)
  const setReviewFeedback = useReviewFeedbackStore((s) => s.setReview)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const urlEp = parseInt(searchParams.get('ep') || '1')
  const urlTab = searchParams.get('tab')
  const [currentEp, setCurrentEp] = useEpisodeParam(urlEp)
  const [viewTab, setViewTab] = useState<'prompts' | 'director' | 'art'>(
    urlTab === 'director' || urlTab === 'art' ? urlTab : 'prompts'
  )
  const { running: runningStoryboardReview, run: runStoryboardAction } =
    useAsyncAction()
  const latestStoryboardReview = useLatestStageReview(
    currentProject?.projectPath,
    currentEp,
    'storyboard_review'
  )

  useEffect(() => {
    if (urlTab === 'director' || urlTab === 'art' || urlTab === 'prompts') {
      setViewTab(urlTab)
      return
    }
    setViewTab('prompts')
  }, [urlTab])

  const getFilePath = (
    ep: number,
    type: 'prompts' | 'director' | 'art' = 'prompts'
  ) => {
    if (!currentProject) return ''
    if (type === 'director') {
      return resolveEpisodeArtifactPath(
        currentProject.projectPath,
        'directorAnalysis',
        ep,
        currentProject.config
      )
    }
    if (type === 'art') {
      return resolveEpisodeArtifactPath(
        currentProject.projectPath,
        'artDesign',
        ep,
        currentProject.config
      )
    }
    return resolveEpisodeArtifactPath(
      currentProject.projectPath,
      'seedancePrompts',
      ep,
      currentProject.config
    )
  }

  const {
    rawMd,
    setRawMd,
    prompts,
    loading,
    isEditing,
    selectedIndex,
    setSelectedIndex,
    startEditing,
    cancelEditing,
    saveDraft
  } = usePromptDocument({
    enabled: !!currentProject,
    episodeNum: currentEp,
    getFilePath: (ep) => getFilePath(ep, 'prompts'),
    onSaveSuccess: async () => {
      await syncSingleEpisodeStatus(currentEp)
      addToast('success', '提示词已保存')
    }
  })

  const artifactTab = viewTab === 'prompts' ? null : viewTab
  const { content: tabContent, loading: tabLoading } = useArtifactDocument({
    enabled: !!currentProject && !!artifactTab && currentEp > 0,
    filePath: artifactTab ? getFilePath(currentEp, artifactTab) : '',
    emptyContent: '',
    reloadKey: currentProject?.updatedAt || currentEp
  })

  const handleSave = useCallback(async () => {
    const ok = await saveDraft()
    if (!ok) {
      addToast('error', '保存失败')
    }
  }, [saveDraft, addToast])

  const handleReReview = useCallback(async () => {
    if (!currentProject) return
    await runStoryboardAction(async () => {
      await executeStoryboardReReviewAction(currentProject, currentEp, {
        startPipeline,
        addToast
      })
    })
  }, [currentProject, currentEp, addToast, runStoryboardAction])

  const handleRunStoryboardReview = useCallback(async () => {
    if (!currentProject) return
    await runStoryboardAction(async () => {
      await executeStoryboardReviewAction(currentProject, currentEp, {
        runStoryboardReview,
        syncSingleEpisodeStatus,
        setReviewFeedback,
        addToast
      })
    })
  }, [
    currentProject,
    currentEp,
    addToast,
    syncSingleEpisodeStatus,
    setReviewFeedback,
    runStoryboardAction
  ])

  const handleEpClick = (ep: number) => {
    setCurrentEp(ep)
    if (currentProject) {
      navigate(`/project/${currentProject.id}/prompts?ep=${ep}&tab=${viewTab}`)
    }
  }

  const actualPrompts = useMemo(
    () => prompts.filter((_, index) => index > 0),
    [prompts]
  )
  const totalDuration = actualPrompts.reduce((sum, p) => sum + p.duration, 0)
  const durationOk = totalDuration >= 90 && totalDuration <= 120

  return (
    <DevProfiler id="PromptPage">
      <div className="prompt-page">
        <EpisodeNav
          episodes={episodes}
          currentEp={currentEp}
          onSelect={handleEpClick}
        />

        {viewTab === 'prompts' && latestStoryboardReview && (
          <ReviewFeedbackPanel
            title={`EP${String(currentEp).padStart(2, '0')} 最近一次分镜审核`}
            review={latestStoryboardReview}
            secondaryActionLabel="查看审核页"
            onSecondaryAction={() =>
              currentProject &&
              navigate(`/project/${currentProject.id}/review?ep=${currentEp}`)
            }
            primaryActionLabel={
              latestStoryboardReview.passed ? '进入流程页' : '重新执行分镜审核'
            }
            onPrimaryAction={() => {
              if (latestStoryboardReview.passed) {
                if (currentProject) {
                  navigate(
                    `/project/${currentProject.id}/pipeline?ep=${currentEp}`
                  )
                }
                return
              }
              void handleRunStoryboardReview()
            }}
          />
        )}

        <div className="prompt-tabs">
          <button
            className={`tab-btn ${viewTab === 'prompts' ? 'active' : ''}`}
            onClick={() =>
              currentProject &&
              navigate(
                `/project/${currentProject.id}/prompts?ep=${currentEp}&tab=prompts`
              )
            }
          >
            📐 提示词
          </button>
          <button
            className={`tab-btn ${viewTab === 'director' ? 'active' : ''}`}
            onClick={() =>
              currentProject &&
              navigate(
                `/project/${currentProject.id}/prompts?ep=${currentEp}&tab=director`
              )
            }
          >
            🎬 导演分析
          </button>
          <button
            className={`tab-btn ${viewTab === 'art' ? 'active' : ''}`}
            onClick={() =>
              currentProject &&
              navigate(
                `/project/${currentProject.id}/prompts?ep=${currentEp}&tab=art`
              )
            }
          >
            🎨 服化道设计
          </button>
        </div>

        {viewTab === 'prompts' ? (
          <>
            <PromptHeader
              currentEp={currentEp}
              promptCount={actualPrompts.length}
              totalDuration={totalDuration}
              durationOk={durationOk}
              isEditing={isEditing}
              canEdit={prompts.length > 0}
              runningStoryboardReview={runningStoryboardReview}
              onStartEditing={startEditing}
              onRunStoryboardReview={() => void handleRunStoryboardReview()}
              onReReview={() => void handleReReview()}
              onSave={() => void handleSave()}
              onCancel={() => void cancelEditing()}
            />

            {isEditing ? (
              <div className="prompt-editor">
                <textarea
                  className="prompt-editor-textarea"
                  value={rawMd}
                  onChange={(e) => setRawMd(e.target.value)}
                  spellCheck={false}
                />
              </div>
            ) : (
              <PromptCardList
                prompts={prompts}
                loading={loading}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
              />
            )}
          </>
        ) : (
          <div className="product-viewer">
            <div className="product-viewer-header">
              <h2>
                {viewTab === 'director' ? '🎬' : '🎨'} EP
                {String(currentEp).padStart(2, '0')}{' '}
                {viewTab === 'director' ? '导演分析' : '服化道设计'}
              </h2>
            </div>
            {tabLoading ? (
              <div className="prompt-empty text-secondary">加载中...</div>
            ) : tabContent ? (
              <pre className="product-content">{tabContent}</pre>
            ) : (
              <div className="prompt-empty text-secondary">
                该集暂无{viewTab === 'director' ? '导演分析' : '服化道设计'}
                产物。请先在流水线中执行对应阶段。
              </div>
            )}
          </div>
        )}
      </div>
    </DevProfiler>
  )
}
