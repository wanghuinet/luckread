import { marked } from 'marked'
import {
  ARTICLE_MAX_BLOCKS,
  ARTICLE_MAX_BLOCK_TEXT,
  ARTICLE_TABLE_MAX_COLUMNS,
  ARTICLE_TABLE_MAX_ROWS,
  createArticleBlock,
  createArticleMediaBlock,
  createArticleTableBlock,
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

const INLINE_LINK_PATTERN = new RegExp('!?\\[[^\\]]*\\]\\([^)]*\\)')
const REFERENCE_LINK_PATTERN = new RegExp('\\[[^\\]]+\\]\\[[^\\]]*\\]')

const stripInlineMarkdown = (value: string): string =>
  value
    .replace(new RegExp('<[^>]+>', 'g'), '')
    .replace(new RegExp('!\\[([^\\]]*)\\]\\([^)]*\\)', 'g'), '$1')
    .replace(new RegExp('\\[([^\\]]+)\\]\\([^)]*\\)', 'g'), '$1')
    .replace(new RegExp('\\[([^\\]]+)\\]\\[[^\\]]*\\]', 'g'), '$1')
    .replace(new RegExp('\\\\([\\\\\\x60*_{}\\[\\]()#+.!<>-])', 'g'), '$1')
    .replace(new RegExp('(^|\\s)(\\*\\*|__)(?=\\S)', 'g'), '$1')
    .replace(new RegExp('(\\*\\*|__)(?=\\s|$)', 'g'), '')
    .replace(new RegExp('(^|\\s)(\\*|_|~~)(?=\\S)', 'g'), '$1')
    .replace(new RegExp('(\\*|_|~~)(?=\\s|$)', 'g'), '')
    .replace(new RegExp('\\x60', 'g'), '')
    .replace(new RegExp('[ \\t]+\\n', 'g'), '\\n')
    .replace(new RegExp('\\n{3,}', 'g'), '\\n\\n')
    .trim()

const pushUnsupported = (unsupported: string[], kind: string): void => {
  if (!unsupported.includes(kind)) unsupported.push(kind)
}

const boundedText = (
  value: string,
  unsupported: string[],
): string | null => {
  if (value.length > ARTICLE_MAX_BLOCK_TEXT) {
    pushUnsupported(unsupported, '单个正文区块超过 20,000 字符')
    return null
  }
  return value
}

const pushBlock = (blocks: ArticleBlock[], block: ArticleBlock): void => {
  if (blocks.length < ARTICLE_MAX_BLOCKS) blocks.push(block)
}

const prepareDisplayMath = (
  source: string,
): { markdown: string; expressions: string[] } => {
  const expressions: string[] = []
  const markerPrefix = 'LUCKREADDISPLAYMATH'
  const markerSuffix = 'END'
  let markerIndex = 0

  const markdown = source.replace(
    /(^|\n)\s*\$\$\s*\n?([\s\S]*?)\n?\s*\$\$(?=\s*(?:\n|$))/g,
    (match, lineBreak: string, expression: string) => {
      let marker = markerPrefix + markerIndex + markerSuffix
      while (source.includes(marker)) {
        markerIndex += 1
        marker = markerPrefix + markerIndex + markerSuffix
      }
      markerIndex += 1
      expressions.push(expression.trim())
      return lineBreak + marker
    },
  )

  return { markdown, expressions }
}

const normalizeMarkdownCodeLanguage = (language: string | undefined): ArticleBlock['language'] => {
  const normalized = (language ?? '').trim().toLowerCase()
  const aliases: Record<string, NonNullable<ArticleBlock['language']>> = {
    '': 'plaintext',
    text: 'plaintext',
    txt: 'plaintext',
    yml: 'plaintext',
    yaml: 'plaintext',
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    sh: 'bash',
    shell: 'bash',
    md: 'markdown',
  }
  const candidate = aliases[normalized] ?? normalized
  return [
    'plaintext',
    'javascript',
    'typescript',
    'python',
    'json',
    'bash',
    'sql',
    'css',
    'html',
    'markdown',
  ].includes(candidate as NonNullable<ArticleBlock['language']>)
    ? candidate as NonNullable<ArticleBlock['language']>
    : undefined
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

  const prepared = prepareDisplayMath(source)
  const tokens = marked.lexer(prepared.markdown, { gfm: true, breaks: false })
  const blocks: ArticleBlock[] = []
  const unsupported: string[] = []

  for (const token of tokens) {
    if (blocks.length >= ARTICLE_MAX_BLOCKS) {
      pushUnsupported(unsupported, '正文区块数量超过 200')
      break
    }

    switch (token.type) {
      case 'space':
        continue

      case 'heading': {
        const text = boundedText(stripInlineMarkdown(token.text), unsupported)
        if (text === null || !text) continue
        pushBlock(blocks, {
          ...createArticleBlock('heading', text),
          level: token.depth >= 3 ? 3 : 2,
        })
        break
      }

      case 'paragraph': {
        const raw = token.text.trim()
        const mathMarkerMatch = raw.match(/^LUCKREADDISPLAYMATH(\\d+)END$/)
        if (mathMarkerMatch) {
          const expression = prepared.expressions[Number(mathMarkerMatch[1])] ?? ''
          const bounded = boundedText(expression, unsupported)
          if (bounded) pushBlock(blocks, createArticleBlock('math', bounded))
          break
        }
        const sourceRaw = (token as { raw?: string }).raw?.trim() ?? raw
        const imageMatch = raw.match(
          new RegExp('^!\\[([^\\]]*)\\]\\((https?:\\/\\/[^)\\s]+)(?:\\s+[^)]*)?\\)$'),
        )
        if (imageMatch) {
          pushBlock(
            blocks,
            createArticleMediaBlock('image', [imageMatch[2]], imageMatch[1]),
          )
          break
        }

        const mathMatch = sourceRaw.match(/^\\$\\$\\s*([\\s\\S]*?)\\s*\\$\\$/)
        if (mathMatch) {
          const expression = boundedText(mathMatch[1].trim(), unsupported)
          if (expression) {
            pushBlock(blocks, createArticleBlock('math', expression))
          }
          break
        }

        if (new RegExp('!\\[[^\\]]*\\]\\(').test(raw)) {
          pushUnsupported(unsupported, '内嵌图片')
          continue
        }
        if (INLINE_LINK_PATTERN.test(raw) || REFERENCE_LINK_PATTERN.test(raw)) {
          pushUnsupported(unsupported, '链接')
          continue
        }

        const text = boundedText(stripInlineMarkdown(token.text), unsupported)
        if (text) pushBlock(blocks, createArticleBlock('paragraph', text))
        break
      }

      case 'blockquote': {
        const text = boundedText(stripInlineMarkdown(token.text), unsupported)
        if (text) pushBlock(blocks, createArticleBlock('quote', text))
        break
      }

      case 'list': {
        const text = (token.items as unknown[])
          .map((item: unknown): string | null => {
            const value = typeof item === 'object' && item !== null && 'text' in item
              ? (item as { text?: unknown }).text
              : ''
            return boundedText(
              stripInlineMarkdown(typeof value === 'string' ? value : ''),
              unsupported,
            )
          })
          .filter((item: string | null): item is string => item !== null && Boolean(item))
          .join('\n')
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

      case 'code': {
        const language = normalizeMarkdownCodeLanguage(token.lang)
        if (!language) {
          pushUnsupported(unsupported, '代码语言：' + (token.lang ?? 'unknown'))
          break
        }
        const text = boundedText(token.text, unsupported)
        if (text === null) break
        pushBlock(blocks, {
          ...createArticleBlock('code', text),
          language,
        })
        break
      }

      case 'table': {
        const tableToken = token as unknown as {
          header: Array<{ text: string }>
          rows: Array<Array<{ text: string }>>
        }
        const rawHeader = tableToken.header.map((cell) => cell.text)
        const rawRows = tableToken.rows.map((row) => row.map((cell) => cell.text))
        const allRawCells = [rawHeader, ...rawRows]

        if (
          !rawHeader.length ||
          rawHeader.length > ARTICLE_TABLE_MAX_COLUMNS ||
          rawRows.length > ARTICLE_TABLE_MAX_ROWS ||
          rawRows.some((row) => row.length !== rawHeader.length)
        ) {
          pushUnsupported(unsupported, '表格尺寸超过当前编辑器限制')
          break
        }

        if (allRawCells.some((row) =>
          row.some((cell) =>
            INLINE_LINK_PATTERN.test(cell) ||
            REFERENCE_LINK_PATTERN.test(cell) ||
            /!\[[^\]]*\]\(/.test(cell) ||
            /<[^>]+>/.test(cell),
          ),
        )) {
          pushUnsupported(unsupported, '表格内链接、图片或 HTML')
          break
        }

        const header = rawHeader.map((cell) => stripInlineMarkdown(cell))
        const rows = rawRows.map((row) => row.map((cell) => stripInlineMarkdown(cell)))
        const bounded = [header, ...rows].map((row) =>
          row.map((cell) => boundedText(cell, unsupported)),
        )
        if (bounded.some((row) => row.some((cell) => cell === null))) break

        pushBlock(
          blocks,
          createArticleTableBlock(
            bounded[0].filter((cell): cell is string => cell !== null),
            bounded.slice(1).map((row) =>
              row.filter((cell): cell is string => cell !== null),
            ),
          ),
        )
        break
      }

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
