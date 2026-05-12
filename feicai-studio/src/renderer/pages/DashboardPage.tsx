import ProjectIntegrityCard from '@renderer/components/project/ProjectIntegrityCard'
import NewProjectWizard from '@renderer/components/dashboard/NewProjectWizard'
import DashboardProjectGrid from '@renderer/components/dashboard/DashboardProjectGrid'
import DashboardStats from '@renderer/components/dashboard/DashboardStats'
import { useDashboardPageController } from '@renderer/hooks/useDashboardPageController'
import './DashboardPage.css'

export default function DashboardPage() {
  const controller = useDashboardPageController()

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-title">
            <span className="title-emoji">🎬</span>
            欢迎使用 FEICAI Studio
          </h1>
          <p className="dashboard-subtitle text-secondary">
            AI 驱动的影视短剧制作工作台
          </p>
        </div>
        <div className="dashboard-actions">
          <button className="btn" onClick={controller.handleImportProject}>
            📁 导入项目
          </button>
          <button
            className="btn btn-primary"
            onClick={controller.openNewProjectWizard}
          >
            ✨ 新建项目
          </button>
        </div>
      </div>

      {controller.pendingImport?.detected.integrity && (
        <ProjectIntegrityCard
          title="🧪 导入前体检"
          report={controller.pendingImport.detected.integrity}
          onConfirm={
            controller.pendingImport.config
              ? controller.confirmImportProject
              : undefined
          }
          onCancel={() => controller.setPendingImport(null)}
          confirmLabel="继续导入"
        />
      )}

      <NewProjectWizard
        show={controller.showNewDialog}
        wizardStep={controller.wizardStep}
        setWizardStep={controller.setWizardStep}
        newName={controller.newName}
        setNewName={controller.setNewName}
        newDir={controller.newDir}
        newStyle={controller.newStyle}
        setNewStyle={controller.setNewStyle}
        newMedium={controller.newMedium}
        setNewMedium={controller.setNewMedium}
        newEpisodes={controller.newEpisodes}
        setNewEpisodes={controller.setNewEpisodes}
        sourceNovelFilePath={controller.sourceNovelFilePath}
        entryStage={controller.entryStage}
        workflowMode={controller.workflowMode}
        selectedOption={controller.selectedOption}
        entryOptions={controller.entryOptions}
        visualStyles={controller.visualStyles}
        targetMediums={controller.targetMediums}
        onCancel={controller.resetWizard}
        onSelectDir={controller.handleSelectDir}
        onSelectSourceNovelFile={controller.handleSelectSourceNovelFile}
        onChooseEntry={controller.handleChooseEntry}
        onCreateProject={() => {
          void controller.handleCreateProject()
        }}
      />

      <DashboardProjectGrid
        projects={controller.projects}
        onOpenProject={controller.handleOpenProject}
        onDeleteProject={(e, project) => {
          void controller.handleDeleteProject(e, project)
        }}
      />

      <DashboardStats
        projectCount={controller.stats.projectCount}
        totalEpisodes={controller.stats.totalEpisodes}
      />
    </div>
  )
}
