import EmptyState from '@renderer/components/layout/EmptyState'
import ProjectSettingsWorkspace from '@renderer/components/project-settings/ProjectSettingsWorkspace'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { useProjectStore } from '@renderer/stores/projectStore'
import './SectionPage.css'
import './ProjectPage.css'
import './ProjectSettingsPage.css'

export default function ProjectSettingsPage() {
  useProjectSync()
  const { currentProject } = useProjectStore()

  if (!currentProject) {
    return <EmptyState icon="⚙️" title="请先选择一个项目" description="选择项目后，才能统一调整项目参数、自动化策略和导出默认值。" />
  }

  return (
    <div className="section-page page-container page-wide">
      <ProjectSettingsWorkspace />
    </div>
  )
}
