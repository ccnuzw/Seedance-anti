import { CATEGORY_TABS } from '@renderer/settings/llm-config'
import { countConfigsByCategory } from '@renderer/settings/llm-settings-helpers'
import type { LLMConfig } from '@shared/types'
import type { ModelCategory } from '@shared/types'

interface Props {
  activeCategory: ModelCategory
  llmConfigs: LLMConfig[]
  onCategoryChange: (category: ModelCategory) => void
}

export function LLMCategoryTabs({
  activeCategory,
  llmConfigs,
  onCategoryChange
}: Props) {
  return (
    <div className="category-tabs">
      {CATEGORY_TABS.map((tab) => (
        <button
          key={tab.value}
          className={`category-tab category-tab--${tab.color} ${activeCategory === tab.value ? 'active' : ''}`}
          onClick={() => onCategoryChange(tab.value)}
        >
          <span className="category-tab-emoji">{tab.emoji}</span>
          <span className="category-tab-label">{tab.label}</span>
          <span className="category-tab-desc">{tab.desc}</span>
          <span className="category-tab-count">
            {countConfigsByCategory(llmConfigs, tab.value)} 个配置
          </span>
        </button>
      ))}
    </div>
  )
}
