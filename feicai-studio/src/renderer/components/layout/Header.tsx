import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { useShallow } from 'zustand/react/shallow'
import { DevProfiler } from '@renderer/dev/render-profiler'
import './Header.css'

const PAGE_TITLES: Record<string, string> = {
  '/': '仪表盘',
  '/settings': '设置'
}

function getTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]
  if (pathname.includes('/pipeline')) return '⚡ 流水线'
  if (pathname.includes('/batch')) return '🚀 批量执行'
  if (pathname.includes('/source')) return '📚 小说原文'
  if (pathname.includes('/story')) return '🧩 剧情拆解'
  if (pathname.includes('/assets')) return '🎭 素材库'
  if (pathname.includes('/prompts')) return '📐 提示词'
  if (pathname.includes('/script')) return '📖 剧本'
  if (pathname.includes('/review')) return '📊 审核报告'
  if (pathname.includes('/health')) return '🧪 项目体检与修复'
  if (pathname.includes('/project/')) return '📋 项目详情'
  return 'FEICAI Studio'
}

/** 将引擎状态映射为人类可读的中文标签 */
function getStateLabel(state: string): string {
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

interface HeaderProps {
  pathname: string
}

export default function Header({ pathname }: HeaderProps) {
  const title = getTitle(pathname)
  const { state, isRunning, episodeNum } = usePipelineStore(
    useShallow((s) => ({
      state: s.state,
      isRunning: s.isRunning,
      episodeNum: s.context?.episodeNum
    }))
  )

  // 构建集数标签
  const epLabel = episodeNum ? `EP${String(episodeNum).padStart(2, '0')}` : ''

  return (
    <DevProfiler id="Header">
      <header className="header titlebar-drag">
        <div className="header-title">{title}</div>
        <div className="header-actions titlebar-no-drag">
          {/* 运行中 */}
          {isRunning && (
            <span className="header-status header-status--running">
              <span className="status-dot" />
              {epLabel && <span className="header-ep-label">{epLabel}</span>}
              <span className="text-secondary">{getStateLabel(state)}</span>
            </span>
          )}
          {/* 完成 */}
          {!isRunning && state === 'episode_complete' && (
            <span className="header-status header-status--done">
              <span className="status-icon">✅</span>
              {epLabel && <span className="header-ep-label">{epLabel}</span>}
              <span className="text-secondary">已完成</span>
            </span>
          )}
          {/* 错误 */}
          {!isRunning && state === 'error' && (
            <span className="header-status header-status--error">
              <span className="status-icon">❌</span>
              {epLabel && <span className="header-ep-label">{epLabel}</span>}
              <span className="text-secondary">执行出错</span>
            </span>
          )}
        </div>
      </header>
    </DevProfiler>
  )
}
