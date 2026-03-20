// ============================================================
// SimpleMarkdown — 轻量 Markdown 渲染组件（零外部依赖）
// ============================================================
// 支持：标题/粗体/斜体/分隔线/引用/列表/行内代码/剧本特殊标记

import './SimpleMarkdown.css'

interface SimpleMarkdownProps {
  content: string
  className?: string
  /** 是否开启剧本模式（高亮场景/角色/音效/独白标记） */
  scriptMode?: boolean
}

export default function SimpleMarkdown({ content, className = '', scriptMode = false }: SimpleMarkdownProps) {
  if (!content) return null

  const html = renderMarkdown(content, scriptMode)

  return (
    <div
      className={`simple-md ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function renderMarkdown(md: string, scriptMode: boolean): string {
  const lines = md.split('\n')
  const result: string[] = []
  let inBlockquote = false
  let inList = false

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]

    // 空行
    if (line.trim() === '') {
      if (inBlockquote) { result.push('</blockquote>'); inBlockquote = false }
      if (inList) { result.push('</ul>'); inList = false }
      result.push('')
      continue
    }

    // 分隔线
    if (/^---+$/.test(line.trim())) {
      if (inBlockquote) { result.push('</blockquote>'); inBlockquote = false }
      if (inList) { result.push('</ul>'); inList = false }
      result.push('<hr class="md-hr" />')
      continue
    }

    // 标题
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/)
    if (headingMatch) {
      if (inBlockquote) { result.push('</blockquote>'); inBlockquote = false }
      if (inList) { result.push('</ul>'); inList = false }
      const level = headingMatch[1].length
      const text = inlineFormat(headingMatch[2], scriptMode)
      result.push(`<h${level} class="md-h${level}">${text}</h${level}>`)
      continue
    }

    // 引用
    if (line.startsWith('> ') || line.startsWith('>')) {
      const text = inlineFormat(line.replace(/^>\s?/, ''), scriptMode)
      if (!inBlockquote) { result.push('<blockquote class="md-blockquote">'); inBlockquote = true }
      result.push(`<p>${text}</p>`)
      continue
    } else if (inBlockquote) {
      result.push('</blockquote>')
      inBlockquote = false
    }

    // 列表
    if (/^\s*[-*]\s+/.test(line)) {
      const text = inlineFormat(line.replace(/^\s*[-*]\s+/, ''), scriptMode)
      if (!inList) { result.push('<ul class="md-ul">'); inList = true }
      result.push(`<li>${text}</li>`)
      continue
    } else if (inList) {
      result.push('</ul>')
      inList = false
    }

    // 剧本模式的特殊处理
    if (scriptMode) {
      // 场景标记：※ 场景名
      if (line.startsWith('※')) {
        result.push(`<div class="md-scene-header">${escapeHtml(line)}</div>`)
        continue
      }

      // 舞台指示：△ 动作描述
      if (line.startsWith('△')) {
        result.push(`<div class="md-stage-direction">${inlineFormat(line, scriptMode)}</div>`)
        continue
      }

      // 角色对白：角色名（情绪）："台词"
      const dialogMatch = line.match(/^(.+?)[（(](.+?)[)）][：:]\s*["「]?(.+?)["」]?\s*$/)
      if (dialogMatch) {
        result.push(
          `<div class="md-dialog">` +
          `<span class="md-dialog-name">${escapeHtml(dialogMatch[1])}</span>` +
          `<span class="md-dialog-emotion">（${escapeHtml(dialogMatch[2])}）</span>` +
          `<span class="md-dialog-line">"${inlineFormat(dialogMatch[3], false)}"</span>` +
          `</div>`
        )
        continue
      }

      // 角色对白（无引号）：角色名（情绪）：台词
      const dialog2Match = line.match(/^(.+?)[（(](.+?)[)）][：:]\s*(.+)$/)
      if (dialog2Match) {
        result.push(
          `<div class="md-dialog">` +
          `<span class="md-dialog-name">${escapeHtml(dialog2Match[1])}</span>` +
          `<span class="md-dialog-emotion">（${escapeHtml(dialog2Match[2])}）</span>` +
          `<span class="md-dialog-line">${inlineFormat(dialog2Match[3], false)}</span>` +
          `</div>`
        )
        continue
      }

      // 特殊标记行：【独白】【特效】【音效】【系统面板】【慢动作】【卡黑】
      const tagMatch = line.match(/^【(.+?)】(.*)$/)
      if (tagMatch) {
        const tagType = tagMatch[1]
        const tagContent = tagMatch[2]
        const tagClass = getTagClass(tagType)
        result.push(
          `<div class="md-special-tag ${tagClass}">` +
          `<span class="md-tag-label">【${escapeHtml(tagType)}】</span>` +
          `${tagContent ? `<span class="md-tag-content">${inlineFormat(tagContent, false)}</span>` : ''}` +
          `</div>`
        )
        continue
      }
    }

    // 普通段落
    result.push(`<p class="md-p">${inlineFormat(line, scriptMode)}</p>`)
  }

  if (inBlockquote) result.push('</blockquote>')
  if (inList) result.push('</ul>')

  return result.join('\n')
}

function getTagClass(tagType: string): string {
  if (['独白'].includes(tagType)) return 'tag-monologue'
  if (['特效', '慢动作', '卡黑'].includes(tagType)) return 'tag-effect'
  if (['音效'].includes(tagType)) return 'tag-sfx'
  if (['系统面板'].includes(tagType)) return 'tag-system'
  return 'tag-default'
}

function inlineFormat(text: string, scriptMode: boolean): string {
  let result = escapeHtml(text)

  // 粗体 **text**
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  // 斜体 *text*
  result = result.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>')

  // 行内代码 `text`
  result = result.replace(/`([^`]+?)`/g, '<code class="md-code">$1</code>')

  if (scriptMode) {
    // 剧本特殊标记内联高亮
    result = result.replace(/【(.+?)】/g, '<span class="md-inline-tag">【$1】</span>')
  }

  return result
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
