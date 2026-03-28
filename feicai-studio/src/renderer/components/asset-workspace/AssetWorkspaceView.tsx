import { memo } from 'react'
import EpisodeNav from '@renderer/components/layout/EpisodeNav'
import type { AssetWorkspaceState } from '@renderer/hooks/useAssetWorkspace'

interface AssetWorkspaceViewProps {
  workspace: AssetWorkspaceState
}

function renderPromptPreview(promptText: string, expanded: boolean): string {
  if (expanded || promptText.length <= 120) return promptText
  return `${promptText.substring(0, 120)}...`
}

function AssetWorkspaceView({ workspace }: AssetWorkspaceViewProps) {
  const {
    episodes,
    currentEp,
    tab,
    characters,
    scenes,
    filteredCharacters,
    filteredScenes,
    searchQuery,
    expandedId,
    editingId,
    editText,
    promptStats,
    promptSummaries,
    canUploadImages,
    handleEpisodeSelect,
    handleTabChange,
    handleSearchQueryChange,
    handleToggleExpand,
    handleStartEdit,
    handleCancelEdit,
    handleEditTextChange,
    handleCopy,
    handleUploadImage,
    handleSave
  } = workspace

  return (
    <div className="asset-page">
      {episodes.length > 0 && (
        <EpisodeNav
          episodes={episodes}
          currentEp={currentEp}
          onSelect={handleEpisodeSelect}
        />
      )}

      {episodes.length > 0 && (
        <div className="card asset-context-card">
          <div className="asset-context-header">
            <div>
              <h3 className="asset-context-title">EP{String(currentEp).padStart(3, '0')} 提示词引用概览</h3>
              <p className="text-secondary asset-context-subtitle">
                用于快速检查当前集的提示词规模与素材引用情况
              </p>
            </div>
            {promptStats && (
              <div className="asset-context-stats">
                <span>{promptStats.totalCount} 条提示词</span>
                <span>{promptStats.totalDuration}s 总时长</span>
                <span>{promptStats.avgDuration}s 平均</span>
              </div>
            )}
          </div>

          {promptSummaries.length === 0 ? (
            <div className="text-secondary asset-context-empty">当前集暂无 Seedance 提示词。</div>
          ) : (
            <div className="asset-prompt-list">
              {promptSummaries.slice(0, 6).map((prompt) => (
                <div key={prompt.index} className="asset-prompt-item">
                  <div className="asset-prompt-title">
                    <span>P{prompt.index}</span>
                    <span className="text-secondary">{prompt.duration}s</span>
                  </div>
                  <div className="asset-prompt-name">{prompt.title}</div>
                  <div className="asset-prompt-refs text-secondary">
                    {prompt.references.length > 0
                      ? prompt.references.map((ref) => ref.referenceTag).join(' · ')
                      : '无素材引用'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!canUploadImages && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--color-warning)' }}>
          <strong>网页模式素材说明</strong>
          <p className="text-secondary" style={{ margin: '8px 0 0' }}>
            当前可根据提示词引用浏览、复制、编辑角色和场景提示词；本地参考图上传仍需要桌面端。
          </p>
        </div>
      )}

      <div className="asset-tabs">
        <button
          className={`tab-btn ${tab === 'characters' ? 'active' : ''}`}
          onClick={() => handleTabChange('characters')}
        >
          👤 角色 <span className="tab-count">{characters.length}</span>
        </button>
        <button
          className={`tab-btn ${tab === 'scenes' ? 'active' : ''}`}
          onClick={() => handleTabChange('scenes')}
        >
          🏞️ 场景 <span className="tab-count">{scenes.length}</span>
        </button>
        <div className="tab-spacer" />
        <input
          className="input asset-search"
          placeholder="搜索素材..."
          value={searchQuery}
          onChange={(event) => handleSearchQueryChange(event.target.value)}
        />
      </div>

      {tab === 'characters' && (
        <div className="asset-grid">
          {filteredCharacters.length === 0 ? (
            <div className="asset-empty text-secondary">暂无角色素材。请确认 assets/character-prompts.md 存在。</div>
          ) : (
            filteredCharacters.map((character) => {
              const isExpanded = expandedId === character.id
              const isEditing = editingId === character.id
              return (
                <div
                  key={character.id}
                  className={`card asset-card character-card ${isExpanded ? 'expanded' : ''}`}
                  onClick={() => handleToggleExpand(character.id)}
                >
                  <div className="asset-card-header">
                    <div className="asset-avatar character-avatar">
                      {character.name.charAt(0)}
                    </div>
                    <div className="asset-card-info">
                      <h3 className="asset-name">{character.name}</h3>
                      {character.alias && <span className="asset-alias text-secondary">{character.alias}</span>}
                    </div>
                    {character.isVariant && <span className="badge badge-warning">变体</span>}
                    <div className="asset-card-actions">
                      <button className="btn btn-sm asset-copy-btn" onClick={(event) => { event.stopPropagation(); handleCopy(character.promptText, character.name) }}>
                        📋
                      </button>
                      <button className="btn btn-sm" onClick={(event) => { event.stopPropagation(); void handleUploadImage('character', character.name) }} disabled={!canUploadImages}>
                        🖼️
                      </button>
                      {isEditing ? (
                        <>
                          <button className="btn btn-sm btn-primary" onClick={(event) => { event.stopPropagation(); void handleSave('character', character.name) }}>
                            💾
                          </button>
                          <button className="btn btn-sm" onClick={(event) => { event.stopPropagation(); handleCancelEdit() }}>
                            ✕
                          </button>
                        </>
                      ) : (
                        <button className="btn btn-sm" onClick={(event) => { event.stopPropagation(); handleStartEdit(character.id, character.promptText) }}>
                          ✏️
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="asset-card-body">
                      <textarea
                        className="asset-edit-textarea"
                        value={editText}
                        onChange={(event) => handleEditTextChange(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        spellCheck={false}
                      />
                    </div>
                  ) : (
                    <div className="asset-card-body">
                      <p className="asset-prompt-preview">
                        {renderPromptPreview(character.promptText, isExpanded)}
                      </p>
                    </div>
                  )}

                  {character.referenceImagePath && !character.referenceImagePath.startsWith('http') && !character.referenceImagePath.startsWith('data:') ? (
                    <div className="asset-card-meta text-secondary">网页端不直接展示本地参考图路径</div>
                  ) : character.referenceImagePath ? (
                    <div className="asset-card-image">
                      <img src={character.referenceImagePath} alt={character.name} />
                    </div>
                  ) : null}

                  <div className="asset-card-meta text-secondary">
                    {character.age && <span>年龄: {character.age}</span>}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {tab === 'scenes' && (
        <div className="asset-grid">
          {filteredScenes.length === 0 ? (
            <div className="asset-empty text-secondary">暂无场景素材。请确认 assets/scene-prompts.md 存在。</div>
          ) : (
            filteredScenes.map((scene) => {
              const isExpanded = expandedId === scene.id
              const isEditing = editingId === scene.id
              return (
                <div
                  key={scene.id}
                  className={`card asset-card scene-card ${isExpanded ? 'expanded' : ''}`}
                  onClick={() => handleToggleExpand(scene.id)}
                >
                  <div className="asset-card-header">
                    <div className="asset-avatar scene-avatar">
                      {scene.name.charAt(0)}
                    </div>
                    <div className="asset-card-info">
                      <h3 className="asset-name">{scene.name}</h3>
                      {scene.timeOfDay && (
                        <span className="asset-alias text-secondary">{scene.timeOfDay}</span>
                      )}
                    </div>
                    <div className="asset-card-actions">
                      <button className="btn btn-sm asset-copy-btn" onClick={(event) => { event.stopPropagation(); handleCopy(scene.promptText, scene.name) }}>
                        📋
                      </button>
                      <button className="btn btn-sm" onClick={(event) => { event.stopPropagation(); void handleUploadImage('scene', scene.name) }} disabled={!canUploadImages}>
                        🖼️
                      </button>
                      {isEditing ? (
                        <>
                          <button className="btn btn-sm btn-primary" onClick={(event) => { event.stopPropagation(); void handleSave('scene', scene.name) }}>
                            💾
                          </button>
                          <button className="btn btn-sm" onClick={(event) => { event.stopPropagation(); handleCancelEdit() }}>
                            ✕
                          </button>
                        </>
                      ) : (
                        <button className="btn btn-sm" onClick={(event) => { event.stopPropagation(); handleStartEdit(scene.id, scene.promptText) }}>
                          ✏️
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="asset-card-body">
                      <textarea
                        className="asset-edit-textarea"
                        value={editText}
                        onChange={(event) => handleEditTextChange(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        spellCheck={false}
                      />
                    </div>
                  ) : (
                    <div className="asset-card-body">
                      <p className="asset-prompt-preview">
                        {renderPromptPreview(scene.promptText, isExpanded)}
                      </p>
                    </div>
                  )}

                  {scene.referenceImagePath && !scene.referenceImagePath.startsWith('http') && !scene.referenceImagePath.startsWith('data:') ? (
                    <div className="asset-card-meta text-secondary">网页端不直接展示本地参考图路径</div>
                  ) : scene.referenceImagePath ? (
                    <div className="asset-card-image">
                      <img src={scene.referenceImagePath} alt={scene.name} />
                    </div>
                  ) : null}

                  <div className="asset-card-meta text-secondary">
                    {scene.atmosphere && <span>氛围: {scene.atmosphere}</span>}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

export default memo(AssetWorkspaceView)
