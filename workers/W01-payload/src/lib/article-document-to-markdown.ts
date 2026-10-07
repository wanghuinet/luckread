import { toMarkdown } from 'mdast-util-to-markdown'
import {
  normalizeArticleDocument,
  type ArticleBlock,
  type ArticleDocument,
} from './article-document.js'

const textNode = (value: string) => ({
  type: 'text' as const,
  value,
})

const root = (children: unknown[]) => ({
  type: 'root' as const,
  children,
})

const serializeRoot = (children: unknown[]): string =>
  toMarkdown(root(children) as Parameters<typeof toMarkdown>[0]).trim()

const serializeTableCell = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')

const serializeTable = (block: ArticleBlock): string => {
  const table = block.table
  if (!table) return ''
  const header = '| ' + table.headers.map(serializeTableCell).join(' | ') + ' |'
  const divider = '| ' + table.headers.map(() => '---').join(' | ') + ' |'
  const rows = table.rows.map(
    (row) => '| ' + row.map(serializeTableCell).join(' | ') + ' |',
  )
  return [header, divider, ...rows].join('\n')
}

const serializeBlock = (block: ArticleBlock): string => {
  switch (block.type) {
    case 'paragraph':
      return serializeRoot([
        { type: 'paragraph', children: [textNode(block.text)] },
      ])

    case 'heading':
      return serializeRoot([
        {
          type: 'heading',
          depth: block.level === 3 ? 3 : 2,
          children: [textNode(block.text)],
        },
      ])

    case 'quote':
      return serializeRoot([
        {
          type: 'blockquote',
          children: [
            { type: 'paragraph', children: [textNode(block.text)] },
          ],
        },
      ])

    case 'bulletList':
    case 'orderedList': {
      const children = block.text
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => ({
          type: 'listItem' as const,
          spread: false,
          children: [
            { type: 'paragraph' as const, children: [textNode(item)] },
          ],
        }))
      if (!children.length) return ''
      return serializeRoot([
        {
          type: 'list',
          ordered: block.type === 'orderedList',
          start: block.type === 'orderedList' ? 1 : undefined,
          spread: false,
          children,
        },
      ])
    }

    case 'divider':
      return serializeRoot([{ type: 'thematicBreak' }])

    case 'code':
      return serializeRoot([
        {
          type: 'code',
          lang: block.language === 'plaintext' ? null : block.language ?? null,
          meta: null,
          value: block.text,
        },
      ])

    case 'image': {
      const ref = block.mediaRefs?.[0]
      if (!ref) return ''
      return serializeRoot([
        {
          type: 'image',
          title: null,
          url: ref,
          alt: block.text || null,
        },
      ])
    }

    case 'gallery': {
      const images = (block.mediaRefs ?? []).map((ref) => ({
        type: 'paragraph' as const,
        children: [
          {
            type: 'image' as const,
            url: ref,
            alt: block.text || null,
          },
        ],
      }))
      const caption = block.text
        ? [{ type: 'paragraph' as const, children: [textNode(block.text)] }]
        : []
      return serializeRoot([...images, ...caption])
    }

    case 'table':
      return serializeTable(block)
  }
}

export const articleDocumentToMarkdown = (
  document: ArticleDocument,
): string => {
  const normalized = normalizeArticleDocument(document)
  const result = normalized.blocks
    .map(serializeBlock)
    .filter(Boolean)
    .join('\n\n')
    .trim()

  return result ? result + '\n' : ''
}
