import { useState, useEffect, useRef } from 'react'
import { IPC } from '@shared/ipc-channels'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import type { ThemeMode, ZoomLevel, SidebarWidth } from '@renderer/stores/settingsStore'
import { platformAPI } from '@renderer/platform/api'
import {
  getWebTransportConfig,
  probeWebTransportConfig,
  resetWebTransportConfig,
  saveWebTransportConfig,
  type WebTransportMode
} from '@renderer/platform/webTransport'
import { useToastStore } from '@renderer/stores/toastStore'
import type { AppDeliveryStatus, LLMConfig, LLMProviderType, ModelCategory } from '@shared/types'
import './SettingsPage.css'

const PROVIDER_OPTIONS: { value: LLMProviderType; label: string }[] = [
  { value: 'openai-compatible', label: 'OpenAI 兼容 (推荐 - 支持代理)' },
  { value: 'openai', label: 'OpenAI 官方' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'anthropic', label: 'Anthropic Claude' },
]

const DEFAULT_URLS: Record<LLMProviderType, string> = {
  google: 'https://generativelanguage.googleapis.com',
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  'openai-compatible': 'https://sub2api.526566.xyz/v1'
}

interface ModelInfo {
  id: string
  name: string
  owner: string
}

const THEME_OPTIONS: { value: ThemeMode; label: string; emoji: string }[] = [
  { value: 'dark', label: '暗色', emoji: '🌙' },
  { value: 'light', label: '亮色', emoji: '☀️' },
  { value: 'system', label: '跟随系统', emoji: '💻' }
]

const ZOOM_OPTIONS: { value: ZoomLevel; label: string }[] = [
  { value: '80', label: '80%' },
  { value: '90', label: '90%' },
  { value: '100', label: '100%' },
  { value: '110', label: '110%' },
  { value: '120', label: '120%' }
]

const SIDEBAR_OPTIONS: { value: SidebarWidth; label: string }[] = [
  { value: 'compact', label: '紧凑' },
  { value: 'standard', label: '标准' },
  { value: 'wide', label: '宽松' }
]

const CATEGORY_TABS: { value: ModelCategory; label: string; emoji: string; desc: string; color: string }[] = [
  { value: 'llm', label: 'LLM 文本', emoji: '🤖', desc: '剧本 · 导演 · 分镜 · 服化道', color: 'accent' },
  { value: 'image', label: '图像生成', emoji: '🎨', desc: 'AI 生图模型', color: 'green' },
  { value: 'video', label: '视频生成', emoji: '🎬', desc: 'AI 生视频模型', color: 'purple' }
]

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function SettingsPage() {
  const { llmConfigs, loadLLMConfigs, addLLMConfig, deleteLLMConfig, setDefaultLLM, updateLLMConfig, appSettings, updateAppSettings, resetAppSettings } = useSettingsStore()
  const { addToast } = useToastStore()
  const [activeCategory, setActiveCategory] = useState<ModelCategory>('llm')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [testingCardId, setTestingCardId] = useState<string | null>(null)
  const [cardTestResult, setCardTestResult] = useState<Record<string, { success: boolean; message: string }>>({})
  const [fetchingModels, setFetchingModels] = useState(false)
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [appVersion, setAppVersion] = useState('0.1.0')
  const [deliveryStatus, setDeliveryStatus] = useState<AppDeliveryStatus | null>(null)
  const [exportingDeliveryReport, setExportingDeliveryReport] = useState(false)
  const [webTransportMode, setWebTransportMode] = useState<WebTransportMode>('browser-local')
  const [webTransportBaseUrl, setWebTransportBaseUrl] = useState('')
  const [webTransportInvokePath, setWebTransportInvokePath] = useState('/api/platform/invoke')
  const [webTransportEventsPath, setWebTransportEventsPath] = useState('/api/platform/events')
  const [testingTransport, setTestingTransport] = useState(false)
  const [transportTestMessage, setTransportTestMessage] = useState<string | null>(null)
  const fetchModelsTokenRef = useRef(0)
  const formTestTokenRef = useRef(0)
  const cardTestTokenRef = useRef(0)

  const [form, setForm] = useState({
    name: '',
    category: 'llm' as ModelCategory,
    provider: 'openai-compatible' as LLMProviderType,
    baseUrl: DEFAULT_URLS['openai-compatible'],
    apiKey: '',
    model: '',
    maxTokens: 8192,
    temperature: 0.7,
    isDefault: true
  })

  const resetFormAsyncState = () => {
    fetchModelsTokenRef.current += 1
    formTestTokenRef.current += 1
    setFetchingModels(false)
    setTesting(false)
    setAvailableModels([])
    setTestResult(null)
  }

  useEffect(() => {
    let active = true
    const transportConfig = getWebTransportConfig()
    setWebTransportMode(transportConfig.mode)
    setWebTransportBaseUrl(transportConfig.baseUrl)
    setWebTransportInvokePath(transportConfig.invokePath)
    setWebTransportEventsPath(transportConfig.eventsPath)
    loadLLMConfigs().then((loaded) => {
      if (active && !loaded) {
        addToast('warning', '模型列表加载失败')
      }
    })
    platformAPI.invoke(IPC.APP_GET_VERSION)
      .then((version) => setAppVersion(String(version || '0.1.0')))
      .catch(() => setAppVersion('0.1.0'))
    platformAPI.invoke(IPC.APP_GET_DELIVERY_STATUS)
      .then((status) => {
        if (active) setDeliveryStatus(status as AppDeliveryStatus)
      })
      .catch(() => {
        if (active) setDeliveryStatus(null)
      })
    return () => {
      active = false
      resetFormAsyncState()
      cardTestTokenRef.current += 1
      setTestingCardId(null)
    }
  }, [loadLLMConfigs, addToast])

  const handleProviderChange = (provider: LLMProviderType) => {
    resetFormAsyncState()
    setForm({ ...form, provider, baseUrl: DEFAULT_URLS[provider] })
  }

  const handleFetchModels = async () => {
    if (!form.apiKey || !form.baseUrl) return
    const requestToken = ++fetchModelsTokenRef.current
    setFetchingModels(true)
    setAvailableModels([])
    try {
      const result = await platformAPI.invoke(
        IPC.LLM_LIST_MODELS,
        form.baseUrl,
        form.apiKey,
        form.provider
      ) as {
        success: boolean; models: ModelInfo[]; message: string
      }
      if (fetchModelsTokenRef.current !== requestToken) return
      if (result.success) {
        setAvailableModels(result.models)
        addToast('success', result.message)
        if (result.models.length > 0 && !form.model) {
          setForm(prev => ({ ...prev, model: result.models[0].id }))
        }
      } else {
        addToast('error', result.message)
      }
    } catch (e) {
      if (fetchModelsTokenRef.current === requestToken) {
        addToast('error', `获取模型列表失败：${getErrorMessage(e)}`)
      }
    }
    if (fetchModelsTokenRef.current === requestToken) {
      setFetchingModels(false)
    }
  }

  const handleTestConnection = async () => {
    const requestToken = ++formTestTokenRef.current
    setTesting(true)
    setTestResult(null)
    try {
      const result = await platformAPI.invoke(IPC.LLM_TEST_CONNECTION, form) as {
        success: boolean; message: string
      }
      if (formTestTokenRef.current !== requestToken) return
      setTestResult(result)
      addToast(result.success ? 'success' : 'error', result.message)
    } catch (e) {
      if (formTestTokenRef.current !== requestToken) return
      const failResult = { success: false, message: `测试失败：${getErrorMessage(e)}` }
      setTestResult(failResult)
      addToast('error', failResult.message)
    }
    if (formTestTokenRef.current === requestToken) {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    try {
      if (editingId) {
        const refreshed = await updateLLMConfig(editingId, form)
        addToast(refreshed ? 'success' : 'warning', refreshed
          ? `模型「${form.name}」已更新`
          : `模型「${form.name}」已更新，但模型列表刷新失败`)
      } else {
        const result = await addLLMConfig(form)
        addToast(result.refreshed ? 'success' : 'warning', result.refreshed
          ? `模型「${form.name}」已保存`
          : `模型「${form.name}」已保存，但模型列表刷新失败`)
      }
    } catch (e) {
      addToast('error', `保存失败：${e instanceof Error ? e.message : String(e)}`)
      return
    }
    setShowForm(false)
    setEditingId(null)
    setForm({ ...form, name: '', apiKey: '', model: '' })
    setAvailableModels([])
    setTestResult(null)
  }

  const handleEdit = (config: LLMConfig) => {
    resetFormAsyncState()
    setForm({
      name: config.name,
      category: config.category,
      provider: config.provider,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      isDefault: config.isDefault
    })
    setEditingId(config.id)
    setShowForm(true)
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingId(null)
    resetFormAsyncState()
    setForm({ name: '', category: activeCategory, provider: 'openai-compatible', baseUrl: DEFAULT_URLS['openai-compatible'], apiKey: '', model: '', maxTokens: 8192, temperature: 0.7, isDefault: true })
  }

  const handleExportDeliveryReport = async () => {
    setExportingDeliveryReport(true)
    try {
      const result = await platformAPI.invoke(IPC.APP_EXPORT_DELIVERY_REPORT) as {
        filePath: string
        status: AppDeliveryStatus
      }
      setDeliveryStatus(result.status)
      addToast('success', `交付诊断已导出：${result.filePath}`)
    } catch (error) {
      addToast('error', `交付诊断导出失败：${getErrorMessage(error)}`)
    } finally {
      setExportingDeliveryReport(false)
    }
  }

  const handleCategoryChange = (cat: ModelCategory) => {
    setActiveCategory(cat)
    setShowForm(false)
    setEditingId(null)
    resetFormAsyncState()
    setForm({ name: '', category: cat, provider: 'openai-compatible', baseUrl: DEFAULT_URLS['openai-compatible'], apiKey: '', model: '', maxTokens: 8192, temperature: 0.7, isDefault: true })
  }

  const handleAddNew = () => {
    resetFormAsyncState()
    setEditingId(null)
    setForm({
      name: '',
      category: activeCategory,
      provider: 'openai-compatible',
      baseUrl: DEFAULT_URLS['openai-compatible'],
      apiKey: '',
      model: '',
      maxTokens: 8192,
      temperature: 0.7,
      isDefault: true
    })
    setShowForm(true)
  }

  const filteredConfigs = llmConfigs.filter(c => (c.category || 'llm') === activeCategory)
  const activeTab = CATEGORY_TABS.find(t => t.value === activeCategory)!
  const supportsModelListing = form.provider === 'openai' || form.provider === 'openai-compatible'
  const isWebPreview = platformAPI.isWebPreview

  const handleDelete = async (id: string) => {
    try {
      const refreshed = await deleteLLMConfig(id)
      addToast(refreshed ? 'info' : 'warning', refreshed
        ? '模型已删除'
        : '模型已删除，但模型列表刷新失败')
    } catch (e) {
      addToast('error', `删除失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleSetDefault = async (id: string) => {
    try {
      const refreshed = await setDefaultLLM(id)
      addToast(refreshed ? 'success' : 'warning', refreshed
        ? '已设为默认模型'
        : '已设为默认模型，但模型列表刷新失败')
    } catch (e) {
      addToast('error', `设置默认失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleCardTest = async (config: LLMConfig) => {
    const requestToken = ++cardTestTokenRef.current
    setTestingCardId(config.id)
    // 清除该卡片之前的测试结果
    setCardTestResult(prev => {
      const next = { ...prev }
      delete next[config.id]
      return next
    })
    try {
      const result = await platformAPI.invoke(IPC.LLM_TEST_CONNECTION, config) as {
        success: boolean; message: string
      }
      if (cardTestTokenRef.current !== requestToken) return
      setCardTestResult(prev => ({ ...prev, [config.id]: result }))
      addToast(result.success ? 'success' : 'error', result.message)
    } catch (e) {
      if (cardTestTokenRef.current !== requestToken) return
      const failResult = { success: false, message: `测试失败：${getErrorMessage(e)}` }
      setCardTestResult(prev => ({ ...prev, [config.id]: failResult }))
      addToast('error', failResult.message)
    }
    if (cardTestTokenRef.current === requestToken) {
      setTestingCardId(null)
    }
  }

  const handleResetSettings = () => {
    if (!confirm('确定要恢复所有外观设置为默认值吗？')) return
    resetAppSettings()
    addToast('success', '外观设置已恢复默认')
  }

  const handleSaveWebTransport = async () => {
    const saved = saveWebTransportConfig({
      mode: webTransportMode,
      baseUrl: webTransportBaseUrl,
      invokePath: webTransportInvokePath,
      eventsPath: webTransportEventsPath
    })
    setWebTransportMode(saved.mode)
    setWebTransportBaseUrl(saved.baseUrl)
    setWebTransportInvokePath(saved.invokePath)
    setWebTransportEventsPath(saved.eventsPath)
    setTransportTestMessage(`已保存为 ${saved.mode === 'remote-http' ? '远程 HTTP' : '浏览器本地'} 模式`)
    addToast('success', 'Web transport 配置已保存')
    const [version, status] = await Promise.all([
      platformAPI.invoke(IPC.APP_GET_VERSION).catch(() => appVersion),
      platformAPI.invoke(IPC.APP_GET_DELIVERY_STATUS).catch(() => deliveryStatus)
    ])
    setAppVersion(String(version || '0.1.0'))
    if (status) setDeliveryStatus(status as AppDeliveryStatus)
  }

  const handleTestWebTransport = async () => {
    setTestingTransport(true)
    setTransportTestMessage(null)
    const result = await probeWebTransportConfig({
      mode: webTransportMode,
      baseUrl: webTransportBaseUrl,
      invokePath: webTransportInvokePath,
      eventsPath: webTransportEventsPath
    })
    setTransportTestMessage(result.message)
    addToast(result.success ? 'success' : 'error', result.message)
    setTestingTransport(false)
  }

  const handleResetWebTransport = () => {
    const reset = resetWebTransportConfig()
    setWebTransportMode(reset.mode)
    setWebTransportBaseUrl(reset.baseUrl)
    setWebTransportInvokePath(reset.invokePath)
    setWebTransportEventsPath(reset.eventsPath)
    setTransportTestMessage('已恢复浏览器本地模式')
    addToast('info', 'Web transport 已恢复默认')
  }

  return (
    <div className="settings">
      {isWebPreview && (
        <section className="card" style={{ marginBottom: 16, borderColor: 'var(--color-warning)' }}>
          <h2 style={{ marginTop: 0 }}>网页预览说明</h2>
          <p className="text-secondary" style={{ marginBottom: 8 }}>
            当前页面会把模型配置保存到浏览器 `localStorage`，可用于前端预览和后续 web 适配联调。
          </p>
          <p className="text-secondary" style={{ marginBottom: 0 }}>
            如果要测试第三方模型连接或拉取模型列表，建议优先使用同源代理；直接调用第三方接口通常会受 CORS 和密钥暴露限制。
          </p>
        </section>
      )}
      {isWebPreview && (
        <section className="settings-section">
          <div className="section-header">
            <h2>🌐 Web Transport</h2>
          </div>
          <div className="card config-form">
            <div className="form-grid">
              <div className="form-group">
                <label>运行模式</label>
                <select
                  className="input"
                  value={webTransportMode}
                  onChange={(e) => setWebTransportMode(e.target.value as WebTransportMode)}
                >
                  <option value="browser-local">浏览器本地</option>
                  <option value="remote-http">远程 HTTP 后端</option>
                </select>
              </div>
              <div className="form-group full-width">
                <label>Base URL</label>
                <input
                  className="input"
                  placeholder="例如 http://localhost:8787"
                  value={webTransportBaseUrl}
                  onChange={(e) => setWebTransportBaseUrl(e.target.value)}
                  disabled={webTransportMode !== 'remote-http'}
                />
              </div>
              <div className="form-group">
                <label>Invoke Path</label>
                <input
                  className="input"
                  value={webTransportInvokePath}
                  onChange={(e) => setWebTransportInvokePath(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Events Path</label>
                <input
                  className="input"
                  value={webTransportEventsPath}
                  onChange={(e) => setWebTransportEventsPath(e.target.value)}
                />
              </div>
            </div>
            <div className="text-secondary" style={{ marginTop: 8 }}>
              当前 transport 能把现有 `platformAPI.invoke(channel, ...)` 映射到远程后端，无需重写页面层调用。最小后端已覆盖 APP / PROJECT / SCRIPT / PROMPT / EXPORT 主链路。
            </div>
            <div className="form-actions">
              <button className="btn" onClick={handleTestWebTransport} disabled={testingTransport}>
                {testingTransport ? '⏳ 测试中...' : '测试后端'}
              </button>
              <button className="btn" onClick={handleResetWebTransport}>
                恢复默认
              </button>
              <button className="btn btn-primary" onClick={handleSaveWebTransport}>
                保存 Transport
              </button>
              {transportTestMessage && (
                <span className="text-secondary">{transportTestMessage}</span>
              )}
            </div>
          </div>
        </section>
      )}
      {/* ---- LLM 模型配置 ---- */}
      <section className="settings-section">
        <div className="section-header">
          <h2>🤖 模型配置</h2>
        </div>

        {/* 分类 Tab */}
        <div className="category-tabs">
          {CATEGORY_TABS.map(tab => (
            <button
              key={tab.value}
              className={`category-tab category-tab--${tab.color} ${activeCategory === tab.value ? 'active' : ''}`}
              onClick={() => handleCategoryChange(tab.value)}
            >
              <span className="category-tab-emoji">{tab.emoji}</span>
              <span className="category-tab-label">{tab.label}</span>
              <span className="category-tab-desc">{tab.desc}</span>
              <span className="category-tab-count">
                {llmConfigs.filter(c => (c.category || 'llm') === tab.value).length} 个配置
              </span>
            </button>
          ))}
        </div>

        {/* 当前分类头部 */}
        <div className="category-header">
          <div className="category-header-info">
            <span className="category-header-emoji">{activeTab.emoji}</span>
            <span className="category-header-title">{activeTab.label}</span>
            <span className="category-header-desc text-secondary">{activeTab.desc}</span>
          </div>
          {showForm ? (
            <button className="btn" onClick={handleCancel}>取消</button>
          ) : (
            <button className="btn btn-primary" onClick={handleAddNew}>+ 添加模型</button>
          )}
        </div>

        {showForm && (
          <div className="card config-form">
            <div className="form-grid">
              <div className="form-group">
                <label>配置名称</label>
                <input
                  className="input"
                  placeholder="e.g. GPT-5 代理"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Provider 类型</label>
                <select
                  className="input"
                  value={form.provider}
                  onChange={(e) => handleProviderChange(e.target.value as LLMProviderType)}
                >
                  {PROVIDER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group full-width">
                <label>Base URL <span className="text-secondary">(代理需要以 /v1 结尾)</span></label>
                <input
                  className="input"
                  value={form.baseUrl}
                  onChange={(e) => {
                    resetFormAsyncState()
                    setForm({ ...form, baseUrl: e.target.value })
                  }}
                />
              </div>
              <div className="form-group full-width">
                <label>API Key</label>
                <input
                  className="input"
                  type="password"
                  placeholder="sk-..."
                  value={form.apiKey}
                  onChange={(e) => {
                    resetFormAsyncState()
                    setForm({ ...form, apiKey: e.target.value })
                  }}
                />
              </div>

              {/* 模型选择 */}
              <div className="form-group">
                <label>模型名称</label>
                {availableModels.length > 0 ? (
                  <select
                    className="input"
                    value={form.model}
                    onChange={(e) => {
                      setTestResult(null)
                      setForm({ ...form, model: e.target.value })
                    }}
                  >
                    <option value="">-- 选择模型 --</option>
                    {availableModels.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name}{m.owner ? ` (${m.owner})` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input"
                    placeholder="e.g. gpt-5 或 claude-sonnet-4-20250514"
                    value={form.model}
                    onChange={(e) => {
                      setTestResult(null)
                      setForm({ ...form, model: e.target.value })
                    }}
                  />
                )}
              </div>
              <div className="form-group">
                <label>&nbsp;</label>
                {supportsModelListing ? (
                  <button
                    className="btn btn-sm"
                    onClick={handleFetchModels}
                    disabled={fetchingModels || !form.apiKey || !form.baseUrl}
                  >
                    {fetchingModels ? '⏳ 获取中...' : '📋 获取模型列表'}
                  </button>
                ) : (
                  <div className="text-secondary text-xs">
                    当前 Provider 不支持自动拉取模型，请手动填写模型名
                  </div>
                )}
              </div>
            </div>

            {/* 模型列表预览 */}
            {availableModels.length > 0 && (
              <div className="model-list-preview">
                <div className="model-list-title text-secondary">
                  可用模型 ({availableModels.length})
                </div>
                <div className="model-chips">
                  {availableModels.map(m => (
                    <span
                      key={m.id}
                      className={`model-chip ${form.model === m.id ? 'selected' : ''}`}
                      onClick={() => setForm({ ...form, model: m.id })}
                    >
                      {m.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="form-actions">
              <button
                className="btn"
                onClick={handleTestConnection}
                disabled={testing || !form.apiKey || !form.model}
              >
                {testing ? '⏳ 测试中...' : '🔌 测试连接'}
              </button>
              {testResult && (
                <span className={testResult.success ? 'text-success' : 'text-error'}>
                  {testResult.message}
                </span>
              )}
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={!form.name || !form.apiKey || !form.model}
              >
                💾 保存
              </button>
            </div>
          </div>
        )}

        <div className="config-list">
          {filteredConfigs.length === 0 && !showForm ? (
            <div className="config-empty text-secondary">
              尚未配置{activeTab.label}模型。点击「添加模型」开始配置。
            </div>
          ) : (
            filteredConfigs.map((config) => (
              <div key={config.id} className={`card config-item ${config.isDefault ? 'config-item--default' : ''}`}>
                <div className="config-info">
                  <div className="config-name">
                    {config.name}
                    {config.isDefault && <span className="badge badge-info">默认</span>}
                  </div>
                  <div className="config-meta text-secondary">
                    {config.provider} · {config.model}
                  </div>
                  {cardTestResult[config.id] && (
                    <div className={`config-test-result ${cardTestResult[config.id].success ? 'text-success' : 'text-error'}`}>
                      {cardTestResult[config.id].success ? '✅' : '❌'} {cardTestResult[config.id].message}
                    </div>
                  )}
                </div>
                <div className="config-actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => handleCardTest(config)}
                    disabled={testingCardId === config.id}
                  >
                    {testingCardId === config.id ? '⏳ 测试中...' : '🔌 测试'}
                  </button>
                  <button className="btn btn-sm" onClick={() => handleEdit(config)}>
                    ✏️ 编辑
                  </button>
                  {!config.isDefault && (
                    <button className="btn btn-sm" onClick={() => handleSetDefault(config.id)}>
                      设为默认
                    </button>
                  )}
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(config.id)}>
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ---- 外观设置 ---- */}
      <section className="settings-section">
        <div className="section-header">
          <h2>🎨 外观设置</h2>
        </div>
        <div className="card">
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">主题</span>
              <span className="setting-desc text-secondary">选择界面配色方案</span>
            </div>
            <div className="setting-control">
              {THEME_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`theme-btn ${appSettings.theme === opt.value ? 'active' : ''}`}
                  onClick={() => updateAppSettings({ theme: opt.value })}
                >
                  {opt.emoji} {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">界面缩放</span>
              <span className="setting-desc text-secondary">调整整体界面大小</span>
            </div>
            <div className="setting-control">
              <select
                className="input input-sm"
                value={appSettings.zoom}
                onChange={(e) => updateAppSettings({ zoom: e.target.value as ZoomLevel })}
              >
                {ZOOM_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">侧边栏宽度</span>
              <span className="setting-desc text-secondary">调整导航栏显示密度</span>
            </div>
            <div className="setting-control">
              {SIDEBAR_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`theme-btn ${appSettings.sidebarWidth === opt.value ? 'active' : ''}`}
                  onClick={() => updateAppSettings({ sidebarWidth: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---- 数据管理 ---- */}
      <section className="settings-section">
        <div className="section-header">
          <h2>📂 数据管理</h2>
        </div>
        <div className="card">
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-name">重置外观设置</span>
              <span className="setting-desc text-secondary">恢复主题、缩放、侧边栏为默认值</span>
            </div>
            <div className="setting-control">
              <button className="btn btn-sm btn-danger" onClick={handleResetSettings}>
                🔄 重置
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ---- 关于 ---- */}
      <section className="settings-section">
        <h2>ℹ️ 关于</h2>
        <div className="card about-card">
          <div className="about-row">
            <span className="text-secondary">版本</span>
            <span>v{appVersion}</span>
          </div>
          <div className="about-row">
            <span className="text-secondary">环境</span>
            <span>{deliveryStatus?.packaged ? '正式包' : '开发环境'}</span>
          </div>
          <div className="about-row">
            <span className="text-secondary">框架</span>
            <span>Electron + React + Vite</span>
          </div>
          <div className="about-row">
            <span className="text-secondary">交付评分</span>
            <span>{deliveryStatus?.readiness.score ?? '--'}</span>
          </div>
          <div className="about-row">
            <span className="text-secondary">UserData</span>
            <span className="about-path">{deliveryStatus?.paths.userData || '--'}</span>
          </div>
          <div className="about-row">
            <span className="text-secondary">数据库</span>
            <span className="about-path">{deliveryStatus?.paths.database || '--'}</span>
          </div>
          <div className="about-row">
            <span className="text-secondary">运行日志</span>
            <span className="about-path">{deliveryStatus?.paths.runtimeLog || '--'}</span>
          </div>
          <div className="about-row">
            <span className="text-secondary">最近错误</span>
            <span>{deliveryStatus?.recentErrors.length || 0}</span>
          </div>
          <div className="about-actions">
            <button className="btn btn-sm" onClick={() => window.location.assign('/')}>
              返回仪表盘
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => void handleExportDeliveryReport()} disabled={exportingDeliveryReport}>
              {exportingDeliveryReport ? '导出中...' : '导出交付诊断'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
