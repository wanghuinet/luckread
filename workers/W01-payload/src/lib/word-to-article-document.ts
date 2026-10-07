import * as mammoth from 'mammoth'
import {
  ARTICLE_MAX_BLOCKS,
  ARTICLE_MAX_BLOCK_TEXT,
  ARTICLE_TABLE_MAX_CELL_TEXT,
  ARTICLE_TABLE_MAX_COLUMNS,
  ARTICLE_TABLE_MAX_ROWS,
  createArticleBlock,
  createArticleTableBlock,
  type ArticleBlock,
} from './article-document.js'

const MAX_WORD_BYTES = 10 * 1024 * 1024

export type WordImportResult = {
  document: ArticleDocument
  importedBlocks: number
  warnings: string[]
  unsupported: string[]
}

const textOf = (element: Element): string =>
  (element.textContent ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim()

const blockText = (value: string): string => value.slice(0, ARTICLE_MAX_BLOCK_TEXT)

function parseTable(table: Element): ArticleBlock | null {
  const rows = Array.from(table.querySelectorAll('tr'))
  if (!rows.length) return null

  const cells = rows.map((row) =>
    Array.from(row.children)
      .filter((cell) => cell.tagName.toLowerCase() === 'td' || cell.tagName.toLowerCase() === 'th')
      .map((cell) => textOf(cell).slice(0, ARTICLE_TABLE_MAX_CELL_TEXT)),
  )
  const width = Math.max(...cells.map((row) => row.length), 0)
  if (!width || width > ARTICLE_TABLE_MAX_COLUMNS || cells.length > ARTICLE_TABLE_MAX_ROWS + 1) {
    return null
  }

  const normalized = cells.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''))
  return createArticleTableBlock(normalized[0] ?? ['列 1'], normalized.slice(1))
}

function parseHtml(html: string): { blocks: ArticleBlock[]; unsupported: string[] } {
  const parser = new DOMParser()
  const root = parser.parseFromString('<div>' + html + '</div>', 'text/html').body.firstElementChild
  if (!root) throw new Error('ARTICLE_WORD_EMPTY')

  const blocks: ArticleBlock[] = []
  const unsupported = new Set<string>()

  const push = (block: ArticleBlock | null) => {
    if (!block || blocks.length >= ARTICLE_MAX_BLOCKS) return
    blocks.push(block)
  }

  for (const node of Array.from(root.children)) {
    const tag = node.tagName.toLowerCase()
    const text = blockText(textOf(node))
    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
      if (text) push(createArticleBlock('heading', text))
      continue
    }
    if (tag === 'p') {
      if (node.querySelector('img')) unsupported.add('图片')
      if (text) push(createArticleBlock('paragraph', text))
      continue
    }
    if (tag === 'blockquote') {
      if (text) push(createArticleBlock('quote', text))
      continue
    }
    if (tag === 'ul' || tag === 'ol') {
      if (node.querySelector('img')) unsupported.add('图片')
      const items = Array.from(node.querySelectorAll(':scope > li')).map(textOf).filter(Boolean)
      if (items.length) push(createArticleBlock(tag === 'ul' ? 'bulletList' : 'orderedList', items.join('\n')))
      continue
    }
    if (tag === 'hr') {
      push(createArticleBlock('divider'))
      continue
    }
    if (tag === 'table') {
      const table = parseTable(node)
      if (table) push(table)
      else unsupported.add('复杂表格')
      continue
    }
    if (node.querySelector('img')) unsupported.add('图片')
    if (text) push(createArticleBlock('paragraph', text))
  }

  if (root.querySelector('a')) {
    // Links are intentionally flattened to text because ArticleDocument v2 has no inline link node.
    unsupported.add('行内链接')
  }
  if (root.querySelector('video, audio, iframe, object, embed')) {
    unsupported.add('嵌入媒体')
  }

  return { blocks, unsupported: Array.from(unsupported) }
}

export async function wordArrayBufferToArticleDocument(
  input: ArrayBuffer,
): Promise<WordImportResult> {
  if (input.byteLength > MAX_WORD_BYTES) throw new Error('ARTICLE_WORD_TOO_LARGE')
  if (input.byteLength < 4) throw new Error('ARTICLE_WORD_EMPTY')

  const result = await mammoth.convertToHtml({ arrayBuffer: input })
  const parsed = parseHtml(result.value)
  if (!parsed.blocks.length) throw new Error('ARTICLE_WORD_EMPTY')

  return {
    document: {
      version: 2,
      blocks: parsed.blocks,
    },
    importedBlocks: parsed.blocks.length,
    warnings: result.messages
      .filter((message) => message.type === 'warning')
      .map((message) => message.message)
      .slice(0, 10),
    unsupported: parsed.unsupported,
  }
}

export const emptyWordImportDocument = (): ArticleDocument => createArticleDocument()
