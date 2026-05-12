import type { ProjectEntryStage, ProjectWorkflowMode } from '@shared/types'
import type { EntryOption, WizardStep } from './dashboard-page-view'

interface Props {
  show: boolean
  wizardStep: WizardStep
  setWizardStep: (step: WizardStep) => void
  newName: string
  setNewName: (value: string) => void
  newDir: string
  newStyle: string
  setNewStyle: (value: string) => void
  newMedium: string
  setNewMedium: (value: string) => void
  newEpisodes: number
  setNewEpisodes: (value: number) => void
  sourceNovelFilePath: string
  entryStage: ProjectEntryStage
  workflowMode: ProjectWorkflowMode
  selectedOption: EntryOption
  entryOptions: EntryOption[]
  visualStyles: string[]
  targetMediums: string[]
  onCancel: () => void
  onSelectDir: () => void
  onSelectSourceNovelFile: () => void
  onChooseEntry: (option: EntryOption) => void
  onCreateProject: () => void
}

export default function NewProjectWizard(props: Props) {
  const {
    show,
    wizardStep,
    setWizardStep,
    newName,
    setNewName,
    newDir,
    newStyle,
    setNewStyle,
    newMedium,
    setNewMedium,
    newEpisodes,
    setNewEpisodes,
    sourceNovelFilePath,
    entryStage,
    selectedOption,
    entryOptions,
    visualStyles,
    targetMediums,
    onCancel,
    onSelectDir,
    onSelectSourceNovelFile,
    onChooseEntry,
    onCreateProject
  } = props

  if (!show) return null

  return (
    <div className="card new-project-dialog">
      <div className="wizard-header">
        <div>
          <h3>✨ 新建项目</h3>
          <p className="text-secondary wizard-subtitle">
            先选择你的起始阶段，再补充项目信息和目录。
          </p>
        </div>
        <div className="wizard-steps">
          {[1, 2, 3].map((step) => (
            <div
              key={step}
              className={`wizard-step-chip ${wizardStep === step ? 'active' : wizardStep > step ? 'done' : ''}`}
            >
              <span className="wizard-step-index">{step}</span>
              <span className="wizard-step-label">
                {step === 1 ? '入口' : step === 2 ? '信息' : '确认'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {wizardStep === 1 && (
        <div className="wizard-stage-select">
          {entryOptions.map((option) => (
            <button
              key={option.entryStage}
              className={`wizard-entry-card ${entryStage === option.entryStage ? 'active' : ''}`}
              onClick={() => onChooseEntry(option)}
            >
              <div className="wizard-entry-top">
                <div>
                  <div className="wizard-entry-title">{option.title}</div>
                  <div className="wizard-entry-subtitle text-secondary">
                    {option.subtitle}
                  </div>
                </div>
                <span className="wizard-entry-badge">{option.badge}</span>
              </div>
              <div className="wizard-entry-dirs">
                {option.directories.map((dir) => (
                  <span key={dir} className="wizard-dir-chip">
                    {dir}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}

      {wizardStep === 2 && (
        <>
          <div className="wizard-selected-entry">
            <span className="wizard-selected-label">当前入口</span>
            <strong>{selectedOption.title}</strong>
            <span className="text-secondary">{selectedOption.subtitle}</span>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label>项目名称</label>
              <input
                className="input"
                placeholder="输入项目名称"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>项目目录</label>
              <div className="dir-select">
                <input
                  className="input"
                  placeholder="选择项目目录"
                  value={newDir}
                  readOnly
                />
                <button className="btn btn-sm" onClick={onSelectDir}>
                  📂 选择
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>视觉风格</label>
              <input
                className="input"
                list="style-options"
                placeholder="选择或输入自定义风格"
                value={newStyle}
                onChange={(e) => setNewStyle(e.target.value)}
              />
              <datalist id="style-options">
                {visualStyles.map((style) => (
                  <option key={style} value={style} />
                ))}
              </datalist>
            </div>
            <div className="form-group">
              <label>目标媒介</label>
              <input
                className="input"
                list="medium-options"
                placeholder="选择或输入自定义媒介"
                value={newMedium}
                onChange={(e) => setNewMedium(e.target.value)}
              />
              <datalist id="medium-options">
                {targetMediums.map((medium) => (
                  <option key={medium} value={medium} />
                ))}
              </datalist>
            </div>
            <div className="form-group">
              <label>总集数</label>
              <input
                className="input"
                type="number"
                min={0}
                placeholder="0 表示自动检测"
                value={newEpisodes || ''}
                onChange={(e) => setNewEpisodes(parseInt(e.target.value) || 0)}
              />
            </div>
            {entryStage === 'novel' && (
              <div className="form-group form-group-wide">
                <label>整本小说文件</label>
                <div className="dir-select">
                  <input
                    className="input"
                    placeholder="可选：选择 .txt / .md 整本小说，创建时自动拆分章节"
                    value={sourceNovelFilePath}
                    readOnly
                  />
                  <button className="btn btn-sm" onClick={onSelectSourceNovelFile}>
                    📄 选择
                  </button>
                </div>
                <p className="wizard-field-hint text-secondary">
                  支持第1章、第001回、卷/部、Chapter 等常见章节分隔符；会写入 source/novel.md，并拆分到 source/chapters/。
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {wizardStep === 3 && (
        <div className="wizard-review">
          <div className="wizard-review-card">
            <div className="wizard-review-title">工作流入口</div>
            <div className="wizard-review-value">{selectedOption.title}</div>
            <div className="text-secondary">{selectedOption.subtitle}</div>
          </div>
          <div className="wizard-review-grid">
            <div className="wizard-review-item">
              <span className="text-secondary">项目名称</span>
              <strong>{newName || '未填写'}</strong>
            </div>
            <div className="wizard-review-item">
              <span className="text-secondary">项目目录</span>
              <strong>{newDir || '未选择'}</strong>
            </div>
            <div className="wizard-review-item">
              <span className="text-secondary">视觉风格</span>
              <strong>{newStyle || '未设定'}</strong>
            </div>
            <div className="wizard-review-item">
              <span className="text-secondary">目标媒介</span>
              <strong>{newMedium || '未设定'}</strong>
            </div>
            <div className="wizard-review-item">
              <span className="text-secondary">总集数</span>
              <strong>{newEpisodes || '自动检测'}</strong>
            </div>
            {entryStage === 'novel' && (
              <div className="wizard-review-item">
                <span className="text-secondary">整本小说</span>
                <strong>
                  {sourceNovelFilePath
                    ? sourceNovelFilePath.split(/[\\/]/).pop()
                    : '未选择'}
                </strong>
              </div>
            )}
          </div>
          <div className="wizard-dir-preview">
            <div className="wizard-review-title">将初始化的标准目录</div>
            <div className="wizard-entry-dirs">
              {selectedOption.directories.map((dir) => (
                <span key={dir} className="wizard-dir-chip">
                  {dir}
                </span>
              ))}
              <span className="wizard-dir-chip">exports/</span>
            </div>
          </div>
        </div>
      )}

      <div className="form-actions">
        <button className="btn" onClick={onCancel}>
          取消
        </button>
        {wizardStep > 1 && (
          <button
            className="btn"
            onClick={() => setWizardStep((wizardStep - 1) as WizardStep)}
          >
            上一步
          </button>
        )}
        {wizardStep < 3 ? (
          <button
            className="btn btn-primary"
            onClick={() => setWizardStep((wizardStep + 1) as WizardStep)}
            disabled={wizardStep === 2 && (!newName || !newDir)}
          >
            下一步
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={onCreateProject}
            disabled={!newName || !newDir}
          >
            创建项目
          </button>
        )}
      </div>
    </div>
  )
}
