import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IPC } from '@shared/ipc-channels'
import { platformAPI } from '@renderer/platform/api'
import { buildProjectRoute } from '@renderer/project-routing'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { useAdaptStore } from '@renderer/stores/adaptStore'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'

interface EpisodeState {
  completedStages: string[]
}

interface ProjectState {
  episodes: Record<number, EpisodeState>
}

function formatEpisodeLabel(episodeNum: number): string {
  return `EP${String(episodeNum).padStart(3, '0')}`
}

function getEpisodePipelineLabel(status: string): string {
  const map: Record<string, string> = {
    idle: '未送制作',
    director: '导演阶段',
    art: '美术阶段',
    storyboard: '分镜阶段',
    complete: '制作完成'
  }
  return map[status] || status
}

export function useDeliveryHandoffWorkspace() {
  useProjectSync()

  const navigate = useNavigate()
  const { currentProject, episodes, syncEpisodeStatus, updatePhase } = useProjectStore()
  const { waterLevel, adaptPlan, reviewFailedData, isRunning, fetchStatus, loadPlan } = useAdaptStore()
  const { addToast } = useToastStore()
  const [historicalState, setHistoricalState] = useState<ProjectState | null>(null)

  useEffect(() => {
    if (!currentProject || currentProject.sourceType !== 'novel') return
    void syncEpisodeStatus()
    void fetchStatus(currentProject.projectPath)
    void loadPlan(currentProject.projectPath)
    void (async () => {
      try {
        const state = await platformAPI.invoke(
          IPC.PROJECT_GET_PIPELINE_STATE,
          currentProject.projectPath
        ) as ProjectState | null
        if (useProjectStore.getState().currentProject?.id === currentProject.id) {
          setHistoricalState(state)
        }
      } catch {
        if (useProjectStore.getState().currentProject?.id === currentProject.id) {
          setHistoricalState(null)
        }
      }
    })()
  }, [currentProject?.id, currentProject?.projectPath, currentProject?.sourceType, fetchStatus, loadPlan, syncEpisodeStatus])

  const scriptsCount = episodes.filter((episode) => episode.hasScript).length
  const completedCount = episodes.filter((episode) => episode.status === 'complete').length
  const inProductionCount = episodes.filter((episode) => episode.status !== 'idle').length
  const totalEpisodes = currentProject?.totalEpisodes || episodes.length || 0
  const totalChapters = waterLevel?.totalChapters || 0
  const processedChapters = waterLevel?.processedChapters || 0
  const missingScriptEpisodes = episodes
    .filter((episode) => !episode.hasScript)
    .map((episode) => episode.episodeNumber)
    .sort((a, b) => a - b)
  const readyEpisodes = episodes.filter((episode) => episode.hasScript)
  const firstReadyEpisode = readyEpisodes[0]?.episodeNumber || null

  const checklist = useMemo(() => [
    {
      label: '小说输入已就绪',
      ready: totalChapters > 0,
      hint: totalChapters > 0 ? `已识别 ${totalChapters} 章，可追溯源稿` : '仍需导入小说章节'
    },
    {
      label: '改编规划具备基础',
      ready: processedChapters > 0 || !!adaptPlan,
      hint: processedChapters > 0 || adaptPlan ? '已有剧情拆解或规划，可解释剧本来源' : '建议先完成剧情拆解与规划'
    },
    {
      label: '至少有可交付剧本',
      ready: scriptsCount > 0,
      hint: scriptsCount > 0 ? `当前已有 ${scriptsCount} 集剧本可以进入制作` : '尚未形成任何可交付剧本'
    },
    {
      label: '当前没有运行中阻塞',
      ready: !isRunning,
      hint: isRunning ? '仍有编剧任务运行中，建议先等待当前批次稳定' : '当前没有进行中的编剧长任务'
    },
    {
      label: '当前没有待修订失败项',
      ready: !reviewFailedData,
      hint: reviewFailedData ? '存在待处理审核失败项，建议先完成修订闭环' : '当前没有已知失败阻塞'
    }
  ], [adaptPlan, isRunning, processedChapters, reviewFailedData, scriptsCount, totalChapters])

  const readyCount = checklist.filter((item) => item.ready).length
  const readinessScore = Math.round((readyCount / checklist.length) * 100)
  const canUpgrade = scriptsCount > 0 && !reviewFailedData && !isRunning
  const fullCoverageReady = totalEpisodes > 0 && scriptsCount >= totalEpisodes
  const handoffMode = fullCoverageReady ? 'full' : canUpgrade ? 'partial' : 'blocked'

  const handoffRows = useMemo(() => (
    episodes
      .map((episode) => {
        const stageHistory = historicalState?.episodes?.[episode.episodeNumber]?.completedStages || []
        const canStartProduction = episode.hasScript && !reviewFailedData
        let handoffStatus = '待补写'
        if (episode.status === 'complete') handoffStatus = '已制作完成'
        else if (episode.status !== 'idle') handoffStatus = '已进入制作'
        else if (canStartProduction) handoffStatus = '可送制作'
        else if (episode.hasScript) handoffStatus = '待清理质检'

        return {
          episodeNum: episode.episodeNumber,
          hasScript: episode.hasScript,
          productionStatus: episode.status,
          pipelineLabel: getEpisodePipelineLabel(episode.status),
          handoffStatus,
          canStartProduction,
          stageHistory
        }
      })
      .sort((a, b) => a.episodeNum - b.episodeNum)
  ), [episodes, historicalState, reviewFailedData])

  const nextAction = useMemo(() => {
    if (!currentProject) {
      return {
        title: '请先选择项目',
        description: '当前还没有可处理的项目上下文。',
        path: '/',
        label: '返回首页'
      }
    }
    if (reviewFailedData) {
      return {
        title: '先闭环待处理问题',
        description: '当前仍有审核失败待处理。先回到问题修订，把失败项清掉，再谈交付。',
        path: buildProjectRoute(currentProject.id, 'script', 'tab=issues'),
        label: '处理问题'
      }
    }
    if (missingScriptEpisodes.length > 0) {
      return {
        title: '优先补齐未成稿集',
        description: `还有 ${missingScriptEpisodes.length} 集没有剧本文件，建议先补齐创作，再做整体交付判断。`,
        path: buildProjectRoute(currentProject.id, 'script', `ep=${missingScriptEpisodes[0]}`),
        label: '补齐剧本'
      }
    }
    if (canUpgrade && firstReadyEpisode) {
      return {
        title: '开始制作首个就绪集',
        description: '写作阶段已经具备交付基础，可以先送入制作，观察全链路质量。',
        path: buildProjectRoute(currentProject.id, 'production', `tab=pipeline&ep=${firstReadyEpisode}`),
        label: '打开画面制作'
      }
    }
    return {
      title: '回到剧本创作继续推进',
      description: '当前还不适合进入制作阶段，建议继续补齐剧本与修订。',
      path: buildProjectRoute(currentProject.id, 'script'),
      label: '打开剧本创作'
    }
  }, [canUpgrade, currentProject, firstReadyEpisode, missingScriptEpisodes, reviewFailedData])

  const handleUpgradePhase = useCallback(async () => {
    if (!currentProject || currentProject.phase === 'production') return
    if (!canUpgrade) {
      addToast('warning', '当前仍存在交付缺口，建议先完成检查项')
      return
    }
    const confirmed = window.confirm(
      fullCoverageReady
        ? '确认把整个项目切换到制作阶段？'
        : '当前并非所有集都已成稿，确认以“边写边制”的方式进入制作阶段？'
    )
    if (!confirmed) return
    try {
      await updatePhase('production')
      addToast('success', '项目已切换到制作阶段')
      if (firstReadyEpisode) {
        navigate(buildProjectRoute(currentProject.id, 'production', `tab=pipeline&ep=${firstReadyEpisode}`))
      } else {
        navigate(buildProjectRoute(currentProject.id, 'production'))
      }
    } catch (error) {
      addToast('error', `切换制作阶段失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [addToast, canUpgrade, currentProject, firstReadyEpisode, fullCoverageReady, navigate, updatePhase])

  return {
    currentProject,
    scriptsCount,
    completedCount,
    inProductionCount,
    totalEpisodes,
    totalChapters,
    processedChapters,
    missingScriptEpisodes,
    readyEpisodes,
    checklist,
    readyCount,
    readinessScore,
    canUpgrade,
    handoffMode,
    handoffRows,
    nextAction,
    reviewFailedData,
    isRunning,
    unusedPlots: waterLevel?.unusedPlots || 0,
    formatEpisodeLabel,
    handleOpenPath: (path: string) => navigate(path),
    handleOpenScript: (episodeNum: number) => navigate(buildProjectRoute(currentProject!.id, 'script', `ep=${episodeNum}`)),
    handleOpenScriptIssues: () => navigate(buildProjectRoute(currentProject!.id, 'script', 'tab=issues')),
    handleOpenProduction: (episodeNum?: number) => navigate(
      buildProjectRoute(currentProject!.id, 'production', episodeNum ? `tab=pipeline&ep=${episodeNum}` : undefined)
    ),
    handleUpgradePhase
  }
}
