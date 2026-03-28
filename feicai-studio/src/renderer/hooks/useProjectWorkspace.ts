import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { buildProjectRoute } from '@renderer/project-routing'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { useAdaptStore } from '@renderer/stores/adaptStore'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { useProjectStore } from '@renderer/stores/projectStore'
import {
  buildProjectProgressEpisodes,
  buildProjectProgressSummary,
  formatProjectProgressRefreshTime
} from '@renderer/services/projectProgress'
import { useToastStore } from '@renderer/stores/toastStore'

export interface ProjectWorkspaceTone {
  tone: 'default' | 'warning' | 'success' | 'danger' | 'info'
}

export interface ProjectWorkspaceBusinessStatus extends ProjectWorkspaceTone {
  label: string
  description: string
}

export interface ProjectWorkspaceAction {
  title: string
  description: string
  primaryLabel: string
  primaryPath: string
  secondaryLabel: string
  secondaryPath: string
}

export interface ProjectWorkspaceModule extends ProjectWorkspaceTone {
  key: 'source' | 'script' | 'production' | 'delivery' | 'settings'
  title: string
  description: string
  hint: string
  stateLabel: string
  actionLabel: string
  path: string
}

export interface ProjectWorkspaceAttentionItem extends ProjectWorkspaceTone {
  title: string
  description: string
  path: string
}

function formatAdaptState(state: string): string {
  const map: Record<string, string> = {
    adapt_idle: '待处理',
    novel_loaded: '源稿已就绪',
    breakdown_executing: '正在补充剧情库存',
    breakdown_reviewing: '正在校验拆解结果',
    breakdown_done: '剧情库存已更新',
    script_executing: '正在生成分集剧本',
    script_reviewing: '正在校验剧本',
    script_done: '本轮剧本已产出',
    adapt_paused: '流程已暂停',
    adapt_awaiting_user: '等待人工处理',
    adapt_error: '流程异常'
  }
  return map[state] || state
}

function formatPipelineState(state: string): string {
  const map: Record<string, string> = {
    idle: '空闲',
    script_loaded: '已装载剧本',
    director_analyzing: '导演执行中',
    director_reviewing: '导演审核中',
    director_done: '导演已完成',
    art_designing: '服化道执行中',
    art_reviewing: '服化道审核中',
    art_done: '服化道已完成',
    storyboard_writing: '分镜执行中',
    storyboard_reviewing: '分镜审核中',
    episode_complete: '整集制作完成',
    paused: '已暂停',
    error: '异常'
  }
  return map[state] || state
}

export function useProjectWorkspace() {
  useProjectSync()

  const navigate = useNavigate()
  const { addToast } = useToastStore()
  const { currentProject, episodes, syncEpisodeStatus, statusRefresh } = useProjectStore()
  const {
    waterLevel,
    novelInfo,
    adaptPlan,
    adaptState,
    isRunning: adaptRunning,
    reviewFailedData,
    fetchStatus,
    loadPlan
  } = useAdaptStore()
  const {
    context: pipelineContext,
    state: pipelineState,
    isRunning: pipelineRunning,
    setupEventListeners,
    syncFromBackend
  } = usePipelineStore()

  useEffect(() => {
    if (!currentProject) return
    void syncEpisodeStatus('load')
  }, [currentProject?.id, syncEpisodeStatus])

  useEffect(() => {
    if (!currentProject || currentProject.sourceType !== 'novel') return
    void fetchStatus(currentProject.projectPath)
    void loadPlan(currentProject.projectPath)
  }, [currentProject?.id, currentProject?.projectPath, currentProject?.sourceType, fetchStatus, loadPlan])

  useEffect(() => {
    const cleanup = setupEventListeners()
    return cleanup
  }, [setupEventListeners])

  useEffect(() => {
    void syncFromBackend()
  }, [currentProject?.id, syncFromBackend])

  const totalEpisodes = currentProject?.totalEpisodes || episodes.length || 0
  const progressEpisodes = useMemo(
    () => buildProjectProgressEpisodes(episodes),
    [episodes]
  )
  const progressSummary = useMemo(
    () => buildProjectProgressSummary(episodes, totalEpisodes),
    [episodes, totalEpisodes]
  )
  const statusRefreshLabel = formatProjectProgressRefreshTime(statusRefresh.lastUpdatedAt)
  const totalChapters = waterLevel?.totalChapters || novelInfo?.totalChapters || 0
  const processedChapters = waterLevel?.processedChapters || 0
  const scriptsCount = episodes.filter((episode) => episode.hasScript).length
  const promptReadyCount = episodes.filter((episode) => episode.hasSeedancePrompts).length
  const inProductionCount = episodes.filter((episode) => episode.status !== 'idle' && episode.status !== 'complete').length
  const completedCount = episodes.filter((episode) => episode.status === 'complete').length
  const pendingScriptCount = Math.max(totalEpisodes - scriptsCount, 0)
  const pendingProductionCount = Math.max(scriptsCount - promptReadyCount, 0)
  const breakdownReady = processedChapters > 0 || !!adaptPlan
  const chapterCoverage = totalChapters > 0 ? Math.round((processedChapters / totalChapters) * 100) : 0
  const scriptCoverage = totalEpisodes > 0 ? Math.round((scriptsCount / totalEpisodes) * 100) : 0
  const promptCoverage = totalEpisodes > 0 ? Math.round((promptReadyCount / totalEpisodes) * 100) : 0
  const activePipelineEpisode = pipelineContext?.projectId === currentProject?.id ? pipelineContext.episodeNum : null

  const businessStatus = useMemo<ProjectWorkspaceBusinessStatus>(() => {
    if (!currentProject) {
      return {
        label: '待进入',
        description: '当前还没有项目上下文。',
        tone: 'default'
      }
    }

    if (currentProject.sourceType === 'novel') {
      if (totalChapters === 0) {
        return {
          label: '待准备',
          description: '还没有稳定源稿输入，建议先完成内容准备。',
          tone: 'warning'
        }
      }
      if (!breakdownReady) {
        return {
          label: '待规划',
          description: '剧情库存和改编规划还没稳定，继续创作的返工风险较高。',
          tone: 'warning'
        }
      }
      if (reviewFailedData) {
        return {
          label: '写作阻塞',
          description: '当前存在待处理质检失败项，建议先闭环后再继续推进。',
          tone: 'danger'
        }
      }
      if (currentProject.phase !== 'production') {
        if (scriptsCount < totalEpisodes) {
          return {
            label: '写作进行中',
            description: '剧本仍在持续成稿，下一步应继续推进剧本工作区。',
            tone: 'info'
          }
        }
        return {
          label: '待送制作',
          description: '写作产物已经基本齐备，建议进入交付导出检查是否切阶段。',
          tone: 'success'
        }
      }
    }

    if (currentProject.phase === 'production') {
      if (pipelineRunning || inProductionCount > 0) {
        return {
          label: '制作进行中',
          description: '当前已经进入制作阶段，建议围绕当前集继续推进制作闭环。',
          tone: 'info'
        }
      }
      if (scriptsCount > 0 && promptReadyCount < scriptsCount) {
        return {
          label: '待补制作',
          description: '已有可制作剧本，但仍有集数没有完成提示词产物。',
          tone: 'warning'
        }
      }
      if (completedCount > 0 && completedCount >= Math.max(scriptsCount, 1)) {
        return {
          label: '待导出',
          description: '当前项目已经具备导出基础，可以在交付导出页统一收口。',
          tone: 'success'
        }
      }
    }

    if (scriptsCount === 0) {
      return {
        label: '待成稿',
        description: '还没有可用剧本文件，建议先进入剧本创作。',
        tone: 'warning'
      }
    }

    return {
      label: '可继续推进',
      description: '当前没有显式阻塞，可以按照推荐下一步继续。',
      tone: 'default'
    }
  }, [
    breakdownReady,
    completedCount,
    currentProject,
    inProductionCount,
    pipelineRunning,
    promptReadyCount,
    reviewFailedData,
    scriptsCount,
    totalChapters,
    totalEpisodes
  ])

  const nextAction = useMemo<ProjectWorkspaceAction>(() => {
    if (!currentProject) {
      return {
        title: '请先选择项目',
        description: '选择项目后才能进入完整工作流。',
        primaryLabel: '返回首页',
        primaryPath: '/',
        secondaryLabel: '任务中心',
        secondaryPath: '/tasks'
      }
    }

    if (currentProject.sourceType === 'novel' && totalChapters === 0) {
      return {
        title: '先把内容准备补齐',
        description: '当前还没有稳定源稿输入。先完成源稿导入和基础信息核对，后面的规划与创作才有依据。',
        primaryLabel: '打开内容准备',
        primaryPath: buildProjectRoute(currentProject.id, 'source'),
        secondaryLabel: '任务中心',
        secondaryPath: '/tasks'
      }
    }

    if (currentProject.sourceType === 'novel' && !breakdownReady) {
      return {
        title: '先建立改编规划',
        description: '当前还没有稳定的剧情库存和卷级规划，建议先把输入边界收紧，再进入正式创作。',
        primaryLabel: '打开改编规划',
        primaryPath: buildProjectRoute(currentProject.id, 'source', 'tab=plan'),
        secondaryLabel: '打开内容准备',
        secondaryPath: buildProjectRoute(currentProject.id, 'source')
      }
    }

    if (reviewFailedData) {
      return {
        title: '优先处理待修订问题',
        description: '已有审核失败项在阻塞流程，建议先把问题闭环，避免错误继续传导到制作侧。',
        primaryLabel: '处理剧本问题',
        primaryPath: buildProjectRoute(currentProject.id, 'script', 'tab=issues'),
        secondaryLabel: '打开任务中心',
        secondaryPath: '/tasks'
      }
    }

    if (scriptsCount < Math.max(totalEpisodes, 1)) {
      return {
        title: '继续推进剧本创作',
        description: '当前还有集数未成稿，建议回到剧本工作区继续生成、修订并保存。',
        primaryLabel: '打开剧本创作',
        primaryPath: buildProjectRoute(currentProject.id, 'script'),
        secondaryLabel: '查看内容准备',
        secondaryPath: buildProjectRoute(currentProject.id, 'source', currentProject.sourceType === 'novel' ? 'tab=plan' : undefined)
      }
    }

    if (currentProject.phase !== 'production') {
      return {
        title: '进入交付导出做最终判断',
        description: '写作产物已经形成，当前最应该做的是确认交付条件、切换阶段，并决定导出方式。',
        primaryLabel: '打开交付导出',
        primaryPath: buildProjectRoute(currentProject.id, 'delivery'),
        secondaryLabel: '回到剧本创作',
        secondaryPath: buildProjectRoute(currentProject.id, 'script')
      }
    }

    if (promptReadyCount < scriptsCount || pipelineRunning) {
      return {
        title: activePipelineEpisode
          ? `继续推进 EP${String(activePipelineEpisode).padStart(3, '0')} 制作`
          : '继续推进画面制作',
        description: '当前制作阶段尚未收口，建议围绕当前集的制作流程、提示词和审核问题继续推进。',
        primaryLabel: '打开画面制作',
        primaryPath: buildProjectRoute(
          currentProject.id,
          'production',
          activePipelineEpisode ? `ep=${activePipelineEpisode}` : undefined
        ),
        secondaryLabel: '打开交付导出',
        secondaryPath: buildProjectRoute(currentProject.id, 'delivery')
      }
    }

    return {
      title: '收尾并导出项目产物',
      description: '当前核心制作产物已经形成，建议在交付导出页统一做导出与收尾动作。',
      primaryLabel: '打开交付导出',
      primaryPath: buildProjectRoute(currentProject.id, 'delivery'),
      secondaryLabel: '查看画面制作',
      secondaryPath: buildProjectRoute(currentProject.id, 'production')
    }
  }, [
    activePipelineEpisode,
    breakdownReady,
    currentProject,
    pipelineRunning,
    promptReadyCount,
    reviewFailedData,
    scriptsCount,
    totalChapters,
    totalEpisodes
  ])

  const modules = useMemo<ProjectWorkspaceModule[]>(() => {
    if (!currentProject) return []
    return [
      {
        key: 'source',
        title: '内容准备',
        description: currentProject.sourceType === 'novel'
          ? '把源稿输入、改编规划和剧情库存收在一个入口里管理。'
          : '围绕项目输入、基础设定和已有资料做统一整理。',
        hint: currentProject.sourceType === 'novel'
          ? `${chapterCoverage}% 已拆解`
          : '基础输入已就绪',
        stateLabel: currentProject.sourceType === 'novel'
          ? totalChapters === 0
            ? '待导入'
            : breakdownReady
              ? '已具备规划'
              : '待补规划'
          : '项目输入',
        actionLabel: currentProject.sourceType === 'novel' ? '打开内容准备' : '查看输入',
        path: buildProjectRoute(currentProject.id, 'source'),
        tone: currentProject.sourceType === 'novel'
          ? (breakdownReady ? 'success' : 'warning')
          : 'default'
      },
      {
        key: 'script',
        title: '剧本创作',
        description: '集中处理剧本生成、编辑、修订和问题闭环，避免“写作页”和“编辑页”分裂。',
        hint: `${scriptsCount}/${Math.max(totalEpisodes, 1)} 集已成稿`,
        stateLabel: reviewFailedData
          ? '存在阻塞'
          : scriptsCount === 0
            ? '待成稿'
            : scriptsCount < Math.max(totalEpisodes, 1)
              ? '持续推进中'
              : '基本齐备',
        actionLabel: reviewFailedData ? '处理问题' : '打开剧本创作',
        path: buildProjectRoute(currentProject.id, 'script', reviewFailedData ? 'tab=issues' : undefined),
        tone: reviewFailedData ? 'danger' : (scriptsCount > 0 ? 'default' : 'warning')
      },
      {
        key: 'production',
        title: '画面制作',
        description: '把制作流程、素材、提示词、审核与批量任务收在一个工作区里推进。',
        hint: `${promptReadyCount}/${Math.max(totalEpisodes, 1)} 集已有提示词`,
        stateLabel: currentProject.phase !== 'production'
          ? '待进入'
          : pipelineRunning
            ? '执行中'
            : pendingProductionCount > 0
              ? '待补制作'
              : completedCount > 0
                ? '已形成产物'
                : '待启动',
        actionLabel: currentProject.phase !== 'production' ? '查看交付导出' : '打开画面制作',
        path: currentProject.phase !== 'production'
          ? buildProjectRoute(currentProject.id, 'delivery')
          : buildProjectRoute(
              currentProject.id,
              'production',
              activePipelineEpisode ? `ep=${activePipelineEpisode}` : undefined
            ),
        tone: currentProject.phase !== 'production'
          ? 'default'
          : (pipelineRunning || completedCount > 0 ? 'success' : 'warning')
      },
      {
        key: 'delivery',
        title: '交付导出',
        description: '在一个入口里完成交付检查、阶段切换、导出与最终收尾。',
        hint: completedCount > 0
          ? `${completedCount} 集已完成制作`
          : currentProject.phase === 'production'
            ? '等待交付收尾'
            : '待检查交付条件',
        stateLabel: currentProject.phase === 'production'
          ? completedCount > 0
            ? '可收尾'
            : '制作中'
          : scriptsCount > 0
            ? '可判断'
            : '待补齐',
        actionLabel: '打开交付导出',
        path: buildProjectRoute(currentProject.id, 'delivery'),
        tone: completedCount > 0 || (currentProject.phase !== 'production' && scriptsCount > 0)
          ? 'success'
          : 'default'
      },
      {
        key: 'settings',
        title: '项目设置',
        description: '集中管理项目级流程参数、自动化模板、调度计划和导出默认值。',
        hint: templateProfileHint(currentProject.config.templateProfileId, currentProject.config.exportProfileId),
        stateLabel: hasProjectSettings(currentProject.config) ? '已配置' : '待梳理',
        actionLabel: '打开项目设置',
        path: buildProjectRoute(currentProject.id, 'settings'),
        tone: hasProjectSettings(currentProject.config) ? 'default' : 'warning'
      }
    ]
  }, [
    activePipelineEpisode,
    breakdownReady,
    chapterCoverage,
    completedCount,
    currentProject,
    pendingProductionCount,
    pipelineRunning,
    promptReadyCount,
    reviewFailedData,
    scriptsCount,
    totalChapters,
    totalEpisodes
  ])

  const attentionItems = useMemo<ProjectWorkspaceAttentionItem[]>(() => {
    if (!currentProject) return []
    const items: ProjectWorkspaceAttentionItem[] = []

    if (reviewFailedData) {
      items.push({
        title: '存在待处理质检失败',
        description: '当前已有失败项在阻塞写作闭环，建议优先处理而不是继续扩张新集数。',
        path: buildProjectRoute(currentProject.id, 'script', 'tab=issues'),
        tone: 'danger'
      })
    }

    if (currentProject.sourceType === 'novel' && totalChapters === 0) {
      items.push({
        title: '缺少源稿输入',
        description: '没有章节输入时，改编规划和剧本生成都会失去稳定依据。',
        path: buildProjectRoute(currentProject.id, 'source'),
        tone: 'warning'
      })
    } else if (currentProject.sourceType === 'novel' && !breakdownReady) {
      items.push({
        title: '改编规划仍未稳定',
        description: '剧情库存和卷级规划仍不完整，继续创作会提高返工概率。',
        path: buildProjectRoute(currentProject.id, 'source', 'tab=plan'),
        tone: 'warning'
      })
    }

    if (pendingScriptCount > 0) {
      items.push({
        title: '仍有集数未成稿',
        description: `还有 ${pendingScriptCount} 集没有剧本文件，交付判断和制作推进都会受影响。`,
        path: buildProjectRoute(currentProject.id, 'script'),
        tone: 'info'
      })
    }

    if (currentProject.phase === 'production' && pendingProductionCount > 0) {
      items.push({
        title: '制作产物仍未收齐',
        description: `当前还有 ${pendingProductionCount} 集已成稿但缺少提示词产物，建议继续推进制作工作区。`,
        path: buildProjectRoute(currentProject.id, 'production'),
        tone: 'warning'
      })
    }

    if (items.length === 0) {
      items.push({
        title: '当前没有显式阻塞',
        description: '可以直接按推荐下一步继续推进当前项目。',
        path: nextAction.primaryPath,
        tone: 'success'
      })
    }

    return items.slice(0, 4)
  }, [
    breakdownReady,
    currentProject,
    nextAction.primaryPath,
    pendingProductionCount,
    pendingScriptCount,
    reviewFailedData,
    totalChapters
  ])

  const handleRefreshProjectStatus = async () => {
    if (!currentProject || statusRefresh.syncing) return
    const ok = await syncEpisodeStatus('status-command')
    addToast(
      ok ? 'success' : 'warning',
      ok ? '项目状态已刷新' : '项目状态刷新失败，已保留当前结果',
      {
        title: '~status',
        duration: ok ? 2600 : 4200
      }
    )
  }

  return {
    currentProject,
    episodes,
    totalEpisodes,
    scriptsCount,
    promptReadyCount,
    inProductionCount,
    completedCount,
    chapterCoverage,
    scriptCoverage,
    promptCoverage,
    businessStatus,
    nextAction,
    modules,
    attentionItems,
    progressEpisodes,
    progressSummary,
    statusRefresh,
    statusRefreshLabel,
    adaptRunning,
    adaptStateLabel: formatAdaptState(adaptState),
    pipelineRunning,
    pipelineStateLabel: formatPipelineState(pipelineState),
    activePipelineEpisode,
    handleOpenPath: (path: string) => navigate(path),
    handleOpenTasks: () => navigate('/tasks'),
    handleOpenSettings: () => currentProject && navigate(buildProjectRoute(currentProject.id, 'settings')),
    handleRefreshProjectStatus
  }
}

function hasProjectSettings(config: NonNullable<ReturnType<typeof useProjectStore.getState>['currentProject']>['config']): boolean {
  return Boolean(
    config.pipelineSettings ||
    config.reviewPolicy ||
    config.taskDefaults ||
    (config.taskTemplates && config.taskTemplates.length > 0) ||
    (config.taskSchedules && config.taskSchedules.length > 0) ||
    config.taskAlerts ||
    config.templateProfileId ||
    config.exportProfileId
  )
}

function templateProfileHint(templateProfileId?: string, exportProfileId?: string): string {
  if (templateProfileId && exportProfileId) return '预设与导出默认已设'
  if (templateProfileId) return '项目预设已设'
  if (exportProfileId) return '导出默认已设'
  return '参数与自动化'
}
