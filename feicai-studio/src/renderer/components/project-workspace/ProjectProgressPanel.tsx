import type { useProjectWorkspace } from '@renderer/hooks/useProjectWorkspace'
import {
  formatProjectProgressPromptMeta,
  getProjectProgressStageMeta
} from '@renderer/services/projectProgress'
import { IPC } from '@shared/ipc-channels'
import { platformAPI } from '@renderer/platform/api'
import type { ProjectProgress } from '@shared/types'
import { useEffect, useState } from 'react'

type ProjectWorkspaceState = ReturnType<typeof useProjectWorkspace>

interface ProjectProgressPanelProps {
  workspace: ProjectWorkspaceState
}

function formatStageDetails(item: ProjectWorkspaceState['progressEpisodes'][number]): string {
  if (item.stage.key === 'idle') {
    return item.hasScript ? '剧本已就绪，待进入导演分析。' : '尚未开始，建议先补齐剧本。'
  }
  if (item.stage.key === 'director') {
    return item.hasArtDesign ? '导演与服化道结果已形成。' : '导演分析已完成，待推进服化道。'
  }
  if (item.stage.key === 'art') {
    return item.hasSeedancePrompts ? '服化道与分镜结果已形成。' : '服化道已完成，待补齐分镜 / 提示词。'
  }
  if (item.stage.key === 'storyboard') {
    return item.hasSeedancePrompts ? '分镜结果已形成，待确认是否收口。' : '已进入分镜阶段。'
  }
  return '该集已完成当前项目定义下的制作闭环。'
}

function formatFineStageState(item: ProjectProgress['episodes'][number] | undefined): string {
  if (!item) return '—'
  if (item.currentPipelineState === 'art_designing') return '生成中'
  if (item.currentPipelineState === 'art_reviewing') return '审核中'
  if (item.stageState === 'failed' && item.status === 'art') return '失败'
  if (item.hasArtDesign && item.hasAssetUpdates) return '已完成并已新增提示词'
  if (item.hasArtDesign) return '已完成'
  if (item.hasDirectorAnalysis) return '未开始'
  return '待导演完成'
}

export default function ProjectProgressPanel({ workspace }: ProjectProgressPanelProps) {
  const {
    currentProject,
    progressEpisodes,
    progressSummary,
    statusRefresh,
    statusRefreshLabel,
    handleRefreshProjectStatus
  } = workspace
  const [projectProgress, setProjectProgress] = useState<ProjectProgress | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!currentProject) {
        setProjectProgress(null)
        return
      }
      try {
        const progress = await platformAPI.invoke(
          IPC.PROJECT_GET_PROGRESS,
          currentProject.projectPath,
          currentProject.totalEpisodes || progressEpisodes.length
        ) as ProjectProgress
        if (!cancelled) setProjectProgress(progress)
      } catch {
        if (!cancelled) setProjectProgress(null)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [currentProject, progressEpisodes.length, statusRefresh.lastUpdatedAt])

  return (
    <div className="card project-progress-panel">
      <div className="project-workspace-section-head">
        <div>
          <h3>项目进度视图</h3>
          <p className="text-secondary text-xs project-progress-subtitle">
            用统一的状态表回答“每一集当前做到哪一步”，并提供 ~status 刷新入口。
          </p>
        </div>
        <div className="project-progress-toolbar">
          <span className={`status-chip tone-${statusRefresh.lastSuccess === false ? 'warning' : 'info'}`}>
            {statusRefresh.syncing ? '正在执行 ~status' : '~status'}
          </span>
          <button
            className="btn btn-sm"
            onClick={handleRefreshProjectStatus}
            disabled={statusRefresh.syncing}
          >
            {statusRefresh.syncing ? '刷新中…' : '刷新项目状态'}
          </button>
        </div>
      </div>

      <div className="project-progress-summary-grid">
        <div className="project-progress-summary-card">
          <span className="project-workspace-label">整体结论</span>
          <strong>{progressSummary.humanSummary}</strong>
          <span className="text-secondary text-xs">最近更新：{statusRefreshLabel}</span>
        </div>
        <div className="project-progress-summary-card">
          <span className="project-workspace-label">完成进度</span>
          <strong>{progressSummary.completedCount}/{progressSummary.totalEpisodes}</strong>
          <span className="text-secondary text-xs">完成率 {progressSummary.completionRate}%</span>
        </div>
        {progressSummary.stageSummary.map((item) => (
          <div key={item.key} className={`project-progress-summary-card tone-${item.tone}`}>
            <span className="project-workspace-label">{item.label}</span>
            <strong>{item.count}</strong>
            <span className="text-secondary text-xs">当前处于该阶段的集数</span>
          </div>
        ))}
      </div>

      {statusRefresh.lastMessage && (
        <div className={`project-progress-feedback tone-${statusRefresh.lastSuccess === false ? 'warning' : 'info'}`}>
          <strong>~status 反馈</strong>
          <span>{statusRefresh.lastMessage}</span>
        </div>
      )}

      <div className="project-progress-table-wrap">
        <table className="project-progress-table">
          <thead>
            <tr>
              <th>集数</th>
              <th>当前阶段</th>
              <th>剧本</th>
              <th>导演分析</th>
              <th>服化道</th>
              <th>分镜 / 提示词</th>
              <th>补充信息</th>
            </tr>
          </thead>
          <tbody>
            {progressEpisodes.map((item) => {
              const stageMeta = getProjectProgressStageMeta(item.stage.key)
              const detail = projectProgress?.episodes.find((episode) => episode.episodeNumber === item.episodeNumber)
              const artStateText = formatFineStageState(detail)
              return (
                <tr key={item.code}>
                  <td>
                    <div className="project-progress-episode-cell">
                      <strong>{item.code}</strong>
                      <span className="text-secondary">{item.title}</span>
                    </div>
                  </td>
                  <td>
                    <div className="project-progress-stage-cell">
                      <span className={`status-chip tone-${stageMeta.tone}`}>{detail?.statusLabel || stageMeta.label}</span>
                      <span className="text-secondary text-xs">{formatStageDetails(item)}</span>
                    </div>
                  </td>
                  <td>{item.hasScript ? '已成稿' : '待补齐'}</td>
                  <td>
                    {item.hasDirectorAnalysis
                      ? '已完成'
                      : item.stage.key === 'idle'
                        ? '未开始'
                        : item.stage.key === 'director'
                          ? '进行中'
                          : '待同步'}
                  </td>
                  <td>
                    <div className="project-progress-stage-cell">
                      <span>{artStateText}</span>
                      {detail?.stageStateLabel && <span className="text-secondary text-xs">{detail.stageStateLabel}</span>}
                    </div>
                  </td>
                  <td>{item.hasSeedancePrompts ? '已完成' : '待生成'}</td>
                  <td className="text-secondary">
                    {formatProjectProgressPromptMeta(item.totalPrompts, item.totalDurationSeconds)}
                    {detail?.hasAssetUpdates ? ` · 新增${detail.assetUpdateKinds.includes('character') ? '人物' : ''}${detail.assetUpdateKinds.includes('scene') ? `${detail.assetUpdateKinds.includes('character') ? '/' : ''}场景` : ''}提示词` : ''}
                    {detail?.lastError ? ` · ${detail.lastError}` : ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
