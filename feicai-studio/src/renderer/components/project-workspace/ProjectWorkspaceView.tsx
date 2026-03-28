import type { useProjectWorkspace } from '@renderer/hooks/useProjectWorkspace'
import ProjectProgressPanel from './ProjectProgressPanel'

type ProjectWorkspaceState = ReturnType<typeof useProjectWorkspace>

interface ProjectWorkspaceViewProps {
  workspace: ProjectWorkspaceState
}

export default function ProjectWorkspaceView({ workspace }: ProjectWorkspaceViewProps) {
  const {
    currentProject,
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
    adaptRunning,
    adaptStateLabel,
    pipelineRunning,
    pipelineStateLabel,
    activePipelineEpisode,
    handleOpenPath,
    handleOpenTasks,
    handleOpenSettings
  } = workspace

  if (!currentProject) return null

  const workspaceGuidance = attentionItems[0]
    ? attentionItems[0].description
    : businessStatus.description
  const workspaceHighlights = [
    currentProject.phase === 'production' ? '当前处于制作 / 交付阶段' : '当前处于内容 / 写作阶段',
    currentProject.sourceType === 'novel' ? `内容准备覆盖 ${chapterCoverage}%` : '项目输入已稳定',
    `${scriptsCount}/${Math.max(totalEpisodes, 1)} 集已成稿`,
    promptReadyCount > 0 ? `${promptReadyCount} 集已有提示词产物` : '制作产物仍待形成'
  ]

  return (
    <div className="project-workspace-page section-page page-container page-wide">
      <div className="card project-workspace-header">
        <div className="project-workspace-copy">
          <h1>工作台</h1>
          <p className="text-secondary">
            统一回答这个项目现在做到哪、卡在哪里、下一步去哪做，把内容准备、剧本创作、画面制作和交付导出真正串成一条主流程。
          </p>
        </div>
        <div className="project-workspace-header-side">
          <span className={`status-chip tone-${businessStatus.tone}`}>
            {businessStatus.label}
          </span>
          <span className={`status-chip ${currentProject.phase === 'production' ? 'is-success' : ''}`}>
            {currentProject.phase === 'production' ? '制作阶段' : '写作阶段'}
          </span>
        </div>
      </div>

      <div className="project-workspace-hero">
        <div className="project-workspace-hero-main">
          <div className="card project-workspace-next">
            <div className="project-workspace-section-head">
              <h3>推荐下一步</h3>
              <span className={`status-chip tone-${businessStatus.tone}`}>{businessStatus.label}</span>
            </div>
            <div className="project-workspace-next-body">
              <strong>{nextAction.title}</strong>
              <p className="text-secondary">{nextAction.description}</p>
              <div className="project-workspace-actions">
                <button className="btn btn-primary" onClick={() => handleOpenPath(nextAction.primaryPath)}>
                  {nextAction.primaryLabel}
                </button>
                <button className="btn" onClick={() => handleOpenPath(nextAction.secondaryPath)}>
                  {nextAction.secondaryLabel}
                </button>
                <button className="btn" onClick={handleOpenSettings}>
                  项目设置
                </button>
                <button className="btn" onClick={handleOpenTasks}>
                  任务中心
                </button>
              </div>
            </div>
          </div>

          <div className={`card action-guidance tone-${businessStatus.tone}`}>
            <div className="project-workspace-section-head">
              <h3>动作提示</h3>
              <span className="text-secondary text-xs">先看阻塞和准备度，再决定进入哪个工作区。</span>
            </div>
            <p className="text-secondary">{workspaceGuidance}</p>
            <div className="action-guidance-list">
              {workspaceHighlights.map((item) => (
                <span key={item} className="action-guidance-chip">{item}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="project-workspace-hero-side">
          <div className="card project-workspace-health">
            <div className="project-workspace-section-head">
              <h3>当前状态</h3>
              <span className="text-secondary text-xs">先看业务状态，再看底层运行。</span>
            </div>
            <div className="project-workspace-health-list">
              <div className="project-workspace-health-item">
                <span className="project-workspace-label">项目阶段</span>
                <strong>{currentProject.phase === 'production' ? '画面制作 / 交付阶段' : '内容准备 / 剧本创作阶段'}</strong>
              </div>
              <div className="project-workspace-health-item">
                <span className="project-workspace-label">编剧状态</span>
                <strong>{adaptRunning ? adaptStateLabel : (currentProject.sourceType === 'novel' ? adaptStateLabel : '按页推进')}</strong>
              </div>
              <div className="project-workspace-health-item">
                <span className="project-workspace-label">制作状态</span>
                <strong>
                  {pipelineRunning
                    ? `${pipelineStateLabel}${activePipelineEpisode ? ` · EP${String(activePipelineEpisode).padStart(3, '0')}` : ''}`
                    : currentProject.phase === 'production'
                      ? pipelineStateLabel
                      : '尚未进入制作阶段'}
                </strong>
              </div>
              <div className="project-workspace-health-item">
                <span className="project-workspace-label">项目结论</span>
                <strong>{businessStatus.description}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="project-workspace-summary-grid">
        <div className="card project-workspace-summary-card">
          <span className="project-workspace-label">总集数</span>
          <strong>{totalEpisodes || '—'}</strong>
        </div>
        <div className="card project-workspace-summary-card">
          <span className="project-workspace-label">剧本成稿</span>
          <strong>{scriptsCount}</strong>
          <span className="text-secondary text-xs">{scriptCoverage}% 覆盖</span>
        </div>
        <div className="card project-workspace-summary-card">
          <span className="project-workspace-label">提示词完成</span>
          <strong>{promptReadyCount}</strong>
          <span className="text-secondary text-xs">{promptCoverage}% 覆盖</span>
        </div>
        <div className="card project-workspace-summary-card">
          <span className="project-workspace-label">制作中</span>
          <strong>{inProductionCount}</strong>
          <span className="text-secondary text-xs">当前仍在导演 / 美术 / 分镜阶段</span>
        </div>
        <div className="card project-workspace-summary-card">
          <span className="project-workspace-label">已完成</span>
          <strong>{completedCount}</strong>
          <span className="text-secondary text-xs">完整走完制作流程的集数</span>
        </div>
        <div className="card project-workspace-summary-card">
          <span className="project-workspace-label">内容准备</span>
          <strong>{currentProject.sourceType === 'novel' ? `${chapterCoverage}%` : '已就绪'}</strong>
          <span className="text-secondary text-xs">
            {currentProject.sourceType === 'novel' ? '章节拆解 / 改编规划覆盖度' : '当前项目使用已有脚本或原创输入'}
          </span>
        </div>
      </div>

      <ProjectProgressPanel workspace={workspace} />

      <div className="card project-workspace-modules">
        <div className="project-workspace-section-head">
          <h3>主流程入口</h3>
          <span className="text-secondary text-xs">所有高频动作都应该从这里进入，而不是回到旧工具页里查找。</span>
        </div>
        <div className="project-workspace-module-grid">
          {modules.map((module) => (
            <div key={module.key} className={`project-workspace-module-card tone-${module.tone}`}>
              <div className="project-workspace-module-top">
                <strong>{module.title}</strong>
                <span className={`status-chip tone-${module.tone}`}>{module.stateLabel}</span>
              </div>
              <p className="text-secondary">{module.description}</p>
              <span className="project-workspace-module-hint">{module.hint}</span>
              <button className="btn btn-sm" onClick={() => handleOpenPath(module.path)}>
                {module.actionLabel}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="project-workspace-lower">
        <div className="card project-workspace-attention">
          <div className="project-workspace-section-head">
            <h3>待关注事项</h3>
            <span className="text-secondary text-xs">先处理真正影响下一步的事项，而不是被工具层状态分散注意力。</span>
          </div>
          <div className="project-workspace-attention-list">
            {attentionItems.map((item) => (
              <button
                key={item.title}
                className={`project-workspace-attention-item tone-${item.tone}`}
                onClick={() => handleOpenPath(item.path)}
              >
                <strong>{item.title}</strong>
                <span className="text-secondary">{item.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card project-workspace-routing">
          <div className="project-workspace-section-head">
            <h3>流程闭环</h3>
            <span className="text-secondary text-xs">把项目真正收进一条连续路径里。</span>
          </div>
          <div className="project-workspace-route-list">
            {['内容准备', '剧本创作', '画面制作', '交付导出'].map((label, index) => (
              <div key={label} className="project-workspace-route-item">
                <span className="project-workspace-route-index">{index + 1}</span>
                <div>
                  <strong>{label}</strong>
                  <p className="text-secondary">
                    {label === '内容准备' && '围绕源稿输入和改编规划建立稳定起点。'}
                    {label === '剧本创作' && '集中处理生成、编辑、修订和问题闭环。'}
                    {label === '画面制作' && '围绕当前集推进制作流程、提示词和审核。'}
                    {label === '交付导出' && '统一收口阶段切换、导出与最终诊断。'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
