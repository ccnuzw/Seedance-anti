import type { ReactNode } from 'react'

interface DocumentEditorToolbarProps {
  title: string
  lineCount: number
  description: string
  saved: boolean
  actions: ReactNode
}

export default function DocumentEditorToolbar(
  props: DocumentEditorToolbarProps
) {
  const { title, lineCount, description, saved, actions } = props

  return (
    <div className="editor-toolbar">
      <div className="editor-info">
        <span className="editor-episode">{title}</span>
        <span className="text-secondary">{lineCount} 行</span>
        <span className="text-secondary">{description}</span>
        {!saved && (
          <span className="editor-unsaved badge badge-warning">未保存</span>
        )}
      </div>
      <div className="editor-actions">{actions}</div>
    </div>
  )
}
