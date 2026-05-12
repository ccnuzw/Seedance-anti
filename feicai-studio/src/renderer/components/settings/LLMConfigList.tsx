import type { LLMConfig } from '@shared/types'
import type { LLMConfigManager } from '@renderer/hooks/useLLMConfigManager'
import {
  DEFAULT_IMAGE_BACKGROUND,
  DEFAULT_IMAGE_OUTPUT_FORMAT,
  DEFAULT_IMAGE_QUALITY,
  DEFAULT_IMAGE_SIZE
} from '@renderer/settings/llm-config'
import { formatImageConfigSummary } from '@renderer/settings/llm-settings-helpers'

interface Props {
  activeTabLabel: string
  showForm: boolean
  filteredConfigs: LLMConfig[]
  cardTestResult: LLMConfigManager['cardTestResult']
  testingCardId: string | null
  onCardTest: (config: LLMConfig) => void
  onEdit: (config: LLMConfig) => void
  onSetDefault: (id: string) => void
  onDelete: (id: string) => void
}

export function LLMConfigList(props: Props) {
  const {
    activeTabLabel,
    showForm,
    filteredConfigs,
    cardTestResult,
    testingCardId,
    onCardTest,
    onEdit,
    onSetDefault,
    onDelete
  } = props

  return (
    <div className="config-list">
      {filteredConfigs.length === 0 && !showForm ? (
        <div className="config-empty text-secondary">
          尚未配置{activeTabLabel}模型。点击「添加模型」开始配置。
        </div>
      ) : (
        filteredConfigs.map((config) => (
          <div
            key={config.id}
            className={`card config-item ${config.isDefault ? 'config-item--default' : ''}`}
          >
            <div className="config-info">
              <div className="config-name">
                {config.name}
                {config.isDefault && (
                  <span className="badge badge-info">默认</span>
                )}
              </div>
              <div className="config-meta text-secondary">
                {config.provider} · {config.model}
              </div>
              {config.category === 'image' && (
                <div className="config-meta text-secondary">
                  {formatImageConfigSummary(config, {
                    imageSize: DEFAULT_IMAGE_SIZE,
                    imageQuality: DEFAULT_IMAGE_QUALITY,
                    imageOutputFormat: DEFAULT_IMAGE_OUTPUT_FORMAT,
                    imageBackground: DEFAULT_IMAGE_BACKGROUND
                  })}
                </div>
              )}
              {cardTestResult[config.id] && (
                <div
                  className={`config-test-result ${cardTestResult[config.id].success ? 'text-success' : 'text-error'}`}
                >
                  {cardTestResult[config.id].success ? '✅' : '❌'}{' '}
                  {cardTestResult[config.id].message}
                </div>
              )}
            </div>
            <div className="config-actions">
              <button
                className="btn btn-sm"
                onClick={() => onCardTest(config)}
                disabled={testingCardId === config.id}
              >
                {testingCardId === config.id ? '⏳ 测试中...' : '🔌 测试'}
              </button>
              <button className="btn btn-sm" onClick={() => onEdit(config)}>
                ✏️ 编辑
              </button>
              {!config.isDefault && (
                <button
                  className="btn btn-sm"
                  onClick={() => onSetDefault(config.id)}
                >
                  设为默认
                </button>
              )}
              <button
                className="btn btn-sm btn-danger"
                onClick={() => onDelete(config.id)}
              >
                删除
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
