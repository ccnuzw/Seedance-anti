interface Props {
  onReset: () => void
}

export function DataManagementSection({ onReset }: Props) {
  return (
    <section className="settings-section">
      <div className="section-header">
        <h2>📂 数据管理</h2>
      </div>
      <div className="card">
        <div className="setting-row">
          <div className="setting-label">
            <span className="setting-name">重置外观设置</span>
            <span className="setting-desc text-secondary">
              恢复主题、缩放、侧边栏为默认值
            </span>
          </div>
          <div className="setting-control">
            <button className="btn btn-sm btn-danger" onClick={onReset}>
              🔄 重置
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
