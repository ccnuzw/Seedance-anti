export function AboutSection() {
  return (
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
  )
}
