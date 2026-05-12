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
  runScriptReview
} from '@renderer/services/workflow-actions'
import { useToastStore } from '@renderer/stores/toastStore'
import { useReviewFeedbackStore } from '@renderer/stores/reviewFeedbackStore'
import DocumentWorkflowPage from '@renderer/components/editor/DocumentWorkflowPage'
import ReviewFeedbackPanel from '@renderer/components/review/ReviewFeedbackPanel'
import {
  executeRegenerateScriptAndReviewAction,
  executeScriptReviewAction
} from '@renderer/utils/editor-workflow-actions'
import { normalizeProjectConfig } from '@shared/project-config'
import { resolveEpisodeArtifactPath } from '@shared/path-resolver'
import { useShallow } from 'zustand/react/shallow'
import './ScriptEditorPage.css'

export default function ScriptEditorPage() {
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
  const latestScriptReview = useLatestStageReview(
    currentProject?.projectPath,
    currentEp,
    'script_review'
  )

  // 确保 episodes 已加载
  useEffect(() => {
    if (currentProject && episodes.length === 0) {
      loadEpisodes(currentProject.id)
    }
  }, [currentProject])

  const {
    content,
    setContent,
    saved,
    loading,
    reload: loadScript,
    save
  } = useEpisodeTextFile({
    enabled: !!currentProject,
    episodeNum: currentEp,
    getFilePath: (ep) =>
      resolveEpisodeArtifactPath(
        currentProject!.projectPath,
        'script',
        ep,
        currentProject!.config
      ),
    emptyContent: '<!-- 剧本文件不存在，请先导入剧本到 script/ 目录 -->\n',
    onLoadMissing: (ep) =>
      addToast('warning', `EP${String(ep).padStart(2, '0')} 剧本文件不存在`),
    onSaveSuccess: async () => {
      await syncSingleEpisodeStatus(currentEp)
      addToast('success', '剧本已保存')
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

  const handleRunScriptReview = async () => {
    if (!currentProject) return
    const savedOk = await ensureSaved(saved)
    if (!savedOk) return

    await runAsyncAction(async () => {
      await executeScriptReviewAction(currentProject, currentEp, {
        runScriptReview,
        syncSingleEpisodeStatus,
        setReviewFeedback,
        addToast,
        navigate
      })
    })
  }

  const handleRegenerateScriptWithReviewFeedback = async () => {
    if (!currentProject || !latestScriptReview) return

    await runAsyncAction(async () => {
      await executeRegenerateScriptAndReviewAction(
        currentProject,
        currentEp,
        latestScriptReview,
        {
          runScriptGeneration,
          runScriptReview,
          syncSingleEpisodeStatus,
          setReviewFeedback,
          addToast,
          navigate,
          reloadDocument: loadScript
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
      navigate(`/project/${currentProject.id}/script?ep=${ep}`)
    }
  }

  return (
    <DocumentWorkflowPage
      episodes={episodes}
      currentEp={currentEp}
      onEpisodeSelect={handleEpSwitch}
      isEpisodeDone={(ep) => ep.hasScript}
      reviewPanel={
        latestScriptReview ? (
          <ReviewFeedbackPanel
            title={`EP${String(currentEp).padStart(2, '0')} 最近一次剧本审核`}
            review={latestScriptReview}
            secondaryActionLabel="查看审核页"
            onSecondaryAction={() =>
              currentProject &&
              navigate(`/project/${currentProject.id}/review?ep=${currentEp}`)
            }
            primaryActionLabel={
              latestScriptReview.passed ? '进入流程页' : '按反馈重写并复审'
            }
            onPrimaryAction={() => {
              if (latestScriptReview.passed) {
                if (currentProject) {
                  navigate(
                    `/project/${currentProject.id}/pipeline?ep=${currentEp}`
                  )
                }
                return
              }
              void handleRegenerateScriptWithReviewFeedback()
            }}
          />
        ) : null
      }
      title={`📖 EP${String(currentEp).padStart(2, '0')}`}
      lineCount={content.split('\n').length}
      description={
        config.entryStage === 'script'
          ? '当前项目从剧本起步，可直接审核后进入制作段'
          : '作为导演分析与后续制作的上游输入'
      }
      saved={saved}
      content={content}
      onContentChange={setContent}
      workflow={{
        title: '确认剧本',
        description:
          config.entryStage === 'script'
            ? '保存剧本并完成审核后，即可进入制作流程。'
            : '剧本是导演分析和后续制作的上游输入。',
        steps: [
          {
            id: 'script',
            label: '剧本内容',
            description: '当前集对白、场景和动作描述',
            state: content.trim() ? 'done' : 'active',
            stateLabel: content.trim() ? '已填写' : '待填写'
          },
          {
            id: 'review',
            label: '剧本审核',
            description: latestScriptReview?.passed
              ? '最近一次审核已通过'
              : '进入制作前建议先完成剧本审核',
            state: latestScriptReview?.passed
              ? 'done'
              : latestScriptReview
                ? 'warning'
                : 'ready',
            stateLabel: latestScriptReview?.passed
              ? '已通过'
              : latestScriptReview
                ? '需修改'
                : '待审核'
          },
          {
            id: 'pipeline',
            label: '后续制作',
            description: latestScriptReview?.passed
              ? '可以进入导演、服化道和分镜制作'
              : '审核通过后再进入后续制作',
            state: latestScriptReview?.passed ? 'ready' : 'blocked',
            stateLabel: latestScriptReview?.passed ? '可进入' : '等待审核'
          }
        ],
        primaryAction: {
          label: runningAction ? '执行中...' : '保存并审核剧本',
          onClick: handleRunScriptReview,
          disabled: runningAction || loading,
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
            label: '前往流程页',
            onClick: () =>
              currentProject &&
              navigate(`/project/${currentProject.id}/pipeline?ep=${currentEp}`)
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
              navigate(`/project/${currentProject.id}/pipeline?ep=${currentEp}`)
            }
          >
            ⚡ 前往流程页
          </button>
          <button className="btn btn-sm" onClick={() => loadScript(currentEp)}>
            ↻ 重新加载
          </button>
        </>
      }
    />
  )
}
