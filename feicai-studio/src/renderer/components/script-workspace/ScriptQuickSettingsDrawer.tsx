import { useEffect, useMemo, useState } from 'react'
import type { PipelineBatchMode, QAMode } from '@shared/types'
import {
  DEFAULT_PIPELINE_SETTINGS,
  DEFAULT_PROJECT_TASK_DEFAULTS,
  DEFAULT_REVIEW_POLICY
} from '@shared/types'
import type { Project } from '@shared/types'

interface ScriptQuickSettingsDrawerProps {
  project: Project
  open: boolean
  saving: boolean
  onClose: () => void
  onSave: (payload: {
    reviewPolicy: {
      qaMode: QAMode
      adaptScriptPassScore: number
      scriptAutoRepairRounds: number
    }
    taskDefaults: {
      defaultBatchMode: PipelineBatchMode
      defaultMaxAutoRetries: number
    }
  }) => Promise<void>
}

export default function ScriptQuickSettingsDrawer({
  project,
  open,
  saving,
  onClose,
  onSave
}: ScriptQuickSettingsDrawerProps) {
  const baseReviewPolicy = useMemo(
    () => ({ ...DEFAULT_REVIEW_POLICY, ...(project.config.reviewPolicy || {}) }),
    [project.config.reviewPolicy]
  )
  const basePipelineSettings = useMemo(
    () => ({ ...DEFAULT_PIPELINE_SETTINGS, ...(project.config.pipelineSettings || {}) }),
    [project.config.pipelineSettings]
  )
  const baseTaskDefaults = useMemo(
    () => ({ ...DEFAULT_PROJECT_TASK_DEFAULTS, ...(project.config.taskDefaults || {}) }),
    [project.config.taskDefaults]
  )

  const [qaMode, setQaMode] = useState<QAMode>('strict')
  const [scriptPassScore, setScriptPassScore] = useState(7)
  const [scriptAutoRepairRounds, setScriptAutoRepairRounds] = useState(0)
  const [defaultBatchMode, setDefaultBatchMode] = useState<PipelineBatchMode>('independent')
  const [defaultMaxAutoRetries, setDefaultMaxAutoRetries] = useState(1)

  useEffect(() => {
    if (!open) return
    setQaMode(baseReviewPolicy.qaMode)
    setScriptPassScore(baseReviewPolicy.adaptScriptPassScore ?? basePipelineSettings.passScore)
    setScriptAutoRepairRounds(baseReviewPolicy.scriptAutoRepairRounds ?? 0)
    setDefaultBatchMode(baseTaskDefaults.defaultBatchMode)
    setDefaultMaxAutoRetries(baseTaskDefaults.defaultMaxAutoRetries)
  }, [basePipelineSettings.passScore, baseReviewPolicy, baseTaskDefaults, open])

  if (!open) return null

  const handleSubmit = async () => {
    await onSave({
      reviewPolicy: {
        qaMode,
        adaptScriptPassScore: Math.min(Math.max(scriptPassScore, 1), 10),
        scriptAutoRepairRounds: Math.min(Math.max(scriptAutoRepairRounds, 0), 5)
      },
      taskDefaults: {
        defaultBatchMode,
        defaultMaxAutoRetries: Math.min(Math.max(defaultMaxAutoRetries, 0), 5)
      }
    })
  }

  return (
    <div className="script-quick-drawer-backdrop" onClick={onClose}>
      <div className="script-quick-drawer card" onClick={(event) => event.stopPropagation()}>
        <div className="as-section-head">
          <div className="as-focus-copy">
            <h3>写作快速设置</h3>
            <p className="text-secondary">只调整当前写作节奏最常用的参数，复杂编排仍可去项目设置页处理。</p>
          </div>
          <button className="btn btn-sm" onClick={onClose}>关闭</button>
        </div>

        <div className="script-quick-drawer-grid">
          <label className="script-quick-field">
            <span>QA 模式</span>
            <select className="input" value={qaMode} onChange={(event) => setQaMode(event.target.value as QAMode)}>
              <option value="strict">严格门禁</option>
              <option value="lenient">宽松推进</option>
              <option value="report_only">报告优先</option>
            </select>
          </label>

          <label className="script-quick-field">
            <span>剧本通过线</span>
            <input
              className="input"
              type="number"
              min={1}
              max={10}
              value={scriptPassScore}
              onChange={(event) => setScriptPassScore(Number.parseInt(event.target.value || '7', 10))}
            />
          </label>

          <label className="script-quick-field">
            <span>自动修订轮次</span>
            <input
              className="input"
              type="number"
              min={0}
              max={5}
              value={scriptAutoRepairRounds}
              onChange={(event) => setScriptAutoRepairRounds(Number.parseInt(event.target.value || '0', 10))}
            />
          </label>

          <label className="script-quick-field">
            <span>默认批量方式</span>
            <select className="input" value={defaultBatchMode} onChange={(event) => setDefaultBatchMode(event.target.value as PipelineBatchMode)}>
              <option value="independent">独立并行</option>
              <option value="sequential_on_success">成功后串行</option>
              <option value="sequential_always">始终串行</option>
            </select>
          </label>

          <label className="script-quick-field">
            <span>默认自动重试</span>
            <input
              className="input"
              type="number"
              min={0}
              max={5}
              value={defaultMaxAutoRetries}
              onChange={(event) => setDefaultMaxAutoRetries(Number.parseInt(event.target.value || '0', 10))}
            />
          </label>
        </div>

        <div className="script-quick-hint">
          <span className="action-guidance-chip">当前模式会立即影响左侧生成节奏和右侧问题面板口径</span>
          <span className="action-guidance-chip">更完整的模板、调度、导出默认仍在项目设置页</span>
        </div>

        <div className="script-quick-actions">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={saving} onClick={() => void handleSubmit()}>
            {saving ? '保存中...' : '保存并应用'}
          </button>
        </div>
      </div>
    </div>
  )
}
