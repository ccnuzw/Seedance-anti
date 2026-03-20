import { useState, useEffect } from 'react'
import { IPC } from '@shared/ipc-channels'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import type { ThemeMode, ZoomLevel, SidebarWidth } from '@renderer/stores/settingsStore'
import { useToastStore } from '@renderer/stores/toastStore'
import type { LLMConfig, LLMProviderType, ModelCategory } from '@shared/types'
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

  useEffect(() => {
    loadLLMConfigs()
  }, [])

  const handleProviderChange = (provider: LLMProviderType) => {
    setForm({ ...form, provider, baseUrl: DEFAULT_URLS[provider] })
    setAvailableModels([])
  }

  const handleFetchModels = async () => {
    if (!form.apiKey || !form.baseUrl) return
    setFetchingModels(true)
    setAvailableModels([])
    try {
      const result = await window.feicaiAPI.invoke(IPC.LLM_LIST_MODELS, form.baseUrl, form.apiKey) as {
        success: boolean; models: ModelInfo[]; message: string
      }
      if (result.success) {
        setAvailableModels(result.models)
        addToast('success', result.message)
        if (result.models.length > 0 && !form.model) {
          setForm(prev => ({ ...prev, model: result.models[0].id }))
        }
      } else {
        addToast('error', result.message)
      }
    } catch {
      addToast('error', '获取模型列表失败')
    }
    setFetchingModels(false)
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.feicaiAPI.invoke(IPC.LLM_TEST_CONNECTION, form) as {
        success: boolean; message: string
      }
      setTestResult(result)
      addToast(result.success ? 'success' : 'error', result.message)
    } catch {
      const failResult = { success: false, message: '测试失败：无法连接' }
      setTestResult(failResult)
      addToast('error', failResult.message)
    }
    setTesting(false)
  }

  const handleSave = async () => {
    if (editingId) {
      await updateLLMConfig(editingId, form)
      addToast('success', `模型「${form.name}」已更新`)
    } else {
      await addLLMConfig(form)
      addToast('success', `模型「${form.name}」已保存`)
    }
    setShowForm(false)
    setEditingId(null)
    setForm({ ...form, name: '', apiKey: '', model: '' })
    setAvailableModels([])
  }

  const handleEdit = (config: LLMConfig) => {
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
    setAvailableModels([])
    setTestResult(null)
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingId(null)
    setForm({ name: '', category: activeCategory, provider: 'openai-compatible', baseUrl: DEFAULT_URLS['openai-compatible'], apiKey: '', model: '', maxTokens: 8192, temperature: 0.7, isDefault: true })
    setAvailableModels([])
    setTestResult(null)
  }

  const handleCategoryChange = (cat: ModelCategory) => {
    setActiveCategory(cat)
    setShowForm(false)
    setEditingId(null)
    setForm({ name: '', category: cat, provider: 'openai-compatible', baseUrl: DEFAULT_URLS['openai-compatible'], apiKey: '', model: '', maxTokens: 8192, temperature: 0.7, isDefault: true })
    setAvailableModels([])
    setTestResult(null)
  }

  const handleAddNew = () => {
    setForm(prev => ({ ...prev, category: activeCategory }))
    setShowForm(true)
  }

  const filteredConfigs = llmConfigs.filter(c => (c.category || 'llm') === activeCategory)
  const activeTab = CATEGORY_TABS.find(t => t.value === activeCategory)!

  const handleDelete = async (id: string) => {
    await deleteLLMConfig(id)
    addToast('info', '模型已删除')
  }

  const handleSetDefault = async (id: string) => {
    await setDefaultLLM(id)
    addToast('success', '已设为默认模型')
  }

  const handleCardTest = async (config: LLMConfig) => {
    setTestingCardId(config.id)
    // 清除该卡片之前的测试结果
    setCardTestResult(prev => {
      const next = { ...prev }
      delete next[config.id]
      return next
    })
    try {
      const result = await window.feicaiAPI.invoke(IPC.LLM_TEST_CONNECTION, config) as {
        success: boolean; message: string
      }
      setCardTestResult(prev => ({ ...prev, [config.id]: result }))
      addToast(result.success ? 'success' : 'error', result.message)
    } catch {
      const failResult = { success: false, message: '测试失败：无法连接' }
      setCardTestResult(prev => ({ ...prev, [config.id]: failResult }))
      addToast('error', failResult.message)
    }
    setTestingCardId(null)
  }

  const handleResetSettings = () => {
    if (!confirm('确定要恢复所有外观设置为默认值吗？')) return
    resetAppSettings()
    addToast('success', '外观设置已恢复默认')
  }

  return (
    <div className="settings">
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
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                />
              </div>
              <div className="form-group full-width">
                <label>API Key</label>
                <input
                  className="input"
                  type="password"
                  placeholder="sk-..."
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                />
              </div>

              {/* 模型选择 */}
              <div className="form-group">
                <label>模型名称</label>
                {availableModels.length > 0 ? (
                  <select
                    className="input"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
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
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                  />
                )}
              </div>
              <div className="form-group">
                <label>&nbsp;</label>
                <button
                  className="btn btn-sm"
                  onClick={handleFetchModels}
                  disabled={fetchingModels || !form.apiKey || !form.baseUrl}
                >
                  {fetchingModels ? '⏳ 获取中...' : '📋 获取模型列表'}
                </button>
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
            <span>v0.1.0</span>
          </div>
          <div className="about-row">
            <span className="text-secondary">框架</span>
            <span>Electron + React + Vite</span>
          </div>
        </div>
      </section>
    </div>
  )
}

