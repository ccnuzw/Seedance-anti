interface DocumentEditorShellProps {
  content: string
  onChange: (value: string) => void
  label: string
  readOnly: boolean
  onSave: () => Promise<unknown>
}

export default function DocumentEditorShell(props: DocumentEditorShellProps) {
  const { content, onChange, label, readOnly, onSave } = props

  return (
    <div className="editor-container plain-editor-wrapper">
      <textarea
        className="plain-markdown-editor"
        aria-label={label}
        readOnly={readOnly}
        aria-busy={readOnly}
        onKeyDown={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === 's'
          ) {
            event.preventDefault()
            if (!readOnly) void onSave()
          }
        }}
        value={content}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
      />
    </div>
  )
}
