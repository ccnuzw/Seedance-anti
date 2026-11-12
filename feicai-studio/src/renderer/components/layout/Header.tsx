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

interface HeaderProps {
  pathname: string
}

export default function Header({ pathname }: HeaderProps) {
  const title = getTitle(pathname)
  return (
    <DevProfiler id="Header">
      <header className="header titlebar-drag">
        <div className="header-title">{title}</div>
      </header>
    </DevProfiler>
  )
}
