interface DocumentEditorShellProps {
  content: string
  onChange: (value: string) => void
}

export default function DocumentEditorShell(props: DocumentEditorShellProps) {
  const { content, onChange } = props

  return (
    <div className="editor-container plain-editor-wrapper">
      <textarea
        className="plain-markdown-editor"
        value={content}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
      />
    </div>
  )
}
