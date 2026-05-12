import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useAsyncAction } from '@renderer/hooks/useAsyncAction'
import { useDocumentEditorActions } from '@renderer/hooks/useDocumentEditorActions'
import { useEpisodeParam } from '@renderer/hooks/useEpisodeParam'
import { useEpisodeTextFile } from '@renderer/hooks/useEpisodeTextFile'
import { useLatestStageReview } from '@renderer/hooks/useLatestStageReview'
import {
  runScriptGeneration,
  runStoryGeneration,
  runStoryReview
} from '@renderer/services/workflow-actions'
import { useToastStore } from '@renderer/stores/toastStore'
import { useReviewFeedbackStore } from '@renderer/stores/reviewFeedbackStore'
import DocumentWorkflowPage from '@renderer/components/editor/DocumentWorkflowPage'
import ReviewFeedbackPanel from '@renderer/components/review/ReviewFeedbackPanel'
import {
  executeScriptGenerationAction,
  executeRegenerateStoryAndReviewAction,
  executeStoryReviewAction
} from '@renderer/utils/editor-workflow-actions'
import { normalizeProjectConfig } from '@shared/project-config'
import { resolveEpisodeArtifactPath } from '@shared/path-resolver'
import { useShallow } from 'zustand/react/shallow'
import './ScriptEditorPage.css'

function createDefaultBeatTemplate(ep: number): string {
  const epStr = String(ep).padStart(2, '0')
  return `# EP${epStr} 剧情拆解

## 本集定位

- 主线目标：
- 主视角角色：
- 情绪基调：

## 开场钩子

用 2-4 句话写本集开场如何抓人。

## Beats

### Beat 1

- 场景：
- 参与角色：
- 事件推进：
- 情绪变化：
- 对后续的作用：

## 结尾钩子

说明本集结尾如何把用户带进下一集。
`
}

export default function StoryBeatEditorPage() {
  const { currentProject, episodes, loadEpisodes, syncSingleEpisodeStatus } =
    useProjectStore(
      useShallow((s) => ({
        currentProject: s.currentProject,
        episodes: s.episodes,
        loadEpisodes: s.loadEpisodes,
        syncSingleEpisodeStatus: s.syncSingleEpisodeStatus
      }))
    )
  const { addToast } = useToastStore()
  const setReviewFeedback = useReviewFeedbackStore((s) => s.setReview)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const urlEp = parseInt(searchParams.get('ep') || '1')
  const [currentEp, setCurrentEp] = useEpisodeParam(urlEp)
  const { running: runningAction, run: runAsyncAction } = useAsyncAction()

  const config = normalizeProjectConfig(currentProject?.config)
  const isNovelEntry = config.entryStage === 'novel'
  const latestStoryReview = useLatestStageReview(
    currentProject?.projectPath,
    currentEp,
    'story_review'
  )

  useEffect(() => {
    if (currentProject && episodes.length === 0) {
      loadEpisodes(currentProject.id)
    }
  }, [currentProject?.id, episodes.length])

  const {
    content,
    setContent,
    saved,
    loading,
    reload: loadStoryBeat,
    save
  } = useEpisodeTextFile({
    enabled: !!currentProject,
    episodeNum: currentEp,
    getFilePath: (ep) =>
      resolveEpisodeArtifactPath(
        currentProject!.projectPath,
        'storyBeat',
        ep,
        currentProject!.config
      ),
    emptyContent: createDefaultBeatTemplate,
    onLoadMissing: (ep) =>
      addToast(
        'info',
        `EP${String(ep).padStart(2, '0')} 尚未创建剧情拆解，已载入模板`
      ),
    onSaveSuccess: async () => {
      await syncSingleEpisodeStatus(currentEp)
      addToast('success', '剧情拆解已保存')
    }
  })

  const {
    importMarkdown: handleImportMarkdown,
    saveDocument: handleSave,
    ensureSaved
  } = useDocumentEditorActions({
    setContent,
    save,
    addToast
  })

  const handleRunScriptGeneration = async () => {
    if (!currentProject) return
    const savedOk = await ensureSaved(saved)
    if (!savedOk) return

    await runAsyncAction(async () => {
      await executeScriptGenerationAction(currentProject, currentEp, {
        runScriptGeneration,
        syncSingleEpisodeStatus,
        addToast,
        navigate
      })
    })
  }

  const handleRunStoryReview = async () => {
    if (!currentProject) return
    const savedOk = await ensureSaved(saved)
    if (!savedOk) return

    await runAsyncAction(async () => {
      await executeStoryReviewAction(currentProject, currentEp, {
        runStoryReview,
        syncSingleEpisodeStatus,
        setReviewFeedback,
        addToast
      })
    })
  }

  const handleRegenerateStoryWithReviewFeedback = async () => {
    if (!currentProject || !latestStoryReview) return

    await runAsyncAction(async () => {
      await executeRegenerateStoryAndReviewAction(
        currentProject,
        currentEp,
        latestStoryReview,
        {
          runStoryGeneration,
          runStoryReview,
          syncSingleEpisodeStatus,
          setReviewFeedback,
          addToast,
          navigate,
          reloadDocument: loadStoryBeat
        }
      )
    })
  }

  const handleEpSwitch = (ep: number) => {
    if (!saved) {
      if (
        !confirm(
          `EP${String(currentEp).padStart(2, '0')} 有未保存的修改，确定切换？`
        )
      )
        return
    }
    setCurrentEp(ep)
    if (currentProject) {
      navigate(`/project/${currentProject.id}/story?ep=${ep}`)
    }
  }

  return (
    <DocumentWorkflowPage
      episodes={episodes}
      currentEp={currentEp}
      onEpisodeSelect={handleEpSwitch}
      isEpisodeDone={(ep) => ep.hasStoryBeat}
      reviewPanel={
        latestStoryReview ? (
          <ReviewFeedbackPanel
            title={`EP${String(currentEp).padStart(2, '0')} 最近一次剧情审核反馈`}
            review={latestStoryReview}
            secondaryActionLabel="查看审核页"
            onSecondaryAction={() =>
              currentProject &&
              navigate(
                `/project/${currentProject.id}/review?ep=${currentEp}&stage=story_review`
              )
            }
            primaryActionLabel={
              latestStoryReview.passed ? '执行剧本生成' : '按反馈重写并复审'
            }
            onPrimaryAction={() => {
              if (latestStoryReview.passed) {
                void handleRunScriptGeneration()
                return
              }
              void handleRegenerateStoryWithReviewFeedback()
            }}
          />
        ) : null
      }
      title={
        isNovelEntry
          ? `🧩 第${currentEp}批剧情草稿`
          : `🧩 EP${String(currentEp).padStart(2, '0')}`
      }
      lineCount={content.split('\n').length}
      description={
        config.entryStage === 'script'
          ? '当前项目从剧本起步，此页通常可跳过'
          : isNovelEntry
            ? '审核通过后写入 story/plot-breakdown.md，供剧本生成消耗'
            : '作为剧本生成的上游输入'
      }
      saved={saved}
      content={content}
      onContentChange={setContent}
      workflow={{
        title: isNovelEntry ? '确认剧情库存批次' : '确认剧情拆解',
        description:
          config.entryStage === 'script'
            ? '当前项目从剧本起步，剧情拆解通常只作为参考。'
            : isNovelEntry
              ? '先让批次审核通过，再把新增剧情点写入剧情库存。'
              : '先让剧情审核通过，再进入剧本生成。',
        steps: [
          {
            id: 'story',
            label: isNovelEntry ? '批次草稿' : '剧情拆解',
            description: isNovelEntry
              ? '当前 6 章提取的新增剧情点，审核通过前不会入库'
              : '当前集剧情节奏、关键事件和结尾钩子',
            state: content.trim() ? 'done' : 'active',
            stateLabel: content.trim() ? '已填写' : '待填写'
          },
          {
            id: 'review',
            label: isNovelEntry ? '批次审核' : '剧情审核',
            description: latestStoryReview?.passed
              ? '最近一次审核已通过'
              : isNovelEntry
                ? '通过后自动写入剧情库存'
                : '生成剧本前建议先审核剧情',
            state: latestStoryReview?.passed
              ? 'done'
              : latestStoryReview
                ? 'warning'
                : 'ready',
            stateLabel: latestStoryReview?.passed
              ? '已通过'
              : latestStoryReview
                ? '需修改'
                : '待审核'
          },
          {
            id: 'script',
            label: '剧本生成',
            description: latestStoryReview?.passed
              ? isNovelEntry
                ? '剧情点已入库后，可以继续生成对应剧本'
                : '可以基于审核通过的剧情生成剧本'
              : '审核通过后再生成更稳妥',
            state: latestStoryReview?.passed ? 'ready' : 'blocked',
            stateLabel: latestStoryReview?.passed ? '可生成' : '等待审核'
          }
        ],
        primaryAction: {
          label: runningAction
            ? '执行中...'
            : latestStoryReview?.passed
              ? '保存并生成剧本'
              : isNovelEntry
                ? '保存并审核批次'
                : '保存并审核剧情',
          onClick: latestStoryReview?.passed
            ? handleRunScriptGeneration
            : handleRunStoryReview,
          disabled: runningAction || loading || config.entryStage === 'script',
          variant: 'primary'
        },
        secondaryActions: [
          {
            label: '保存',
            onClick: handleSave,
            disabled: saved
          },
          {
            label: '导入 Markdown',
            onClick: handleImportMarkdown
          },
          {
            label: '前往剧本',
            onClick: () =>
              currentProject &&
              navigate(`/project/${currentProject.id}/script?ep=${currentEp}`)
          }
        ]
      }}
      toolbarActions={
        <>
          <button className="btn btn-sm" onClick={handleImportMarkdown}>
            📥 导入 Markdown
          </button>
          <button
            className="btn btn-sm"
            onClick={() =>
              currentProject &&
              navigate(`/project/${currentProject.id}/script?ep=${currentEp}`)
            }
          >
            📖 前往剧本
          </button>
          <button
            className="btn btn-sm"
            onClick={() => loadStoryBeat(currentEp)}
          >
            ↻ 重新加载
          </button>
        </>
      }
    />
  )
}
