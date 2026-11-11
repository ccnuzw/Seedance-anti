import {
  PIPELINE_SETTING_FIELDS,
  PIPELINE_SETTING_KEYS
} from '@shared/pipeline-settings'
import {
  validatePipelineSettingsDraft,
  type PipelineSettingsDraft
} from './pipeline-settings-draft'

interface ProjectSettingsDraft {
  name: string
  visualStyle: string
  targetMedium: string
  totalEpisodes: number
  chaptersPerEpisode: number
}

interface Props {
  entryLabel: string
  showSettings: boolean
  setShowSettings: (value: boolean) => void
  setPsLoaded: (value: boolean) => void
  ps: PipelineSettingsDraft
  setPs: (value: PipelineSettingsDraft) => void
  projectDraft: ProjectSettingsDraft
  setProjectDraft: (value: ProjectSettingsDraft) => void
  visualStyles: readonly string[]
  targetMediums: readonly string[]
  psSaving: boolean
  onReset: () => void
  onSave: () => void
}

export default function ProjectPipelineSettingsPanel(props: Props) {
  const {
    entryLabel,
    showSettings,
    setShowSettings,
    setPsLoaded,
    ps,
    setPs,
    projectDraft,
    setProjectDraft,
    visualStyles,
    targetMediums,
    psSaving,
    onReset,
    onSave
  } = props

  const validation = validatePipelineSettingsDraft(ps)

  return (
    <>
      <div
        className="card pipeline-settings-panel"
        style={{ marginBottom: 'var(--spacing-md)' }}
      >
        <div className="pipeline-settings-header">
          <h3>🧭 工作流说明</h3>
          <span
            className="text-secondary"
            style={{ fontSize: 'var(--font-size-xs)' }}
          >
            当前项目入口：{entryLabel}
          </span>
        </div>
        <div className="text-secondary" style={{ lineHeight: 1.7 }}>
          FEICAI Studio 当前标准流程为：小说 / 剧情 / 剧本 / 剧本审核 / 导演 /
          角色 / 服化道 / 分镜 / 分镜审核。 现在桌面端已经提供了
          `小说原文`、`剧情拆解`、`剧本`
          三个编辑入口；项目也支持直接从剧本起步，如果你已经有剧本，可以跳过小说和剧情阶段，直接从剧本审核往后执行。当前自动执行段仍负责导演、服化道、分镜三段，启动前请先补齐剧本审核文件。
        </div>
      </div>

      <div
        className="project-actions-inline"
        style={{ marginBottom: 'var(--spacing-md)' }}
      >
        <button
          className={`btn ${showSettings ? 'btn-active' : ''}`}
          onClick={() => {
            setShowSettings(!showSettings)
            setPsLoaded(false)
          }}
        >
          ⚙️ 设置
        </button>
      </div>

      {showSettings && (
        <div className="card pipeline-settings-panel">
          <div className="pipeline-settings-header">
            <h3>⚙️ 项目设置</h3>
            <span
              className="text-secondary"
              style={{ fontSize: 'var(--font-size-xs)' }}
            >
              调整后需点击「保存」生效，设置将写入 project-config.json
            </span>
          </div>
          <div className="project-settings-section">
            <div className="project-settings-section-title">
              <span>基础信息</span>
              <span className="text-secondary">
                影响项目头、侧边栏与后续生成上下文
              </span>
            </div>
            <div className="pipeline-settings-grid project-settings-grid">
              <div className="ps-item">
                <label>项目名称</label>
                <span className="ps-desc text-secondary">
                  用于项目列表、导出文件和生成上下文
                </span>
                <input
                  className="input input-sm"
                  value={projectDraft.name}
                  onChange={(e) =>
                    setProjectDraft({
                      ...projectDraft,
                      name: e.target.value
                    })
                  }
                />
              </div>
              <div className="ps-item">
                <label>视觉风格</label>
                <span className="ps-desc text-secondary">
                  会进入导演、服化道与分镜提示词
                </span>
                <input
                  className="input input-sm"
                  list="project-style-options"
                  value={projectDraft.visualStyle}
                  onChange={(e) =>
                    setProjectDraft({
                      ...projectDraft,
                      visualStyle: e.target.value
                    })
                  }
                />
                <datalist id="project-style-options">
                  {visualStyles.map((style) => (
                    <option key={style} value={style} />
                  ))}
                </datalist>
              </div>
              <div className="ps-item">
                <label>目标媒介</label>
                <span className="ps-desc text-secondary">
                  会影响输出格式、镜头密度与叙事节奏
                </span>
                <input
                  className="input input-sm"
                  list="project-medium-options"
                  value={projectDraft.targetMedium}
                  onChange={(e) =>
                    setProjectDraft({
                      ...projectDraft,
                      targetMedium: e.target.value
                    })
                  }
                />
                <datalist id="project-medium-options">
                  {targetMediums.map((medium) => (
                    <option key={medium} value={medium} />
                  ))}
                </datalist>
              </div>
              <div className="ps-item">
                <label>总集数</label>
                <span className="ps-desc text-secondary">
                  用于项目进度和缺失集数检测，0 表示自动检测
                </span>
                <input
                  type="number"
                  className="input input-sm"
                  min={0}
                  value={projectDraft.totalEpisodes || ''}
                  onChange={(e) =>
                    setProjectDraft({
                      ...projectDraft,
                      totalEpisodes: Number(e.target.value) || 0
                    })
                  }
                />
              </div>
              <div className="ps-item">
                <label>每集章节数</label>
                <span className="ps-desc text-secondary">
                  剧情拆解时 EP01 读取第 1-N 章，0 表示读取整本原文
                </span>
                <input
                  type="number"
                  className="input input-sm"
                  min={0}
                  value={projectDraft.chaptersPerEpisode || ''}
                  onChange={(e) =>
                    setProjectDraft({
                      ...projectDraft,
                      chaptersPerEpisode: Number(e.target.value) || 0
                    })
                  }
                />
              </div>
            </div>
          </div>
          <div className="project-settings-section">
            <div className="project-settings-section-title">
              <span>流水线参数</span>
              <span className="text-secondary">
                影响审核、超时与提示词时长约束
              </span>
            </div>
            <div className="pipeline-settings-grid">
              {PIPELINE_SETTING_KEYS.map((key) => {
                const field = PIPELINE_SETTING_FIELDS[key]
                const error = validation.issues.find(
                  (issue) => issue.field === key
                )
                return (
                  <div className="ps-item" key={key}>
                    <label htmlFor={`pipeline-${key}`}>
                      {field.label}（{field.unit}）
                    </label>
                    <span
                      id={`pipeline-${key}-hint`}
                      className="ps-desc text-secondary"
                    >
                      {field.description}；默认 {field.defaultValue}{' '}
                      {field.unit}
                    </span>
                    <input
                      id={`pipeline-${key}`}
                      type="text"
                      inputMode={field.integer ? 'numeric' : 'decimal'}
                      className="input input-sm"
                      value={ps[key]}
                      aria-invalid={!!error}
                      aria-describedby={`pipeline-${key}-hint${error ? ` pipeline-${key}-error` : ''}`}
                      onChange={(e) => setPs({ ...ps, [key]: e.target.value })}
                    />
                    {error && (
                      <span id={`pipeline-${key}-error`} role="alert">
                        {error.message}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            {validation.issues
              .filter((issue) => issue.field === '_config')
              .map((issue) => (
                <p role="alert" key={issue.message}>
                  {issue.message}
                  。请修复配置文件中的结构或类型错误；恢复默认值需保存后生效。
                </p>
              ))}
          </div>
          <div className="pipeline-settings-actions">
            <button className="btn btn-sm" onClick={onReset}>
              🔄 恢复流水线默认值
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={onSave}
              disabled={psSaving || validation.issues.length > 0}
            >
              {psSaving ? '⏳ 保存中...' : '💾 保存'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
