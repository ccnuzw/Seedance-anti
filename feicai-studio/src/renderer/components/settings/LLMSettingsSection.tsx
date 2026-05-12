import type { LLMConfigManager } from '@renderer/hooks/useLLMConfigManager'
import { LLMCategoryTabs } from './LLMCategoryTabs'
import { LLMConfigForm } from './LLMConfigForm'
import { LLMConfigList } from './LLMConfigList'

interface Props {
  manager: LLMConfigManager
}

export function LLMSettingsSection({ manager }: Props) {
  const {
    llmConfigs,
    activeTab,
    showForm,
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
  } = manager

  return (
    <section className="settings-section">
      <div className="section-header">
        <h2>🤖 模型配置</h2>
      </div>

      <LLMCategoryTabs
        activeCategory={manager.activeCategory}
        llmConfigs={llmConfigs}
        onCategoryChange={handleCategoryChange}
      />

      <div className="category-header">
        <div className="category-header-info">
          <span className="category-header-emoji">{activeTab.emoji}</span>
          <span className="category-header-title">{activeTab.label}</span>
          <span className="category-header-desc text-secondary">
            {activeTab.desc}
          </span>
        </div>
        {showForm ? (
          <button className="btn" onClick={handleCancel}>
            取消
          </button>
        ) : (
          <button className="btn btn-primary" onClick={handleAddNew}>
            + 添加模型
          </button>
        )}
      </div>

      <LLMConfigForm
        showForm={showForm}
        editingId={editingId}
        testing={testing}
        testResult={testResult}
        fetchingModels={fetchingModels}
        availableModels={availableModels}
        hasStoredApiKey={hasStoredApiKey}
        maskedApiKey={
          filteredConfigs.find((config) => config.id === editingId)
            ?.apiKeyMasked
        }
        form={form}
        providerOptions={providerOptions}
        onFormChange={setForm}
        onProviderChange={handleProviderChange}
        onFetchModels={() => {
          void handleFetchModels()
        }}
        onTestConnection={() => {
          void handleTestConnection()
        }}
        onSave={() => {
          void handleSave()
        }}
      />

      <LLMConfigList
        activeTabLabel={activeTab.label}
        showForm={showForm}
        filteredConfigs={filteredConfigs}
        cardTestResult={cardTestResult}
        testingCardId={testingCardId}
        onCardTest={(config) => {
          void handleCardTest(config)
        }}
        onEdit={handleEdit}
        onSetDefault={(id) => {
          void handleSetDefault(id)
        }}
        onDelete={(id) => {
          void handleDelete(id)
        }}
      />
    </section>
  )
}
