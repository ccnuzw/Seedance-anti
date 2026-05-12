import { useSettingsStore } from '@renderer/stores/settingsStore'
import { useLLMConfigManager } from '@renderer/hooks/useLLMConfigManager'
import { LLMSettingsSection } from '@renderer/components/settings/LLMSettingsSection'
import { AppearanceSettingsSection } from '@renderer/components/settings/AppearanceSettingsSection'
import { DataManagementSection } from '@renderer/components/settings/DataManagementSection'
import { AboutSection } from '@renderer/components/settings/AboutSection'
import './SettingsPage.css'

export default function SettingsPage() {
  const { appSettings, updateAppSettings, resetAppSettings } =
    useSettingsStore()
  const llmManager = useLLMConfigManager()

  const handleResetSettings = () => {
    if (!confirm('确定要恢复所有外观设置为默认值吗？')) return
    resetAppSettings()
  }

  return (
    <div className="settings">
      <LLMSettingsSection manager={llmManager} />
      <AppearanceSettingsSection
        appSettings={appSettings}
        updateAppSettings={updateAppSettings}
      />
      <DataManagementSection onReset={handleResetSettings} />
      <AboutSection />
    </div>
  )
}
