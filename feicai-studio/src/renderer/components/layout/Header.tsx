import { useLocation } from 'react-router-dom'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { useAdaptStore } from '@renderer/stores/adaptStore'
import { useProjectStore } from '@renderer/stores/projectStore'
import './Header.css'

const PAGE_TITLES: Record<string, string> = {
  '/': '项目',
  '/settings': '设置'
}

function getTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]

  if (pathname.includes('/project/') && pathname.includes('/workspace')) return '🧭 工作台'
  if (pathname.includes('/project/') && pathname.includes('/source')) return '📚 内容准备'
  if (pathname.includes('/project/') && pathname.includes('/script')) return '✍️ 剧本创作'
  if (pathname.includes('/project/') && pathname.includes('/production')) return '🎬 画面制作'
  if (pathname.includes('/project/') && pathname.includes('/delivery')) return '📦 交付导出'
  if (pathname.includes('/project/')) return '🧭 工作台'
  return 'FEICAI Studio'
}

/** 将引擎状态映射为人类可读的中文标签 */
function getSeedanceStateLabel(state: string): string {
  const map: Record<string, string> = {
    idle: '就绪',
    script_loaded: '剧本已加载',
    director_analyzing: '导演分析中',
    director_reviewing: '导演审核中',
    director_done: '导演完成',
    art_designing: '服化道设计中',
    art_reviewing: '服化道审核中',
    art_done: '服化道完成',
    storyboard_writing: '分镜编写中',
    storyboard_reviewing: '分镜审核中',
    episode_complete: '已完成',
    paused: '已暂停',
    error: '执行出错'
  }
  return map[state] || state
}

/** 将编剧管线状态映射为人类可读标签 */
function getAdaptStateLabel(state: string): string {
  const map: Record<string, string> = {
    adapt_idle: '空闲',
    novel_loaded: '小说已加载',
    breakdown_executing: '📊 规划拆解中...',
    breakdown_reviewing: '🔍 规划质检中...',
    breakdown_done: '✅ 规划库存已更新',
    script_executing: '✍️ 剧本创作中...',
    script_reviewing: '🔍 剧本质检中...',
    script_done: '✅ 剧本创作完成',
    adapt_paused: '⏸ 已暂停',
    adapt_awaiting_user: '⚠️ 等待用户指导',
    adapt_error: '❌ 出错'
  }
  return map[state] || state
}

export default function Header() {
  const location = useLocation()
  const title = getTitle(location.pathname)
  const isProjectRoute = location.pathname.includes('/project/')
  const { currentProject } = useProjectStore()

  // 管线2（导演/服化道/分镜）状态
  const { state: pipelineState, isRunning: pipelineRunning, context } = usePipelineStore()

  // 编剧管线（小说→剧情拆解→剧本）状态
  const { adaptState, isRunning: adaptRunning, projectPath: adaptProjectPath } = useAdaptStore()
  const isCurrentProjectPipeline = !isProjectRoute || !currentProject || context?.projectId === currentProject.id
  const isCurrentProjectAdapt = !isProjectRoute || !currentProject || adaptProjectPath === currentProject.projectPath

  // 构建 Seedance 集数标签
  const epLabel = isCurrentProjectPipeline && context?.episodeNum
    ? `EP${String(context.episodeNum).padStart(3, '0')}`
    : ''

  const showSeedanceStatus = isCurrentProjectPipeline && (
    pipelineRunning || ['paused', 'director_done', 'art_done', 'episode_complete', 'error'].includes(pipelineState as string)
  )
  const showAdaptStatus = isCurrentProjectAdapt && (
    adaptRunning || ['adapt_paused', 'adapt_awaiting_user', 'breakdown_executing', 'breakdown_reviewing', 'script_executing', 'script_reviewing'].includes(adaptState as string)
  )

  return (
    <header className="header titlebar-drag">
      <div className="header-title">{title}</div>
      <div className="header-actions titlebar-no-drag">
        {/* 编剧管线后台状态：在任意页面都能看到当前 Adapt 进度 */}
        {showAdaptStatus && (
          <span className="header-status header-status--running">
            <span className="status-dot" />
            <span className="text-secondary">{getAdaptStateLabel(adaptState)}</span>
          </span>
        )}

        {/* Seedance 流水线状态 */}
        {showSeedanceStatus && (
          <span className="header-status header-status--running">
            <span className="status-dot" />
            {epLabel && <span className="header-ep-label">{epLabel}</span>}
            <span className="text-secondary">{getSeedanceStateLabel(pipelineState as string)}</span>
          </span>
        )}
      </div>
    </header>
  )
}
