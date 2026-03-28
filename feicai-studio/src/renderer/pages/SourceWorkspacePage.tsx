import { useMemo } from 'react'
import { Navigate, useNavigate, useSearchParams, useParams } from 'react-router-dom'
import EmptyState from '@renderer/components/layout/EmptyState'
import SectionTabs, { type SectionTabItem } from '@renderer/components/layout/SectionTabs'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { platformAPI } from '@renderer/platform/api'
import { buildProjectRoute } from '@renderer/project-routing'
import { useProjectStore } from '@renderer/stores/projectStore'
import BreakdownPage from './BreakdownPage'
import NovelPage from './NovelPage'
import './SectionPage.css'

type SourceTab = 'source' | 'plan'

function resolveSourceTab(value: string | null): SourceTab {
  return value === 'plan' ? 'plan' : 'source'
}

export default function SourceWorkspacePage() {
  useProjectSync()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { currentProject } = useProjectStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const isWebPreview = platformAPI.isWebPreview
  const activeTab = isWebPreview ? 'source' : resolveSourceTab(searchParams.get('tab'))

  const tabs = useMemo<SectionTabItem[]>(() => (
    isWebPreview
      ? [{ key: 'source', label: '小说源稿', hint: '浏览器文件导入与阅读' }]
      : [
          { key: 'source', label: '小说源稿', hint: '导入与校对输入' },
          { key: 'plan', label: '改编规划', hint: '拆解、库存与规划' }
        ]
  ), [isWebPreview])

  if (!currentProject) {
    return <EmptyState icon="📚" title="请先选择一个项目" description="选择项目后，才能整理源稿、拆解剧情并建立改编规划。" />
  }

  if (currentProject.sourceType !== 'novel') {
    return <Navigate to={`/project/${id}/workspace`} replace />
  }

  return (
    <div className="section-page page-container page-wide">
      <div className="card section-page-header">
        <div className="section-page-copy">
          <h1>内容准备</h1>
          <p className="text-secondary">
            把小说输入、剧情拆解和改编规划收在一个稳定入口里，减少为了准备输入反复跳页的成本。
          </p>
          <SectionTabs
            tabs={tabs}
            activeKey={activeTab}
            onChange={(key) => setSearchParams({ tab: key })}
          />
          {isWebPreview && (
            <p className="text-secondary" style={{ marginTop: 8 }}>
              当前浏览器模式已支持章节文件导入、初始化和原文阅读；改编规划编辑将在后续接入远程执行链路后补齐。
            </p>
          )}
        </div>
        <div className="section-page-actions">
          <button className="btn" onClick={() => navigate(buildProjectRoute(currentProject.id, 'settings'))}>
            项目设置
          </button>
          <button className="btn btn-primary" onClick={() => navigate(buildProjectRoute(currentProject.id, 'script'))}>
            打开剧本创作
          </button>
        </div>
      </div>

      {activeTab === 'source' ? <NovelPage embedded /> : <BreakdownPage embedded />}
    </div>
  )
}
