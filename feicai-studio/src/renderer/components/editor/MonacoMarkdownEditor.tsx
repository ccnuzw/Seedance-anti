import Editor, { loader } from '@monaco-editor/react'

interface MonacoMarkdownEditorProps {
  value: string
  onChange: (value: string | undefined) => void
}

let monacoConfigured = false

function ensureMonacoConfigured() {
  if (monacoConfigured || typeof window === 'undefined') return
  const baseUrl = import.meta.env.BASE_URL || '/'
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`

  loader.config({
    paths: {
      // Must resolve from app root, not from the current route like /project/.../writing/scripts.
      vs: new URL(`${normalizedBase}vendor/monaco/vs`, window.location.origin).toString()
    }
  })
  monacoConfigured = true
}

ensureMonacoConfigured()

export default function MonacoMarkdownEditor({
  value,
  onChange
}: MonacoMarkdownEditorProps) {
  return (
    <Editor
      height="100%"
      language="markdown"
      theme="vs-dark"
      value={value}
      keepCurrentModel
      onChange={onChange}
      loading={<div className="text-secondary" style={{ padding: 16 }}>编辑器加载中...</div>}
      options={{
        minimap: { enabled: false },
        fontSize: 16,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        lineNumbers: 'on',
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        padding: { top: 12, bottom: 12 },
        renderWhitespace: 'none',
        automaticLayout: true,
        tabSize: 2
      }}
    />
  )
}
