export const ARTICLE_DOCUMENT_VERSION = 1 as const
export const ARTICLE_MAX_BLOCKS = 200
export const ARTICLE_MAX_BLOCK_TEXT = 20_000
export const ARTICLE_MAX_SERIALIZED_BYTES = 256_000

export type ArticleBlockType = 'paragraph' | 'heading' | 'quote' | 'bulletList' | 'orderedList' | 'divider'

export type ArticleBlock = {
  id: string
  type: ArticleBlockType
  text: string
  level?: 2 | 3
}

export type ArticleDocument = {
  version: typeof ARTICLE_DOCUMENT_VERSION
  blocks: ArticleBlock[]
}

const BLOCK_TYPES: readonly ArticleBlockType[] = [
  'paragraph',
  'heading',
  'quote',
  'bulletList',
  'orderedList',
  'divider',
]

const stripUnsafeControls = (value: string): string =>
  value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')

export const createArticleBlock = (
  type: ArticleBlockType = 'paragraph',
  text = '',
): ArticleBlock => ({
  id: crypto.randomUUID(),
  type,
  text: stripUnsafeControls(text).slice(0, ARTICLE_MAX_BLOCK_TEXT),
  ...(type === 'heading' ? { level: 2 as const } : {}),
})

export const createArticleDocument = (body = ''): ArticleDocument => ({
  version: ARTICLE_DOCUMENT_VERSION,
  blocks: [createArticleBlock('paragraph', body)],
})

const normalizeBlock = (value: unknown, index: number): ArticleBlock => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_ARTICLE_BLOCK')
  }
  const candidate = value as Record<string, unknown>
  const type = candidate.type
  if (typeof type !== 'string' || !BLOCK_TYPES.includes(type as ArticleBlockType)) {
    throw new Error('INVALID_ARTICLE_BLOCK')
  }
  const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : 'block-' + String(index + 1)
  const text = type === 'divider' ? '' : typeof candidate.text === 'string' ? stripUnsafeControls(candidate.text).slice(0, ARTICLE_MAX_BLOCK_TEXT) : ''
  const level = candidate.level === 3 ? 3 : 2
  return {
    id,
    type: type as ArticleBlockType,
    text,
    ...(type === 'heading' ? { level } : {}),
  }
}

export const normalizeArticleDocument = (value: unknown): ArticleDocument => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_ARTICLE_DOCUMENT')
  }
  const candidate = value as Record<string, unknown>
  if (candidate.version !== ARTICLE_DOCUMENT_VERSION || !Array.isArray(candidate.blocks)) {
    throw new Error('INVALID_ARTICLE_DOCUMENT')
  }
  if (candidate.blocks.length < 1 || candidate.blocks.length > ARTICLE_MAX_BLOCKS) {
    throw new Error('INVALID_ARTICLE_DOCUMENT')
  }
  const blocks = candidate.blocks.map(normalizeBlock)
  if (blocks.some((block) => block.type !== 'divider' && !block.text.trim())) {
    throw new Error('INVALID_ARTICLE_DOCUMENT')
  }
  return { version: ARTICLE_DOCUMENT_VERSION, blocks }
}

export const serializeArticleDocument = (document: ArticleDocument): string => {
  const normalized = normalizeArticleDocument(document)
  const serialized = JSON.stringify(normalized)
  if (new TextEncoder().encode(serialized).byteLength > ARTICLE_MAX_SERIALIZED_BYTES) {
    throw new Error('ARTICLE_DOCUMENT_TOO_LARGE')
  }
  return serialized
}

export const tryDeserializeArticleDocument = (
  raw: string,
): ArticleDocument | null => {
  try {
    return normalizeArticleDocument(JSON.parse(raw))
  } catch {
    return null
  }
}

export const plainTextFromArticleDocument = (document: ArticleDocument): string =>
  document.blocks
    .flatMap((block) => {
      if (block.type === 'divider') return ['']
      if (block.type === 'bulletList' || block.type === 'orderedList') {
        return block.text.split('\n').map((item) => item.trim()).filter(Boolean)
      }
      return [block.text.trim()]
    })
    .filter(Boolean)
    .join('\n\n')

export const articleDocumentFromBody = (raw: string): ArticleDocument => {
  const structured = tryDeserializeArticleDocument(raw)
  if (structured) return structured

  const lines = raw.split(/\r?\n/)
  const blocks: ArticleBlock[] = []
  let paragraph: string[] = []
  const flush = () => {
    const text = paragraph.join('\n').trim()
    if (text) blocks.push(createArticleBlock('paragraph', text))
    paragraph = []
  }

  for (const line of lines) {
    if (!line.trim()) {
      flush()
      continue
    }
    paragraph.push(line)
  }
  flush()
  return blocks.length ? { version: ARTICLE_DOCUMENT_VERSION, blocks } : createArticleDocument()
}
