import { useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  listLLMModels,
  testLLMConnection
} from '@renderer/services/settings-service'
import { getExceptionMessage } from '@renderer/services/service-contracts'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import type { LLMConfig, LLMProviderType, ModelCategory } from '@shared/types'
import type {
  LLMConnectionTestResult,
  LLMModelInfo,
  LLMModelListRequest
} from '@shared/ipc-contracts'
import {
  CATEGORY_TABS,
  createDefaultLLMForm,
  DEFAULT_MODELS,
  DEFAULT_URLS,
  DEFAULT_WIRE_API,
  getProviderOptions,
  toLLMFormState,
  type LLMFormState
} from '@renderer/settings/llm-config'
import { useToastStore } from '@renderer/stores/toastStore'

export interface LLMConfigManager {
  llmConfigs: LLMConfig[]
  activeCategory: ModelCategory
  setActiveCategory: (category: ModelCategory) => void
  activeTab: (typeof CATEGORY_TABS)[number]
  showForm: boolean
  setShowForm: (value: boolean) => void
  editingId: string | null
  testing: boolean
  testResult: { success: boolean; message: string } | null
  testingCardId: string | null
  cardTestResult: Record<string, { success: boolean; message: string }>
  fetchingModels: boolean
  availableModels: LLMModelInfo[]
  hasStoredApiKey: boolean
  form: LLMFormState
  setForm: Dispatch<SetStateAction<LLMFormState>>
  providerOptions: ReturnType<typeof getProviderOptions>
  filteredConfigs: LLMConfig[]
  handleProviderChange: (provider: LLMProviderType) => void
  handleFetchModels: () => Promise<void>
  handleTestConnection: () => Promise<void>
  handleSave: () => Promise<void>
  handleEdit: (config: LLMConfig) => void
  handleCancel: () => void
  handleCategoryChange: (category: ModelCategory) => void
  handleAddNew: () => void
  handleDelete: (id: string) => Promise<void>
  handleSetDefault: (id: string) => Promise<void>
  handleCardTest: (config: LLMConfig) => Promise<void>
}

export function useLLMConfigManager(): LLMConfigManager {
  const {
    llmConfigs,
    loadLLMConfigs,
    addLLMConfig,
    deleteLLMConfig,
    setDefaultLLM,
    updateLLMConfig
  } = useSettingsStore()
  const { addToast } = useToastStore()
  const [activeCategory, setActiveCategory] = useState<ModelCategory>('llm')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)
  const [testingCardId, setTestingCardId] = useState<string | null>(null)
  const [cardTestResult, setCardTestResult] = useState<
    Record<string, { success: boolean; message: string }>
  >({})
  const [fetchingModels, setFetchingModels] = useState(false)
  const [availableModels, setAvailableModels] = useState<LLMModelInfo[]>([])
  const [hasStoredApiKey, setHasStoredApiKey] = useState(false)
  const [form, setForm] = useState<LLMFormState>(() => createDefaultLLMForm())

  useEffect(() => {
    void loadLLMConfigs()
  }, [loadLLMConfigs])

  const filteredConfigs = useMemo(
    () =>
      llmConfigs.filter(
        (config) => (config.category || 'llm') === activeCategory
      ),
    [llmConfigs, activeCategory]
  )

  const activeTab =
    CATEGORY_TABS.find((tab) => tab.value === activeCategory) ??
    CATEGORY_TABS[0]
  const providerOptions = getProviderOptions(form.category)

  const handleProviderChange = (provider: LLMProviderType) => {
    setForm({
      ...form,
      provider,
      baseUrl: DEFAULT_URLS[provider],
      wireApi: DEFAULT_WIRE_API[provider],
      model: form.model || DEFAULT_MODELS[form.category]
    })
    setAvailableModels([])
  }

  const handleFetchModels = async () => {
    if ((!form.apiKey && !(editingId && hasStoredApiKey)) || !form.baseUrl)
      return
    setFetchingModels(true)
    setAvailableModels([])
    try {
      const payload: LLMModelListRequest = {
        baseUrl: form.baseUrl,
        apiKey: form.apiKey || undefined,
        configId: editingId && hasStoredApiKey ? editingId : undefined
      }
      const result = await listLLMModels(payload)
      if (result.success) {
        setAvailableModels(result.models)
        addToast('success', result.message)
        if (result.models.length > 0 && !form.model) {
          setForm((prev) => ({ ...prev, model: result.models[0].id }))
        }
      } else {
        addToast('error', result.message)
      }
    } catch (error) {
      addToast('error', getExceptionMessage(error, '获取模型列表失败'))
    }
    setFetchingModels(false)
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    const result: LLMConnectionTestResult = await testLLMConnection({
      ...form,
      id: editingId || '',
      apiKey: form.apiKey
    })
    setTestResult(result)
    setTesting(false)
    addToast(result.success ? 'success' : 'error', result.message)
  }

  const handleSave = async () => {
    const payload = {
      ...form,
      ...(editingId && hasStoredApiKey && !form.apiKey.trim()
        ? {}
        : { apiKey: form.apiKey })
    }
    try {
      if (editingId) {
        await updateLLMConfig(editingId, payload)
        addToast('success', `模型「${form.name}」已更新`)
      } else {
        await addLLMConfig(payload)
        addToast('success', `模型「${form.name}」已保存`)
      }
    } catch (error) {
      addToast('error', getExceptionMessage(error, '保存失败'))
      return
    }
    setShowForm(false)
    setEditingId(null)
    setHasStoredApiKey(false)
    setForm(createDefaultLLMForm(form.category))
    setAvailableModels([])
  }

  const handleEdit = (config: LLMConfig) => {
    setForm(toLLMFormState(config))
    setEditingId(config.id)
    setHasStoredApiKey(config.hasStoredApiKey === true)
    setShowForm(true)
    setAvailableModels([])
    setTestResult(null)
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingId(null)
    setHasStoredApiKey(false)
    setForm(createDefaultLLMForm(activeCategory))
    setAvailableModels([])
    setTestResult(null)
  }

  const handleCategoryChange = (category: ModelCategory) => {
    setActiveCategory(category)
    setShowForm(false)
    setEditingId(null)
    setHasStoredApiKey(false)
    setForm(createDefaultLLMForm(category))
    setAvailableModels([])
    setTestResult(null)
  }

  const handleAddNew = () => {
    setForm((prev) => ({ ...prev, category: activeCategory }))
    setShowForm(true)
  }

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
    setCardTestResult((prev) => {
      const next = { ...prev }
      delete next[config.id]
      return next
    })
    try {
      const result = await testLLMConnection(config)
      setCardTestResult((prev) => ({ ...prev, [config.id]: result }))
      addToast(result.success ? 'success' : 'error', result.message)
    } catch {
      const failResult = { success: false, message: '测试失败：无法连接' }
      setCardTestResult((prev) => ({ ...prev, [config.id]: failResult }))
      addToast('error', failResult.message)
    }
    setTestingCardId(null)
  }

  return {
    llmConfigs,
    activeCategory,
    setActiveCategory,
    activeTab,
    showForm,
    setShowForm,
    editingId,
    testing,
    testResult,
    testingCardId,
    cardTestResult,
    fetchingModels,
    availableModels,
    hasStoredApiKey,
    form,
    setForm,
    providerOptions,
    filteredConfigs,
    handleProviderChange,
    handleFetchModels,
    handleTestConnection,
    handleSave,
    handleEdit,
    handleCancel,
    handleCategoryChange,
    handleAddNew,
    handleDelete,
    handleSetDefault,
    handleCardTest
  }
}
