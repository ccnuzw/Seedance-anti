import type {
  ZoomLevel,
  SidebarWidth,
  ThemeMode,
  AppSettings
} from '@renderer/stores/settingsStore'

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

interface Props {
  appSettings: AppSettings
  updateAppSettings: (patch: Partial<AppSettings>) => void
}

export function AppearanceSettingsSection({
  appSettings,
  updateAppSettings
}: Props) {
  return (
    <section className="settings-section">
      <div className="section-header">
        <h2>🎨 外观设置</h2>
      </div>
      <div className="card">
        <div className="setting-row">
          <div className="setting-label">
            <span className="setting-name">主题</span>
            <span className="setting-desc text-secondary">
              选择界面配色方案
            </span>
          </div>
          <div className="setting-control">
            {THEME_OPTIONS.map((opt) => (
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
            <span className="setting-desc text-secondary">
              调整整体界面大小
            </span>
          </div>
          <div className="setting-control">
            <select
              className="input input-sm"
              value={appSettings.zoom}
              onChange={(e) =>
                updateAppSettings({ zoom: e.target.value as ZoomLevel })
              }
            >
              {ZOOM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-label">
            <span className="setting-name">侧边栏宽度</span>
            <span className="setting-desc text-secondary">
              调整导航栏显示密度
            </span>
          </div>
          <div className="setting-control">
            {SIDEBAR_OPTIONS.map((opt) => (
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
  )
}
