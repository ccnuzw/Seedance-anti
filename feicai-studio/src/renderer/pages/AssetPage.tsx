import { useState, useEffect, useCallback } from 'react'
import { IPC } from '@shared/ipc-channels'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { useToastStore } from '@renderer/stores/toastStore'
import type { Character, Scene } from '@shared/types'
import './AssetPage.css'

type AssetTab = 'characters' | 'scenes'

export default function AssetPage() {
  useProjectSync()
  const { currentProject } = useProjectStore()
  const addToast = useToastStore(s => s.addToast)
  const [tab, setTab] = useState<AssetTab>('characters')
  const [characters, setCharacters] = useState<Character[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  useEffect(() => {
    if (currentProject) loadAssets()
  }, [currentProject])

  const loadAssets = async () => {
    if (!currentProject) return
    const chars = await window.feicaiAPI.invoke(IPC.ASSET_LIST_CHARACTERS, currentProject.projectPath) as Character[]
    const scns = await window.feicaiAPI.invoke(IPC.ASSET_LIST_SCENES, currentProject.projectPath) as Scene[]
    setCharacters(chars)
    setScenes(scns)
  }

  const filteredCharacters = characters.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  )
  const filteredScenes = scenes.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleCopy = useCallback((text: string, name: string) => {
    navigator.clipboard.writeText(text)
    addToast('success', `已复制 ${name} 提示词`)
  }, [addToast])

  const toggleExpand = (id: string) => {
    if (editingId) return // 编辑中不允许切换
    setExpandedId(prev => prev === id ? null : id)
  }

  const startEdit = (id: string, currentText: string) => {
    setEditingId(id)
    setEditText(currentText)
    setExpandedId(id)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditText('')
  }

  const handleSave = useCallback(async (assetType: 'character' | 'scene', assetName: string) => {
    if (!currentProject) return
    try {
      const result = await window.feicaiAPI.invoke('asset:update-prompt', {
        projectPath: currentProject.projectPath,
        assetType,
        assetName,
        newPromptText: editText
      }) as { success: boolean; error?: string }

      if (result.success) {
        addToast('success', `${assetName} 提示词已保存`)
        setEditingId(null)
        setEditText('')
        await loadAssets() // 重新加载
      } else {
        addToast('error', result.error || '保存失败')
      }
    } catch {
      addToast('error', '保存失败')
    }
  }, [currentProject, editText, addToast])

  const renderCardActions = (id: string, name: string, promptText: string, assetType: 'character' | 'scene') => (
    <div className="asset-card-actions">
      <button className="btn btn-sm asset-copy-btn" onClick={(e) => { e.stopPropagation(); handleCopy(promptText, name) }}>
        📋
      </button>
      {editingId === id ? (
        <>
          <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); handleSave(assetType, name) }}>
            💾
          </button>
          <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); cancelEdit() }}>
            ✕
          </button>
        </>
      ) : (
        <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); startEdit(id, promptText) }}>
          ✏️
        </button>
      )}
    </div>
  )

  const renderCardBody = (id: string, promptText: string) => {
    if (editingId === id) {
      return (
        <div className="asset-card-body">
          <textarea
            className="asset-edit-textarea"
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onClick={e => e.stopPropagation()}
            spellCheck={false}
          />
        </div>
      )
    }
    return (
      <div className="asset-card-body">
        <p className="asset-prompt-preview">
          {expandedId === id ? promptText : promptText.substring(0, 120) + '...'}
        </p>
      </div>
    )
  }

  return (
    <div className="asset-page">
      <div className="asset-tabs">
        <button
          className={`tab-btn ${tab === 'characters' ? 'active' : ''}`}
          onClick={() => setTab('characters')}
        >
          👤 角色 <span className="tab-count">{characters.length}</span>
        </button>
        <button
          className={`tab-btn ${tab === 'scenes' ? 'active' : ''}`}
          onClick={() => setTab('scenes')}
        >
          🏞️ 场景 <span className="tab-count">{scenes.length}</span>
        </button>
        <div className="tab-spacer" />
        <input
          className="input asset-search"
          placeholder="搜索素材..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {tab === 'characters' && (
        <div className="asset-grid">
          {filteredCharacters.length === 0 ? (
            <div className="asset-empty text-secondary">暂无角色素材。请确认 assets/character-prompts.md 存在。</div>
          ) : (
            filteredCharacters.map((char) => (
              <div key={char.id} className={`card asset-card character-card ${expandedId === char.id ? 'expanded' : ''}`}
                onClick={() => toggleExpand(char.id)}>
                <div className="asset-card-header">
                  <div className="asset-avatar character-avatar">
                    {char.name.charAt(0)}
                  </div>
                  <div className="asset-card-info">
                    <h3 className="asset-name">{char.name}</h3>
                    {char.alias && <span className="asset-alias text-secondary">{char.alias}</span>}
                  </div>
                  {char.isVariant && <span className="badge badge-warning">变体</span>}
                  {renderCardActions(char.id, char.name, char.promptText, 'character')}
                </div>
                {renderCardBody(char.id, char.promptText)}
                {char.referenceImagePath && (
                  <div className="asset-card-image">
                    <img src={`file://${char.referenceImagePath}`} alt={char.name} />
                  </div>
                )}
                <div className="asset-card-meta text-secondary">
                  {char.age && <span>年龄: {char.age}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'scenes' && (
        <div className="asset-grid">
          {filteredScenes.length === 0 ? (
            <div className="asset-empty text-secondary">暂无场景素材。请确认 assets/scene-prompts.md 存在。</div>
          ) : (
            filteredScenes.map((scene) => (
              <div key={scene.id} className={`card asset-card scene-card ${expandedId === scene.id ? 'expanded' : ''}`}
                onClick={() => toggleExpand(scene.id)}>
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
                  {renderCardActions(scene.id, scene.name, scene.promptText, 'scene')}
                </div>
                {renderCardBody(scene.id, scene.promptText)}
                {scene.referenceImagePath && (
                  <div className="asset-card-image">
                    <img src={`file://${scene.referenceImagePath}`} alt={scene.name} />
                  </div>
                )}
                <div className="asset-card-meta text-secondary">
                  {scene.atmosphere && <span>氛围: {scene.atmosphere}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
