import type {
  ImportedBlock,
  ImportedDocument,
  ImportedInline,
  ImportedList,
  ImportedListItem,
  ImportedParagraph,
  ImportedParagraphBase,
  ImportedTable,
  ImportedTableCell,
  ImportedText,
} from './model.js'

const ALLOWED_HREF_RE = /^(?:https?:|mailto:)/i

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value.replace(/[\r\n\t]/g, ''))
}

function safeHref(value: string): string | undefined {
  const href = value.trim()
  if (!ALLOWED_HREF_RE.test(href)) return undefined
  return href
}

function inlineStyle(text: ImportedText): string {
  const styles: string[] = []
  if (text.color) styles.push('color:' + text.color)
  if (text.backgroundColor) styles.push('background-color:' + text.backgroundColor)
  if (text.fontSizePt && text.fontSizePt >= 6 && text.fontSizePt <= 72) {
    styles.push('font-size:' + text.fontSizePt + 'pt')
  }
  if (text.fontFamily) {
    styles.push('font-family:' + text.fontFamily.split(',')[0]!.replace(/[;"<>]/g, ''))
  }
  return styles.join(';')
}

function renderText(text: ImportedText): string {
  let value = escapeHtml(text.text)
    .replace(/\n/g, '<br />')

  const marks = new Set(text.marks)
  if (marks.has('bold')) value = '<strong>' + value + '</strong>'
  if (marks.has('italic')) value = '<em>' + value + '</em>'
  if (marks.has('underline')) value = '<u>' + value + '</u>'
  if (marks.has('strike')) value = '<s>' + value + '</s>'
  if (marks.has('superscript')) value = '<sup>' + value + '</sup>'
  if (marks.has('subscript')) value = '<sub>' + value + '</sub>'

  const style = inlineStyle(text)
  return style ? '<span style="' + escapeAttribute(style) + '">' + value + '</span>' : value
}

function renderInline(
  inline: ImportedInline,
  resolveImage?: (key: string) => { id: string; alt?: string } | undefined,
): string {
  if (inline.kind === 'text') return renderText(inline)

  if (inline.kind === 'inlineImage') {
    const resolved = resolveImage?.(inline.image.mediaKey)
    if (!resolved) return escapeHtml(inline.image.alt ?? 'Word image')
    const alt = escapeAttribute(resolved.alt ?? inline.image.alt ?? 'Imported image')
    return '<img data-lexical-upload-id="' + escapeAttribute(resolved.id) +
      '" data-lexical-upload-relation-to="media" alt="' + alt +
      '" style="display:inline-block;max-width:100%;height:auto" />'
  }

  const href = safeHref(inline.href)
  const content = inline.children.map(renderText).join('')
  if (!href) return content
  return '<a href="' + escapeAttribute(href) + '" rel="noreferrer noopener">' + content + '</a>'
}

function paragraphStyle(style: ImportedParagraphBase['style']): string {
  if (!style) return ''
  const rules: string[] = []
  if (style.align) rules.push('text-align:' + style.align)
  if (style.firstLineIndentPt && Math.abs(style.firstLineIndentPt) <= 36) {
    rules.push('text-indent:' + style.firstLineIndentPt + 'pt')
  }
  if (style.leftIndentPt && style.leftIndentPt <= 72) rules.push('padding-left:' + style.leftIndentPt + 'pt')
  if (style.rightIndentPt && style.rightIndentPt <= 72) rules.push('padding-right:' + style.rightIndentPt + 'pt')
  if (style.spacingBeforePt && style.spacingBeforePt <= 48) rules.push('margin-top:' + style.spacingBeforePt + 'pt')
  if (style.spacingAfterPt && style.spacingAfterPt <= 48) rules.push('margin-bottom:' + style.spacingAfterPt + 'pt')
  if (style.lineHeight && style.lineHeight >= 0.8 && style.lineHeight <= 3) {
    rules.push('line-height:' + style.lineHeight)
  }
  return rules.join(';')
}

function renderParagraph(
  block: ImportedParagraphBase,
  tag = 'p',
  extraClass = '',
  resolveImage?: (key: string) => { id: string; alt?: string } | undefined,
): string {
  const style = paragraphStyle(block.style)
  const classAttr = extraClass ? ' class="' + escapeAttribute(extraClass) + '"' : ''
  const styleAttr = style ? ' style="' + escapeAttribute(style) + '"' : ''
  return '<' + tag + classAttr + styleAttr + '>' +
    block.inlines.map((inline) => renderInline(inline, resolveImage)).join('') +
    '</' + tag + '>'
}
function renderNestedList(
  items: ImportedListItem[],
  start = 0,
  level = 0,
  resolveImage?: (key: string) => { id: string; alt?: string } | undefined,
): { html: string; next: number } {
  if (start >= items.length) return { html: '', next: start }
  const ordered = items[start]!.ordered
  const tag = ordered ? 'ol' : 'ul'
  let html = '<' + tag + ' class="lr-word-list" data-level="' + String(level) + '">'

  let index = start
  while (index < items.length) {
    const item = items[index]!
    if (item.level < level) break
    if (item.level > level) {
      const nested = renderNestedList(items, index, level + 1, resolveImage)
      html += nested.html
      index = nested.next
      continue
    }
    if (item.ordered !== ordered) break

    html += '<li>' + item.inlines.map((inline) => renderInline(inline, resolveImage)).join('')
    if (index + 1 < items.length && items[index + 1]!.level > level) {
      const nested = renderNestedList(items, index + 1, level + 1, resolveImage)
      html += nested.html
      index = nested.next
    } else {
      index += 1
    }
    html += '</li>'
  }

  html += '</' + tag + '>'
  return { html, next: index }
}

function renderList(
  list: ImportedList,
  resolveImage?: (key: string) => { id: string; alt?: string } | undefined,
): string {
  return renderNestedList(list.items, 0, 0, resolveImage).html
}

function renderTableCell(
  cell: ImportedTableCell,
  resolveImage?: (key: string) => { id: string; alt?: string } | undefined,
): string {
  const attrs: string[] = []
  if (cell.colSpan && cell.colSpan > 1) attrs.push(' colspan="' + String(cell.colSpan) + '"')
  if (cell.rowSpan && cell.rowSpan > 1) attrs.push(' rowspan="' + String(cell.rowSpan) + '"')
  if (cell.header) attrs.push(' scope="col"')
  const style: string[] = ['overflow-wrap:anywhere', 'word-break:break-word']
  if (cell.backgroundColor) style.push('background-color:' + cell.backgroundColor)
  if (cell.align) style.push('text-align:' + cell.align)
  if (cell.verticalAlign) style.push('vertical-align:' + cell.verticalAlign)
  if (cell.widthPx && cell.widthPx > 0) style.push('width:' + Math.min(cell.widthPx, 1600) + 'px')
  attrs.push(' style="' + escapeAttribute(style.join(';')) + '"')
  const tag = cell.header ? 'th' : 'td'
  return '<' + tag + attrs.join('') + '>' + renderBlocks(cell.blocks, resolveImage) + '</' + tag + '>'
}

function renderTable(
  table: ImportedTable,
  resolveImage?: (key: string) => { id: string; alt?: string } | undefined,
): string {
  const rows = table.rows
    .map((row) => '<tr>' + row.map((cell) => renderTableCell(cell, resolveImage)).join('') + '</tr>')
    .join('')
  return '<div class="lr-word-table-wrap" style="width:100%;overflow-x:auto">' +
    '<table style="width:100%;max-width:100%;border-collapse:collapse;table-layout:fixed">' +
    '<tbody>' + rows + '</tbody></table></div>'
}

export function renderBlocks(
  blocks: ImportedBlock[],
  resolveImage?: (key: string) => { id: string; alt?: string } | undefined,
): string {
  return blocks.map((block) => {
    if (block.kind === 'paragraph') return renderParagraph(block, 'p', '', resolveImage)
    if (block.kind === 'heading') return renderParagraph(block, 'h' + block.level, '', resolveImage)
    if (block.kind === 'list') return renderList(block, resolveImage)
    if (block.kind === 'listItem') return '<p>' + block.inlines.map((inline) => renderInline(inline, resolveImage)).join('') + '</p>'
    if (block.kind === 'table') return renderTable(block, resolveImage)
    if (block.kind === 'image') {
      const resolved = resolveImage?.(block.mediaKey)
      if (!resolved) {
        return '<p>' + escapeHtml(block.alt ?? 'Word image') + '</p>'
      }
      const alt = escapeAttribute(resolved.alt ?? block.alt ?? 'Imported image')
      const width = block.widthPx && block.widthPx > 0 ? String(Math.min(block.widthPx, 1600)) : undefined
      const widthAttr = width ? ' width="' + width + '"' : ''
      return '<img data-lexical-upload-id="' + escapeAttribute(resolved.id) +
        '" data-lexical-upload-relation-to="media" alt="' + alt + '"' + widthAttr +
        ' style="display:block;max-width:100%;height:auto;margin:16px auto" />'
    }
    return renderTable(block)
  }).join('')
}

export function renderImportedDocument(
  document: ImportedDocument,
  resolveImage?: (key: string) => { id: string; alt?: string } | undefined,
): string {
  return renderBlocks(document.blocks, resolveImage)
}
