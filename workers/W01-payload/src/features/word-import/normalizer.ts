import type {
  ImportedBlock,
  ImportedDocument,
  ImportedHeading,
  ImportedInline,
  ImportedList,
  ImportedListItem,
  ImportedParagraph,
  ImportedParagraphBase,
  ImportedText,
} from './model.js'

const CJK_RE = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/
const WRAP_END_PUNCTUATION_RE = /[。！？!?；;：:，,、。.!?]$/

function normalizeText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\v\f\r ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
}

function isLikelyWrappedLines(text: string): boolean {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length < 3) return false
  if (lines.some((line) => line.length > 80)) return false

  const withoutLast = lines.slice(0, -1)
  const punctuationEnds = withoutLast.filter((line) => WRAP_END_PUNCTUATION_RE.test(line)).length
  if (punctuationEnds > 0) return false

  const average = lines.reduce((sum, line) => sum + line.length, 0) / lines.length
  return average >= 6 && average <= 45
}

function normalizeWrappedLines(text: string): { text: string; changed: boolean } {
  const normalized = normalizeText(text)
  if (!normalized.includes('\n') || !isLikelyWrappedLines(normalized)) {
    return { text: normalized, changed: false }
  }

  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean)
  const cjkRatio =
    lines.join('').split('').filter((char) => CJK_RE.test(char)).length /
    Math.max(1, lines.join('').length)

  return {
    text: cjkRatio >= 0.45 ? lines.join('') : lines.join(' '),
    changed: true,
  }
}

function mergeAdjacentText(nodes: ImportedInline[]): ImportedInline[] {
  const result: ImportedInline[] = []
  for (const node of nodes) {
    if (node.kind !== 'text') {
      result.push(node)
      continue
    }
    if (!node.text) continue

    const previous = result[result.length - 1]
    if (
      previous?.kind === 'text' &&
      JSON.stringify(previous.marks) === JSON.stringify(node.marks) &&
      previous.color === node.color &&
      previous.backgroundColor === node.backgroundColor &&
      previous.fontSizePt === node.fontSizePt &&
      previous.fontFamily === node.fontFamily
    ) {
      previous.text += node.text
    } else {
      result.push({ ...node, marks: [...node.marks] })
    }
  }
  return result
}

function normalizeInlines(inlines: ImportedInline[], stats: ImportedDocument['stats']): ImportedInline[] {
  const result: ImportedInline[] = []

  for (const inline of inlines) {
    if (inline.kind === 'inlineImage') {
      result.push(inline)
      continue
    }

    if (inline.kind === 'link') {
      const children = normalizeInlines(inline.children, stats).filter(
        (node): node is ImportedText => node.kind === 'text',
      )
      if (children.length > 0) result.push({ ...inline, children })
      continue
    }

    const wrapped = normalizeWrappedLines(inline.text)
    if (wrapped.changed) stats.normalizedLineBreaks += 1

    const cleaned = wrapped.text
    if (!cleaned) continue

    result.push({
      ...inline,
      text: cleaned,
      marks: [...new Set(inline.marks)],
    })
  }

  return mergeAdjacentText(result)
}

function normalizeParagraph(block: ImportedParagraphBase, stats: ImportedDocument['stats']): ImportedParagraphBase {
  return {
    ...block,
    inlines: normalizeInlines(block.inlines, stats),
    ...(block.style
      ? {
          style: {
            ...block.style,
            ...(block.style.firstLineIndentPt && Math.abs(block.style.firstLineIndentPt) > 36
              ? { firstLineIndentPt: Math.sign(block.style.firstLineIndentPt) * 36 }
              : {}),
            ...(block.style.leftIndentPt && block.style.leftIndentPt > 72 ? { leftIndentPt: 72 } : {}),
            ...(block.style.rightIndentPt && block.style.rightIndentPt > 72 ? { rightIndentPt: 72 } : {}),
            ...(block.style.spacingBeforePt && block.style.spacingBeforePt > 48 ? { spacingBeforePt: 48 } : {}),
            ...(block.style.spacingAfterPt && block.style.spacingAfterPt > 48 ? { spacingAfterPt: 48 } : {}),
          },
        }
      : {}),
  }
}

function normalizeHeading(block: ImportedHeading, stats: ImportedDocument['stats']): ImportedHeading {
  const normalized = normalizeParagraph(block, stats)
  return {
    ...normalized,
    kind: 'heading',
    level: Math.max(1, Math.min(6, block.level)) as ImportedHeading['level'],
  }
}

function normalizeListItem(block: ImportedListItem, stats: ImportedDocument['stats']): ImportedListItem {
  return {
    ...block,
    level: Math.max(0, Math.min(8, block.level)),
    inlines: normalizeInlines(block.inlines, stats),
  }
}

function hasVisibleContent(block: ImportedBlock): boolean {
  if (block.kind === 'image' || block.kind === 'table') return true
  if (block.kind === 'list') return block.items.length > 0
  if (block.kind === 'listItem') {
    return block.inlines.some((inline) => {
      if (inline.kind === 'inlineImage') return true
      return inline.kind === 'text'
        ? inline.text.trim().length > 0
        : inline.children.some((child) => child.text.trim().length > 0)
    })
  }
  return block.inlines.some((inline) => {
    if (inline.kind === 'inlineImage') return true
    return inline.kind === 'text'
      ? inline.text.trim().length > 0
      : inline.children.some((child) => child.text.trim().length > 0)
  })
}

function groupLists(blocks: ImportedBlock[]): ImportedBlock[] {
  const result: ImportedBlock[] = []
  let current: ImportedList | undefined

  const flush = (): void => {
    if (current && current.items.length > 0) result.push(current)
    current = undefined
  }

  for (const block of blocks) {
    if (block.kind !== 'listItem') {
      flush()
      result.push(block)
      continue
    }

    if (!current || current.items[0]?.ordered !== block.ordered) {
      flush()
      current = { kind: 'list', items: [] }
    }
    current.items.push(block)
  }

  flush()
  return result
}

function normalizeBlock(block: ImportedBlock, stats: ImportedDocument['stats']): ImportedBlock {
  if (block.kind === 'paragraph') return { ...normalizeParagraph(block, stats), kind: 'paragraph' }
  if (block.kind === 'heading') return normalizeHeading(block, stats)
  if (block.kind === 'listItem') return normalizeListItem(block, stats)
  if (block.kind === 'list') {
    return {
      kind: 'list',
      items: block.items.map((item) => normalizeListItem(item, stats)),
    }
  }
  if (block.kind === 'image') {
    const maxWidth = 1600
    if (block.widthPx && block.widthPx > maxWidth) {
      stats.normalizedWideMedia += 1
      return { ...block, widthPx: maxWidth }
    }
    return block
  }

  return {
    ...block,
    rows: block.rows.map((row) =>
      row.map((cell) => ({
        ...cell,
        colSpan: cell.colSpan && cell.colSpan > 12 ? 12 : cell.colSpan,
        rowSpan: cell.rowSpan && cell.rowSpan > 100 ? 100 : cell.rowSpan,
        blocks: groupLists(cell.blocks.map((nested) => normalizeBlock(nested, stats))),
      })),
    ),
    ...(block.widthPx && block.widthPx > 1600 ? { widthPx: 1600 } : {}),
  }
}

export function normalizeImportedDocument(document: ImportedDocument): ImportedDocument {
  const stats = { ...document.stats, normalizedLineBreaks: 0, normalizedWideMedia: 0 }
  const normalized = document.blocks.map((block) => normalizeBlock(block, stats))
  const grouped = groupLists(normalized)

  const blocks: ImportedBlock[] = []
  let previousWasEmpty = false

  for (const block of grouped) {
    const visible = hasVisibleContent(block)
    if (!visible) {
      if (previousWasEmpty) {
        stats.normalizedLineBreaks += 1
        continue
      }
      previousWasEmpty = true
    } else {
      previousWasEmpty = false
    }
    blocks.push(block)
  }

  return {
    blocks,
    warnings: document.warnings,
    stats,
  }
}
