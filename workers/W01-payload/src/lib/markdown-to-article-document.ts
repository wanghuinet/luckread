import { marked } from 'marked'
import {
  ARTICLE_MAX_BLOCKS,
  ARTICLE_MAX_BLOCK_TEXT,
  createArticleBlock,
  createArticleMediaBlock,
  normalizeArticleDocument,
  type ArticleBlock,
  type ArticleDocument,
} from './article-document.js'

export const ARTICLE_MARKDOWN_MAX_CHARS = 100_000

export type MarkdownImportResult = {
  document: ArticleDocument
  importedBlocks: number
  unsupported: string[]
}

const INLINE_LINK_PATTERN = /!?\\[[^\\]]*\\]\\([^)]*\\)/
const REFERENCE_LINK_PATTERN = /\\[[^\\]]+\\]\\[[^\\]]*\\]/

const stripInlineMarkdown = (value: string): string =>
  value
    .replace(/<[^>]+>/g, '')
    .replace(/!\\[([^\\]]*)\\]\\([^)]*\\)/g, '$1')
    .replace(/\\[([^\\]]+)\\]\\([^)]*\\)/g, '$1')
    .replace(/\\[([^\\]]+)\\]\\[[^\\]]*\\]/g, '$1')
    .replace(/\\\\([\\\\\x60*_{}\\[\\]()#+.!<>-])/g, '$1')
    .replace(/(^|\\s)(\\*\\*|__)(?=\\S)/g, '$1')
    .replace(/(\\*\\*|__)(?=\\s|$)/g, '')
    .replace(/(^|\\s)(\\*|_|~~)(?=\\S)/g, '$1')
    .replace(/(\\*|_|~~)(?=\\s|$)/g, '')
    .replace(/\\x60/g, '')
    .replace(/[ \\t]+\\n/g, '\\n')
    .replace(/\\n{3,}/g, '\\n\\n')
    .trim()

const safeText = (value: string): string =>
  value.slice(0, ARTICLE_MAX_BLOCK_TEXT)

const pushBlock = (blocks: ArticleBlock[], block: ArticleBlock): void => {
  if (blocks.length < ARTICLE_MAX_BLOCKS) blocks.push(block)
}

const pushUnsupported = (unsupported: string[], kind: string): void => {
  if (!unsupported.includes(kind)) unsupported.push(kind)
}

export const markdownToArticleDocument = (markdown: string): MarkdownImportResult => {
  const source = markdown.trim()
  if (!source) {
    return {
      document: normalizeArticleDocument({
        version: 2,
        blocks: [createArticleBlock('paragraph', '')],
      }),
      importedBlocks: 0,
      unsupported: [],
    }
  }

  if (source.length > ARTICLE_MARKDOWN_MAX_CHARS) {
    throw new Error('ARTICLE_MARKDOWN_TOO_LARGE')
  }

  const tokens = marked.lexer(source, { gfm: true, breaks: false })
  const blocks: ArticleBlock[] = []
  const unsupported: string[] = []

  for (const token of tokens) {
    if (blocks.length >= ARTICLE_MAX_BLOCKS) break

    switch (token.type) {
      case 'space':
        continue

      case 'heading': {
        const text = safeText(stripInlineMarkdown(token.text))
        if (!text) continue
        pushBlock(blocks, createArticleBlock('heading', text))
        const next = blocks[blocks.length - 1]
        if (next?.type === 'heading') {
          next.level = token.depth >= 3 ? 3 : 2
        }
        break
      }

      case 'paragraph': {
        const raw = token.text.trim()
        const imageMatch = raw.match(/^!\\[([^\\]]*)\\]\\((https?:\\/\\/[^)\\s]+)(?:\\s+[^)]*)?\\)$/)
        if (imageMatch) {
          pushBlock(
            blocks,
            createArticleMediaBlock('image', [imageMatch[2]], imageMatch[1]),
          )
          break
        }

        if (/!\\[[^\\]]*\\]\\(/.test(raw)) {
          pushUnsupported(unsupported, '内嵌图片')
          continue
        }
        if (INLINE_LINK_PATTERN.test(raw) || REFERENCE_LINK_PATTERN.test(raw)) {
          pushUnsupported(unsupported, '链接')
          continue
        }

        const text = safeText(stripInlineMarkdown(token.text))
        if (text) pushBlock(blocks, createArticleBlock('paragraph', text))
        break
      }

      case 'blockquote': {
        const text = safeText(stripInlineMarkdown(token.text))
        if (text) pushBlock(blocks, createArticleBlock('quote', text))
        break
      }

      case 'list': {
        const text = token.items
          .map((item) => safeText(stripInlineMarkdown(item.text)))
          .filter(Boolean)
          .join('\\n')
        if (!text) continue
        pushBlock(
          blocks,
          createArticleBlock(token.ordered ? 'orderedList' : 'bulletList', text),
        )
        break
      }

      case 'hr':
        pushBlock(blocks, createArticleBlock('divider'))
        break

      case 'code':
        pushUnsupported(unsupported, '代码块')
        break

      case 'table':
        pushUnsupported(unsupported, '表格')
        break

      case 'html':
        pushUnsupported(unsupported, 'HTML')
        break

      case 'def':
        pushUnsupported(unsupported, '引用定义')
        break

      default:
        pushUnsupported(unsupported, token.type)
    }
  }

  if (!blocks.length) {
    pushBlock(blocks, createArticleBlock('paragraph', ''))
  }

  return {
    document: normalizeArticleDocument({ version: 2, blocks }),
    importedBlocks: blocks.length,
    unsupported,
  }
}
