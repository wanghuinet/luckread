import {
  ARTICLE_MAX_BLOCKS,
  ARTICLE_MAX_BLOCK_TEXT,
  createArticleBlock,
  createArticleMediaBlock,
  createArticleDocument,
  serializeArticleDocument,
  type ArticleBlock,
  type ArticleDocument,
} from './article-document.js'

export type MarkdownImportResult = {
  document: ArticleDocument
  unsupported: string[]
}

const unescapeLeadingMarkdown = (value: string): string =>
  value.replace(/^\\(?:(?:#{1,6})|>|[-+*]|\\|(?:---+|___+|(?:\\*\\s*){3,}))(?:\\s|$)?/u, (match) =>
    match.slice(1),
  )

const createMarkdownTextBlock = (
  type: 'paragraph' | 'heading' | 'quote' | 'bulletList' | 'orderedList',
  text: string,
): ArticleBlock => {
  if (text.length > ARTICLE_MAX_BLOCK_TEXT) {
    throw new Error('MARKDOWN_BLOCK_TOO_LARGE')
  }
  return createArticleBlock(type, text)
}

const pushParagraph = (blocks: ArticleBlock[], lines: string[]) => {
  const text = lines.join('\n').trim()
  if (!text) return
  if (text.length > ARTICLE_MAX_BLOCK_TEXT) {
    throw new Error('MARKDOWN_BLOCK_TOO_LARGE')
  }
  blocks.push(createMarkdownTextBlock('paragraph', text))
}

const hasUnsupportedSyntax = (line: string): string | null => {
  if (/^\s*```/u.test(line)) return '代码块'
  if (/^\s*</u.test(line)) return 'HTML'
  if (/\[[^\]]+\]\([^\)]+\)/u.test(line)) return '链接'
  if (/^\s*\|.*\|\s*$/u.test(line)) return '表格或管线语法'
  if (/^\s*[*_][^\n]*[*_]\s*$/u.test(line) || /\*\*|__/u.test(line)) return '行内强调'
  return null
}

const parseImage = (line: string): { alt: string; url: string } | null => {
  const match = line.trim().match(/^!\[([^\]]*)\]\(([^\)\s]+)\)$/u)
  if (!match) return null
  return { alt: match[1] ?? '', url: match[2] ?? '' }
}

export const markdownToArticleDocument = (raw: string): MarkdownImportResult => {
  const blocks: ArticleBlock[] = []
  const unsupported = new Set<string>()
  const lines = raw.replace(/\r\n?/gu, '\n').split('\n')
  let paragraph: string[] = []
  let quote: string[] = []
  let bullet: string[] = []
  let ordered: string[] = []

  const flushParagraph = () => {
    pushParagraph(blocks, paragraph)
    paragraph = []
  }
  const flushQuote = () => {
    if (quote.length) {
      blocks.push(createMarkdownTextBlock('quote', quote.join('\n').trim()))
      quote = []
    }
  }
  const flushBullet = () => {
    if (bullet.length) {
      blocks.push(createMarkdownTextBlock('bulletList', bullet.join('\n')))
      bullet = []
    }
  }
  const flushOrdered = () => {
    if (ordered.length) {
      blocks.push(createMarkdownTextBlock('orderedList', ordered.join('\n')))
      ordered = []
    }
  }
  const flushText = () => {
    flushParagraph()
    flushQuote()
    flushBullet()
    flushOrdered()
  }

  for (const line of lines) {
    const escapedLiteral = /^\s*\\(?:(?:#{1,6})|>|[-+*]|\\|(?:---+|___+|(?:\*\s*){3,}))\s*$/u.test(line) ||
      /^\s*\\(?:(?:#{1,6})|>|[-+*]|\\)(?=\s|$)/u.test(line)
    const parsedLine = escapedLiteral ? unescapeLeadingMarkdown(line) : line

    if (!escapedLiteral && /^\s*(?:---+|___+|\*\s*\*\s*\*+(?:\s*\*)*)\s*$/u.test(parsedLine)) {
      flushText()
      blocks.push({ id: crypto.randomUUID(), type: 'divider', text: '' })
      continue
    }

    const unsupportedKind = hasUnsupportedSyntax(parsedLine)
    if (unsupportedKind) {
      unsupported.add(unsupportedKind)
      continue
    }

    if (!parsedLine.trim()) {
      flushText()
      continue
    }

    if (escapedLiteral) {
      flushQuote()
      flushBullet()
      flushOrdered()
      paragraph.push(parsedLine)
      continue
    }

    const heading = parsedLine.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/u)
    if (heading) {
      flushText()
      const marks = heading[1]?.length ?? 0
      if (marks === 2 || marks === 3) {
        blocks.push(createMarkdownTextBlock('heading', heading[2] ?? ''))
        const last = blocks.at(-1)
        if (last) last.level = marks as 2 | 3
      } else {
        unsupported.add('H1/H4-H6 标题层级')
      }
      continue
    }

    const image = parseImage(parsedLine)
    if (image) {
      flushText()
      if (image.alt.length > ARTICLE_MAX_BLOCK_TEXT) {
        throw new Error('MARKDOWN_BLOCK_TOO_LARGE')
      }
      try {
        blocks.push(createArticleMediaBlock('image', [image.url], image.alt))
      } catch {
        unsupported.add('图片引用')
      }
      continue
    }

    const quoteMatch = parsedLine.match(/^\s*> ?(.*)$/u)
    if (quoteMatch) {
      flushParagraph()
      flushBullet()
      flushOrdered()
      quote.push(quoteMatch[1] ?? '')
      continue
    }

    const bulletMatch = parsedLine.match(/^\s*[-*+]\s+(.+)$/u)
    if (bulletMatch) {
      flushParagraph()
      flushQuote()
      flushOrdered()
      bullet.push(unescapeLeadingMarkdown((bulletMatch[1] ?? '').trim()))
      continue
    }

    const orderedMatch = parsedLine.match(/^\s*\d+[.)]\s+(.+)$/u)
    if (orderedMatch) {
      flushParagraph()
      flushQuote()
      flushBullet()
      ordered.push(unescapeLeadingMarkdown((orderedMatch[1] ?? '').trim()))
      continue
    }

    flushQuote()
    flushBullet()
    flushOrdered()
    paragraph.push(parsedLine)
  }

  flushText()

  if (blocks.length > ARTICLE_MAX_BLOCKS) {
    throw new Error('MARKDOWN_TOO_MANY_BLOCKS')
  }

  if (!blocks.length) return { document: createArticleDocument(), unsupported: [...unsupported] }

  const document = { version: 2 as const, blocks }
  serializeArticleDocument(document)
  return { document, unsupported: [...unsupported] }
}
