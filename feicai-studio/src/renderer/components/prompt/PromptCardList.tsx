import { memo } from 'react'
import type { ParsedPrompt } from '@renderer/utils/prompt-markdown'
import { DevProfiler } from '@renderer/dev/render-profiler'

interface PromptCardListProps {
  prompts: ParsedPrompt[]
  loading: boolean
  selectedIndex: number | null
  onSelect: (index: number | null) => void
}

function PromptCardList(props: PromptCardListProps) {
  const { prompts, loading, selectedIndex, onSelect } = props

  if (loading) {
    return <div className="prompt-empty text-secondary">加载中...</div>
  }

  if (prompts.length === 0) {
    return (
      <div className="prompt-empty text-secondary">
        该集暂无提示词。请先在流水线中执行分镜阶段。
      </div>
    )
  }

  return (
    <DevProfiler id="PromptCardList">
      <div className="prompt-cards">
        {prompts.map((prompt) => {
          const isRefTable = prompt.index === 0
          return (
            <div
              key={prompt.index}
              className={`card prompt-card ${isRefTable ? 'prompt-card-ref-table' : ''} ${selectedIndex === prompt.index ? 'selected' : ''}`}
              onClick={() => onSelect(prompt.index)}
            >
              <div className="prompt-card-header">
                <span
                  className={`prompt-index ${isRefTable ? 'prompt-index-ref' : ''}`}
                >
                  {isRefTable
                    ? '📋 P00'
                    : `P${String(prompt.index).padStart(2, '0')}`}
                </span>
                <span className="prompt-title text-secondary">
                  {prompt.title}
                </span>
                {!isRefTable && (
                  <span
                    className={`prompt-duration badge ${prompt.duration > 10 ? 'badge-warning' : 'badge-info'}`}
                  >
                    {prompt.duration}s
                  </span>
                )}
              </div>
              <div className="prompt-card-body">
                <p className="prompt-content">{prompt.content}</p>
              </div>
              {prompt.references.length > 0 && (
                <div className="prompt-refs">
                  {prompt.references.map((ref, i) => (
                    <span
                      key={i}
                      className={`prompt-ref-tag ${ref.assetType === 'character' ? 'ref-char' : 'ref-scene'}`}
                    >
                      {ref.referenceTag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </DevProfiler>
  )
}

export default memo(PromptCardList)
