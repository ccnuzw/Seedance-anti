import { memo } from 'react'
import EmptyState from '@renderer/components/layout/EmptyState'
import EpisodeNav from '@renderer/components/layout/EpisodeNav'
import SimpleMarkdown from '@renderer/components/SimpleMarkdown'
import type { PromptWorkspaceState } from '@renderer/hooks/usePromptWorkspace'

interface PromptWorkspaceViewProps {
  embedded?: boolean
  workspace: PromptWorkspaceState
}

function PromptWorkspaceView({
  embedded = false,
  workspace
}: PromptWorkspaceViewProps) {
  const {
    episodes,
    currentEp,
    prompts,
    loading,
    selectedIndex,
    isEditing,
    rawMd,
    viewTab,
    tabContent,
    tabLoading,
    actualPrompts,
    totalDuration,
    durationOk,
    assetSections,
    handleEpisodeSelect,
    handleViewTabChange,
    handleSelectPrompt,
    handleStartEdit,
    handleRawMdChange,
    handleSave,
    handleCancelEdit,
    handleReReview
  } = workspace

  return (
    <div className="prompt-page">
      <EpisodeNav
        episodes={episodes}
        currentEp={currentEp}
        onSelect={handleEpisodeSelect}
      />

      <div className="prompt-tabs">
        <button className={`tab-btn ${viewTab === 'prompts' ? 'active' : ''}`} onClick={() => handleViewTabChange('prompts')}>
          📐 提示词
        </button>
        <button className={`tab-btn ${viewTab === 'director' ? 'active' : ''}`} onClick={() => handleViewTabChange('director')}>
          🎬 导演分析
        </button>
        <button className={`tab-btn ${viewTab === 'art' ? 'active' : ''}`} onClick={() => handleViewTabChange('art')}>
          🎨 服化道设计
        </button>
        <button className={`tab-btn ${viewTab === 'assets' ? 'active' : ''}`} onClick={() => handleViewTabChange('assets')}>
          🧾 人物 / 场景提示词
        </button>
      </div>

      {viewTab === 'prompts' ? (
        <>
          <div className="page-header">
            <div className="prompt-header-info">
              {embedded ? (
                <h3>📐 EP{String(currentEp).padStart(3, '0')} 提示词</h3>
              ) : (
                <h2>📐 EP{String(currentEp).padStart(3, '0')} 提示词</h2>
              )}
              <div className="prompt-stats text-secondary">
                {actualPrompts.length} 条提示词
              </div>
            </div>
            <div className="prompt-actions">
              {!isEditing ? (
                <>
                  <button className="btn btn-sm" onClick={handleStartEdit} disabled={prompts.length === 0}>
                    ✏️ 编辑
                  </button>
                  <button className="btn btn-sm" onClick={() => void handleReReview()} disabled={prompts.length === 0}>
                    🔄 重新审核
                  </button>
                </>
              ) : (
                <>
                  <button className="btn btn-sm btn-primary" onClick={() => void handleSave()}>
                    💾 保存
                  </button>
                  <button className="btn btn-sm" onClick={() => void handleCancelEdit()}>
                    ❌ 取消
                  </button>
                </>
              )}
            </div>
            <div className="prompt-duration-bar">
              <div className="duration-label">
                <span className={durationOk ? 'text-success' : 'text-warning'}>
                  ⏱ {totalDuration}s
                </span>
                <span className="text-secondary"> / 90-120s</span>
              </div>
              <div className="duration-track">
                <div
                  className={`duration-fill ${durationOk ? 'ok' : 'warn'}`}
                  style={{ width: `${Math.min((totalDuration / 120) * 100, 100)}%` }}
                />
                <div className="duration-marker" style={{ left: '75%' }} />
                <div className="duration-marker" style={{ left: '100%' }} />
              </div>
            </div>
          </div>

          {isEditing ? (
            <div className="prompt-editor">
              <textarea
                className="prompt-editor-textarea"
                value={rawMd}
                onChange={(event) => handleRawMdChange(event.target.value)}
                spellCheck={false}
              />
            </div>
          ) : (
            <div className="prompt-cards">
              {loading ? (
                <div className="prompt-empty text-secondary">加载中...</div>
              ) : prompts.length === 0 ? (
                <EmptyState icon="📜" title="暂无提示词" description="请先在流水线中执行分镜阶段" />
              ) : (
                prompts.map((prompt) => {
                  const isRefTable = prompt.index === 0
                  return (
                    <div
                      key={prompt.index}
                      className={`card prompt-card ${isRefTable ? 'prompt-card-ref-table' : ''} ${selectedIndex === prompt.index ? 'selected' : ''}`}
                      onClick={() => handleSelectPrompt(prompt.index)}
                    >
                      <div className="prompt-card-header">
                        <span className={`prompt-index ${isRefTable ? 'prompt-index-ref' : ''}`}>
                          {isRefTable ? '📋 P00' : `P${String(prompt.index).padStart(2, '0')}`}
                        </span>
                        <span className="prompt-title text-secondary">{prompt.title}</span>
                        {!isRefTable && (
                          <span className={`prompt-duration badge ${prompt.duration > 10 ? 'badge-warning' : 'badge-info'}`}>
                            {prompt.duration}s
                          </span>
                        )}
                      </div>
                      <div className="prompt-card-body">
                        <p className="prompt-content">{prompt.content}</p>
                      </div>
                      {prompt.references.length > 0 && (
                        <div className="prompt-refs">
                          {prompt.references.map((ref, index) => (
                            <span
                              key={index}
                              className={`prompt-ref-tag ${ref.assetType === 'character' ? 'ref-char' : 'ref-scene'}`}
                            >
                              {ref.referenceTag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          )}
        </>
      ) : viewTab === 'assets' ? (
        <div className="product-viewer">
          <div className="product-viewer-header">
            {embedded ? (
              <h3>🧾 EP{String(currentEp).padStart(3, '0')} 新增人物 / 场景提示词</h3>
            ) : (
              <h2>🧾 EP{String(currentEp).padStart(3, '0')} 新增人物 / 场景提示词</h2>
            )}
          </div>
          {tabLoading ? (
            <div className="prompt-empty text-secondary">加载中...</div>
          ) : assetSections.length > 0 ? (
            <div className="prompt-asset-sections">
              {assetSections.map((section) => (
                <div key={section.filePath} className="card prompt-asset-section-card">
                  <div className="prompt-asset-section-head">
                    <div>
                      <strong>{section.title}</strong>
                      <div className="text-secondary text-xs">{section.filePath}</div>
                    </div>
                    <span className={`status-chip ${section.type === 'character' ? 'is-info' : 'is-warning'}`}>
                      {section.type === 'character' ? '人物' : '场景'}
                    </span>
                  </div>
                  <div className="text-secondary text-xs">已定位到当前集在资产提示词文件中的区域。</div>
                  <div className="product-content-md prompt-asset-section-content">
                    <SimpleMarkdown content={section.excerpt} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="🧾"
              title="尚未定位到本集的人物 / 场景提示词"
              description="请先完成服化道阶段，生成并审核通过后再查看。"
            />
          )}
        </div>
      ) : (
        <div className="product-viewer">
          <div className="product-viewer-header">
            {embedded ? (
              <h3>{viewTab === 'director' ? '🎬' : '🎨'} EP{String(currentEp).padStart(3, '0')} {viewTab === 'director' ? '导演分析' : '服化道设计'}</h3>
            ) : (
              <h2>{viewTab === 'director' ? '🎬' : '🎨'} EP{String(currentEp).padStart(3, '0')} {viewTab === 'director' ? '导演分析' : '服化道设计'}</h2>
            )}
          </div>
          {tabLoading ? (
            <div className="prompt-empty text-secondary">加载中...</div>
          ) : tabContent ? (
            <div className="product-content-md">
              <SimpleMarkdown content={tabContent} />
            </div>
          ) : (
            <EmptyState
              icon={viewTab === 'director' ? '🎬' : '🎨'}
              title={`暂无${viewTab === 'director' ? '导演分析' : '服化道设计'}产物`}
              description="请先在流水线中执行对应阶段"
            />
          )}
        </div>
      )}
    </div>
  )
}

export default memo(PromptWorkspaceView)
