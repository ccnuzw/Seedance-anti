import type {
  LLMProviderType,
  OpenAIImageBackground,
  OpenAIImageOutputFormat,
  OpenAIImageQuality,
  OpenAIImageSize,
  OpenAIReasoningEffort,
  OpenAIWireApi
} from '@shared/types'
import type { LLMModelInfo } from '@shared/ipc-contracts'
import {
  canFetchModelList,
  canSaveConfig,
  canTestConnection,
  isOpenAIProvider
} from '@renderer/settings/llm-settings-helpers'
import type {
  LLMFormState,
  ProviderOption
} from '@renderer/settings/llm-config'

interface Props {
  showForm: boolean
  editingId: string | null
  testing: boolean
  testResult: { success: boolean; message: string } | null
  fetchingModels: boolean
  availableModels: LLMModelInfo[]
  hasStoredApiKey: boolean
  maskedApiKey?: string
  form: LLMFormState
  providerOptions: ProviderOption[]
  onFormChange: (next: LLMFormState) => void
  onProviderChange: (provider: LLMProviderType) => void
  onFetchModels: () => void
  onTestConnection: () => void
  onSave: () => void
}

export function LLMConfigForm(props: Props) {
  const {
    showForm,
    editingId,
    testing,
    testResult,
    fetchingModels,
    availableModels,
    hasStoredApiKey,
    maskedApiKey,
    form,
    providerOptions,
    onFormChange,
    onProviderChange,
    onFetchModels,
    onTestConnection,
    onSave
  } = props

  if (!showForm) return null

  const canFetch = canFetchModelList({
    apiKey: form.apiKey,
    editingId,
    hasStoredApiKey,
    baseUrl: form.baseUrl,
    fetchingModels
  })
  const canTest = canTestConnection({
    apiKey: form.apiKey,
    editingId,
    hasStoredApiKey,
    model: form.model,
    testing
  })
  const canSave = canSaveConfig({
    name: form.name,
    apiKey: form.apiKey,
    editingId,
    hasStoredApiKey,
    model: form.model
  })

  return (
    <div className="card config-form">
      <div className="form-grid">
        <div className="form-group">
          <label>配置名称</label>
          <input
            className="input"
            placeholder="e.g. GPT-5 代理"
            value={form.name}
            onChange={(e) => onFormChange({ ...form, name: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label>Provider 类型</label>
          <select
            className="input"
            value={form.provider}
            onChange={(e) =>
              onProviderChange(e.target.value as LLMProviderType)
            }
          >
            {providerOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {form.category === 'llm' && isOpenAIProvider(form.provider) && (
          <div className="form-group">
            <label>Wire API</label>
            <select
              className="input"
              value={form.wireApi}
              onChange={(e) =>
                onFormChange({
                  ...form,
                  wireApi: e.target.value as OpenAIWireApi
                })
              }
            >
              <option value="responses">responses</option>
              <option value="chat-completions">chat/completions</option>
            </select>
          </div>
        )}
        {form.category === 'llm' &&
          isOpenAIProvider(form.provider) &&
          form.wireApi === 'responses' && (
            <div className="form-group">
              <label>Reasoning Effort</label>
              <select
                className="input"
                value={form.reasoningEffort}
                onChange={(e) =>
                  onFormChange({
                    ...form,
                    reasoningEffort: e.target.value as OpenAIReasoningEffort
                  })
                }
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="xhigh">xhigh</option>
              </select>
            </div>
          )}
        {form.category === 'image' && isOpenAIProvider(form.provider) && (
          <>
            <div className="form-group full-width">
              <label>图片接口</label>
              <div className="text-secondary">
                当前图片 Provider 会使用固定端点
                `/v1/images/generations`。这里保存的是默认参数，实际调用时可以覆盖。
              </div>
            </div>
            <div className="form-group">
              <label>默认尺寸</label>
              <select
                className="input"
                value={form.imageSize}
                onChange={(e) =>
                  onFormChange({
                    ...form,
                    imageSize: e.target.value as OpenAIImageSize
                  })
                }
              >
                <option value="1024x1024">1024x1024</option>
                <option value="1024x1536">1024x1536</option>
                <option value="1536x1024">1536x1024</option>
                <option value="auto">auto</option>
              </select>
            </div>
            <div className="form-group">
              <label>默认质量</label>
              <select
                className="input"
                value={form.imageQuality}
                onChange={(e) =>
                  onFormChange({
                    ...form,
                    imageQuality: e.target.value as OpenAIImageQuality
                  })
                }
              >
                <option value="auto">auto</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>
            <div className="form-group">
              <label>默认输出格式</label>
              <select
                className="input"
                value={form.imageOutputFormat}
                onChange={(e) =>
                  onFormChange({
                    ...form,
                    imageOutputFormat: e.target.value as OpenAIImageOutputFormat
                  })
                }
              >
                <option value="png">png</option>
                <option value="jpeg">jpeg</option>
                <option value="webp">webp</option>
              </select>
            </div>
            <div className="form-group">
              <label>默认背景</label>
              <select
                className="input"
                value={form.imageBackground}
                onChange={(e) =>
                  onFormChange({
                    ...form,
                    imageBackground: e.target.value as OpenAIImageBackground
                  })
                }
              >
                <option value="auto">auto</option>
                <option value="transparent">transparent</option>
                <option value="opaque">opaque</option>
              </select>
            </div>
          </>
        )}
        <div className="form-group full-width">
          <label>
            Base URL{' '}
            <span className="text-secondary">(代理需要以 /v1 结尾)</span>
          </label>
          <input
            className="input"
            value={form.baseUrl}
            onChange={(e) => onFormChange({ ...form, baseUrl: e.target.value })}
          />
        </div>
        <div className="form-group full-width">
          <label>API Key</label>
          {hasStoredApiKey && editingId && (
            <div className="text-secondary">
              已保存密钥 {maskedApiKey || '••••'}。留空则继续使用已保存密钥。
            </div>
          )}
          <input
            className="input"
            type="password"
            placeholder={
              hasStoredApiKey && editingId ? '留空则保留当前密钥' : 'sk-...'
            }
            value={form.apiKey}
            onChange={(e) => onFormChange({ ...form, apiKey: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label>模型名称</label>
          {availableModels.length > 0 ? (
            <select
              className="input"
              value={form.model}
              onChange={(e) => onFormChange({ ...form, model: e.target.value })}
            >
              <option value="">-- 选择模型 --</option>
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                  {model.owner ? ` (${model.owner})` : ''}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              placeholder={
                form.category === 'image'
                  ? 'e.g. gpt-image-2'
                  : 'e.g. gpt-5 或 claude-sonnet-4-20250514'
              }
              value={form.model}
              onChange={(e) => onFormChange({ ...form, model: e.target.value })}
            />
          )}
        </div>
        <div className="form-group">
          <label>&nbsp;</label>
          <button
            className="btn btn-sm"
            onClick={onFetchModels}
            disabled={!canFetch}
          >
            {fetchingModels ? '⏳ 获取中...' : '📋 获取模型列表'}
          </button>
        </div>
      </div>

      {availableModels.length > 0 && (
        <div className="model-list-preview">
          <div className="model-list-title text-secondary">
            可用模型 ({availableModels.length})
          </div>
          <div className="model-chips">
            {availableModels.map((model) => (
              <span
                key={model.id}
                className={`model-chip ${form.model === model.id ? 'selected' : ''}`}
                onClick={() => onFormChange({ ...form, model: model.id })}
              >
                {model.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="form-actions">
        <button className="btn" onClick={onTestConnection} disabled={!canTest}>
          {testing ? '⏳ 测试中...' : '🔌 测试连接'}
        </button>
        {testResult && (
          <span className={testResult.success ? 'text-success' : 'text-error'}>
            {testResult.message}
          </span>
        )}
        <button
          className="btn btn-primary"
          onClick={onSave}
          disabled={!canSave}
        >
          💾 保存
        </button>
      </div>
    </div>
  )
}
