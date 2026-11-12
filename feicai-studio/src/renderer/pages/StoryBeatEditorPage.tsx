import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useProjectStore } from '@renderer/stores/projectStore'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { useAsyncAction } from '@renderer/hooks/useAsyncAction'
import { useDocumentEditorActions } from '@renderer/hooks/useDocumentEditorActions'
import { useEpisodeParam } from '@renderer/hooks/useEpisodeParam'
import { useEpisodeTextFile } from '@renderer/hooks/useEpisodeTextFile'
import { useLatestStageReview } from '@renderer/hooks/useLatestStageReview'
import {
  runStoryGeneration,
  runStoryReview
} from '@renderer/services/workflow-actions'
import { useToastStore } from '@renderer/stores/toastStore'
import { useReviewFeedbackStore } from '@renderer/stores/reviewFeedbackStore'
import DocumentWorkflowPage from '@renderer/components/editor/DocumentWorkflowPage'
import ReviewFeedbackPanel from '@renderer/components/review/ReviewFeedbackPanel'
import { executeStoryReviewAction } from '@renderer/utils/editor-workflow-actions'
import {
  novelDraftState,
  novelReadyEpisode,
  novelInventoryUnknown,
  novelNextAction
} from '@renderer/utils/novel-draft-state'
import { normalizeProjectConfig } from '@shared/project-config'
import { resolveEpisodeArtifactPath } from '@shared/path-resolver'
import type { Episode } from '@shared/types'
import type { PlotBreakdownSummary } from '@shared/ipc-contracts'
import { useShallow } from 'zustand/react/shallow'
import './ScriptEditorPage.css'

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
  const [currentEp] = useEpisodeParam(parseInt(searchParams.get('ep') || '1'))
  const config = normalizeProjectConfig(currentProject?.config)
  const novel = config.entryStage === 'novel'
  const { running, run } = useAsyncAction()
  const pipelineBusy = usePipelineStore((s) => s.isRunning)
  const key = `${currentProject?.id}:${currentEp}`
  const active = useRef(key)
  active.current = key
  useEffect(
    () => () => {
      active.current = ''
    },
    []
  )
  const [context, setContext] = useState<{
    key: string
    summary: PlotBreakdownSummary | null
    model: boolean
    episodes: Episode[] | null
    passed: boolean
    error?: string
  } | null>(null)
  const [failure, setFailure] = useState<{
    key: string
    message: string
  } | null>(null)
  const [revision, setRevision] = useState(0)
  const actionLock = useRef(false)
  const latestReview = useLatestStageReview(
    currentProject?.projectPath,
    currentEp,
    'story_review'
  )
  useEffect(() => {
    if (currentProject && episodes.length === 0)
      void loadEpisodes(currentProject.id)
  }, [currentProject?.id, episodes.length, loadEpisodes])
  useEffect(() => {
    if (!currentProject) return
    let cancelled = false
    Promise.all([
      novel
        ? window.feicaiAPI.getPlotBreakdownSummary(currentProject.id)
        : Promise.resolve(null),
      window.feicaiAPI.listLLMConfigs(),
      window.feicaiAPI.getProjectPipelineState(currentProject.projectPath),
      window.feicaiAPI.listProjectEpisodes(currentProject.id)
    ])
      .then(([summary, models, pipeline, loadedEpisodes]) => {
        if (!cancelled)
          setContext({
            key,
            summary,
            episodes: loadedEpisodes.filter(
              (ep) => ep.projectId === currentProject.id
            ),
            model: models.some((m) => !m.category || m.category === 'llm'),
            passed:
              pipeline?.episodes[currentEp]?.stageStates?.story_review
                ?.status === 'passed'
          })
      })
      .catch((error) => {
        if (!cancelled)
          setContext({
            key,
            summary: null,
            episodes: null,
            model: false,
            passed: false,
            error: `读取工作流失败：${String(error)}`
          })
      })
    return () => {
      cancelled = true
    }
  }, [key, revision, novel, currentProject])
  const doc = useEpisodeTextFile({
    enabled: !!currentProject,
    episodeNum: currentEp,
    getFilePath: (ep) =>
      resolveEpisodeArtifactPath(
        currentProject!.projectPath,
        'storyBeat',
        ep,
        currentProject!.config
      ),
    emptyContent: '',
    onSaveSuccess: async () => {
      await syncSingleEpisodeStatus(currentEp)
      addToast('success', '剧情草稿已保存')
    }
  })
  const {
    content,
    setContent,
    saved,
    loading,
    reload,
    save,
    documentSession,
    overwriteConflict
  } = doc
  const [edited, setEdited] = useState<string | null>(null)
  const { importMarkdown, saveDocument, ensureSaved } =
    useDocumentEditorActions({
      setContent: (value) => {
        setEdited(key)
        setContent(value)
      },
      save,
      addToast,
      documentKey: key
    })
  const ctx = context?.key === key ? context : null
  const state = novelDraftState(content, ctx?.summary ?? null)
  const passed = !!ctx?.passed && edited !== key && saved && !doc.conflict
  const busy = running || pipelineBusy || loading || !ctx || doc.saving
  const error = failure?.key === key ? failure.message : doc.error || ctx?.error
  const scriptEp = novelReadyEpisode(
    ctx?.summary ?? null,
    ctx?.episodes ?? null,
    currentProject?.id ?? ''
  )
  const nextAction = novelNextAction(
    state.batch,
    passed,
    ctx?.summary ?? null,
    scriptEp,
    novelInventoryUnknown(
      ctx?.summary ?? null,
      ctx?.episodes ?? null,
      currentProject?.id ?? ''
    )
  )
  const canScript = novel ? !!scriptEp : passed
  const scriptStep = canScript
    ? { description: '已有可制作剧情', stateLabel: '可前往' }
    : novel && nextAction === 'refresh'
      ? {
          description: '库存目标集状态尚未确认，请刷新核对集数',
          stateLabel: '集数待核对'
        }
      : novel && nextAction === 'next'
        ? {
            description: '当前可用剧情已用尽，请生成下一批草稿并审核',
            stateLabel: '等待下一批'
          }
        : novel && nextAction === 'complete'
          ? {
              description: '当前章节拆解已完成或库存已使用，请核对既有剧本',
              stateLabel: '核对既有剧本'
            }
          : { description: '先完成草稿审核', stateLabel: '等待审核' }
  const review = !passed && latestReview?.passed ? null : latestReview

  const act = async (mode: 'generate' | 'review' | 'revise') => {
    if (!currentProject || busy || actionLock.current) return
    const origin = key
    const valid = () =>
      active.current === origin &&
      useProjectStore.getState().currentProject?.id === currentProject.id
    if (!ctx?.model) {
      navigate('/settings')
      return
    }
    if (
      mode !== 'review' &&
      content.trim() &&
      !window.confirm(
        '生成将替换磁盘上的剧情草稿。请先保存或导出手写修改。确定继续生成？'
      )
    )
      return
    if (mode !== 'review' && (!saved || doc.conflict || doc.recovery)) {
      setFailure({ key, message: '请先保存或导出手写修改，再生成草稿。' })
      return
    }
    actionLock.current = true
    setFailure(null)
    try {
      await run(async () => {
        try {
          if (mode !== 'review') {
            const result = await runStoryGeneration({
              projectPath: currentProject.projectPath,
              episodeNum: currentEp,
              batchNumber:
                mode === 'revise'
                  ? (state.batch ?? undefined)
                  : ctx?.summary?.nextBatchNumber,
              projectName: currentProject.name,
              visualStyle: currentProject.visualStyle,
              targetMedium: currentProject.targetMedium,
              reviewFeedback: mode === 'revise' ? review?.feedback : undefined
            })
            if (!valid()) return
            if (!result.success)
              throw new Error(result.error || '剧情草稿生成失败，请重试')
            await reload(currentEp)
            if (!valid()) return
            const fresh = documentSession.getSnapshot()
            if (fresh.conflict || !fresh.saved)
              throw new Error(
                '生成期间检测到手写修改，已保留修改；请先处理磁盘冲突。'
              )
            if (
              fresh.error ||
              !fresh.loaded ||
              !novelDraftState(fresh.content, null).batch
            )
              throw new Error(fresh.error || '生成产物缺少有效批次身份，请重试')
            await syncSingleEpisodeStatus(currentEp)
            if (!valid()) return
            setRevision((v) => v + 1)
            if (mode === 'generate') return
          }
          if (
            novel &&
            !novelDraftState(documentSession.getSnapshot().content, null).batch
          )
            return
          if (!(await ensureSaved(saved)) || !valid()) return
          const result = await executeStoryReviewAction(
            currentProject,
            currentEp,
            {
              runStoryReview,
              syncSingleEpisodeStatus: async (ep) => {
                if (valid()) await syncSingleEpisodeStatus(ep)
              },
              setReviewFeedback: (...args) => {
                if (valid()) setReviewFeedback(...args)
              },
              addToast: (...args) => {
                if (valid()) addToast(...args)
              }
            }
          )
          if (!valid()) return
          if (!result.success)
            setFailure({
              key: origin,
              message: result.error || '审核未通过，请查看反馈并修订草稿。'
            })
          setEdited(null)
          setRevision((v) => v + 1)
        } catch (e) {
          if (valid()) setFailure({ key: origin, message: String(e) })
        }
      })
    } finally {
      actionLock.current = false
    }
  }
  const primaryLabel =
    doc.error || ctx?.error
      ? '重新读取草稿与状态'
      : !ctx
        ? '读取状态中…'
        : novel && nextAction === 'refresh'
          ? '刷新核对集数'
          : novel && nextAction === 'complete'
            ? '核对既有剧本'
            : (!novel && passed) || (novel && nextAction === 'script')
              ? '前往可制作剧本'
              : !ctx.model
                ? '配置文本模型'
                : novel && nextAction === 'next'
                  ? '生成下一批剧情草稿'
                  : novel && nextAction === 'generate'
                    ? '生成剧情草稿'
                    : '保存并审核草稿'
  const primary = () => {
    if (doc.error || ctx?.error) {
      void reload()
      setRevision((v) => v + 1)
      return
    }
    if (novel && nextAction === 'refresh') {
      setRevision((v) => v + 1)
      return
    }
    if (novel && nextAction === 'complete') {
      navigate(`/project/${currentProject?.id}`)
      return
    }
    if ((novel && nextAction === 'script') || (!novel && passed)) {
      navigate(
        `/project/${currentProject?.id}/script?ep=${scriptEp ?? currentEp}`
      )
      return
    }
    if (!ctx?.model) {
      navigate('/settings')
      return
    }
    void act(
      novel && (nextAction === 'generate' || nextAction === 'next')
        ? 'generate'
        : 'review'
    )
  }
  return (
    <DocumentWorkflowPage
      episodes={episodes}
      currentEp={currentEp}
      onEpisodeSelect={(ep) =>
        navigate(`/project/${currentProject?.id}/story?ep=${ep}`)
      }
      isEpisodeDone={(ep) => ep.hasStoryBeat}
      title={
        novel
          ? `🧩 剧情草稿${state.batch ? ` · 第${state.batch}批` : ctx?.summary ? ` · 待生成第${ctx.summary.nextBatchNumber}批` : ''}`
          : `🧩 EP${String(currentEp).padStart(2, '0')}`
      }
      description={
        config.entryStage === 'script'
          ? '当前项目从剧本起步，此页可作为参考。'
          : novel
            ? '先生成草稿，检查后点击审核；通过后前往可制作剧本。'
            : '编辑剧情，审核通过后进入剧本。'
      }
      content={content}
      onContentChange={(value) => {
        setEdited(key)
        setContent(value)
      }}
      lineCount={content.split('\n').length}
      saved={saved}
      documentSession={documentSession}
      onOverwriteConflict={overwriteConflict}
      onReload={reload}
      onSave={saveDocument}
      reviewPanel={
        <>
          {novel && nextAction === 'refresh' && (
            <p>
              库存目标集的状态尚未确认，请刷新核对集数。确认前不会重复制作或生成下一批。
            </p>
          )}
          {novel && nextAction === 'complete' && (
            <p>
              当前章节拆解已完成，或库存已用于剧本。请核对既有剧本；已用剧情缺少剧本时请检查文件，不重复生成。
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {novel && content.trim() && !state.batch && (
            <p>
              当前内容缺少有效批次身份，不能作为小说批次审核。请先保存或导出手写内容，再生成剧情草稿。
            </p>
          )}
          {review && (
            <ReviewFeedbackPanel
              title="最近一次剧情审核反馈"
              review={review}
              secondaryActionLabel="查看审核页"
              onSecondaryAction={() =>
                navigate(
                  `/project/${currentProject?.id}/review?ep=${currentEp}&stage=story_review`
                )
              }
            />
          )}
          {review && !review.passed && novel && state.batch && (
            <button
              className="btn"
              disabled={busy || !saved}
              onClick={() => void act('revise')}
            >
              按反馈重写并复审
            </button>
          )}
        </>
      }
      workflow={{
        title: '剧情草稿与审核',
        description: novel
          ? '生成和审核分两次点击执行。小说批次由草稿标记与库存决定。'
          : '保存修改并审核剧情。',
        steps: [
          {
            id: 'draft',
            label: '剧情草稿',
            description: novel
              ? '生成后检查内容，可继续手动编辑'
              : '填写或导入剧情',
            state: (novel ? !!state.batch : !!content.trim())
              ? 'done'
              : 'active',
            stateLabel: loading
              ? '读取中'
              : (novel ? !!state.batch : !!content.trim())
                ? '已生成 / 可编辑'
                : '待生成'
          },
          {
            id: 'review',
            label: '审核草稿',
            description: '审核通过后才可用于制作',
            state: passed
              ? 'done'
              : review && !review.passed
                ? 'warning'
                : 'ready',
            stateLabel: passed
              ? '已通过'
              : review && !review.passed
                ? '需修订'
                : '待审核 / 修改后需重审'
          },
          {
            id: 'script',
            label: '制作剧本',
            ...scriptStep,
            state: canScript ? 'ready' : 'blocked'
          }
        ],
        primaryAction: {
          label: running ? '执行中…' : primaryLabel,
          onClick: primary,
          disabled:
            busy ||
            config.entryStage === 'script' ||
            !!doc.conflict ||
            !!doc.recovery
        },
        secondaryActions: [
          { label: '保存', onClick: saveDocument, disabled: saved || running },
          {
            label: '导入 Markdown',
            onClick: importMarkdown,
            disabled: running
          },
          {
            label: '前往剧本',
            onClick: () =>
              navigate(
                `/project/${currentProject?.id}/script?ep=${scriptEp ?? currentEp}`
              )
          }
        ]
      }}
      toolbarActions={
        <button
          className="btn btn-sm"
          disabled={running}
          onClick={() => {
            void reload()
            setRevision((v) => v + 1)
          }}
        >
          ↻ 重新加载
        </button>
      }
    />
  )
}
