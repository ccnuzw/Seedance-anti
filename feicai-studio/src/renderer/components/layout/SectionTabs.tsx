import { memo } from 'react'
import './SectionTabs.css'

export interface SectionTabItem {
  key: string
  label: string
  hint?: string
}

interface SectionTabsProps {
  tabs: SectionTabItem[]
  activeKey: string
  onChange: (key: string) => void
}

function SectionTabs({ tabs, activeKey, onChange }: SectionTabsProps) {
  return (
    <div className="section-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`section-tab ${activeKey === tab.key ? 'is-active' : ''}`}
          onClick={() => onChange(tab.key)}
        >
          <span className="section-tab-label">{tab.label}</span>
          {tab.hint && <span className="section-tab-hint">{tab.hint}</span>}
        </button>
      ))}
    </div>
  )
}

export default memo(SectionTabs)
