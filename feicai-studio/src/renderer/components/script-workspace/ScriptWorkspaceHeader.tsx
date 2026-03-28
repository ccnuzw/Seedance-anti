interface ScriptWorkspaceHeaderProps {
  reviewBlocked: boolean
  isRunning: boolean
  supportsGeneration: boolean
  onFix: () => void
  onPause: () => void
  onAbort: () => void
}

export default function ScriptWorkspaceHeader({
  reviewBlocked,
  isRunning,
  supportsGeneration,
  onFix,
  onPause,
  onAbort
}: ScriptWorkspaceHeaderProps) {
  return (
    <div className="as-page-header">
      <div className="as-header-left">
        <h1 className="page-title">✍️ 分集剧本工作区</h1>
        <p className="text-secondary">把剧本生成、单集编辑、修订闭环和送入制作统一在一个工作台里处理。</p>
      </div>
      <div className="as-header-right">
        {reviewBlocked && !isRunning && supportsGeneration && (
          <button className="btn btn-danger" onClick={onFix}>
            修正当前毁坏集
          </button>
        )}
        {isRunning && (
          <>
            <button className="btn btn-sm" onClick={onPause}>⏸ 暂停</button>
            <button className="btn btn-sm btn-danger" onClick={onAbort}>⏹ 停止</button>
          </>
        )}
      </div>
    </div>
  )
}
