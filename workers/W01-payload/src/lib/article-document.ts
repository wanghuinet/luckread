export const ARTICLE_DOCUMENT_VERSION = 2 as const
export const ARTICLE_MAX_BLOCKS = 200
export const ARTICLE_MAX_BLOCK_TEXT = 20_000
export const ARTICLE_MAX_MEDIA_PER_BLOCK = 12
export const ARTICLE_MAX_SERIALIZED_BYTES = 256_000
export const ARTICLE_TABLE_MAX_COLUMNS = 8
export const ARTICLE_TABLE_MAX_ROWS = 50
export const ARTICLE_TABLE_MAX_CELL_TEXT = 2_000

export const ARTICLE_CODE_LANGUAGES = [
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
] as const

export type ArticleCodeLanguage = typeof ARTICLE_CODE_LANGUAGES[number]

export type ArticleTable = {
  headers: string[]
  rows: string[][]
}

export type ArticleBlockType =
  | 'paragraph'
  | 'heading'
  | 'quote'
  | 'bulletList'
  | 'orderedList'
  | 'divider'
  | 'image'
  | 'gallery'
  | 'code'
  | 'table'

export type ArticleBlock = {
  id: string
  type: ArticleBlockType
  text: string
  level?: 2 | 3
  language?: ArticleCodeLanguage
  mediaRefs?: string[]
  table?: ArticleTable
}

export type ArticleDocument = {
  version: typeof ARTICLE_DOCUMENT_VERSION
  blocks: ArticleBlock[]
}

const SUPPORTED_VERSIONS = new Set([1, ARTICLE_DOCUMENT_VERSION])
const BLOCK_TYPES: readonly ArticleBlockType[] = [
  'paragraph',
  'heading',
  'quote',
  'bulletList',
  'orderedList',
  'divider',
  'image',
  'gallery',
  'code',
  'table',
]

const stripUnsafeControls = (value: string): string =>
  value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')

const normalizeCodeLanguage = (value: unknown): ArticleCodeLanguage =>
  typeof value === 'string' && ARTICLE_CODE_LANGUAGES.includes(value as ArticleCodeLanguage)
    ? value as ArticleCodeLanguage
    : 'plaintext'

const normalizeTableCell = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('INVALID_ARTICLE_BLOCK')
  const clean = stripUnsafeControls(value)
  if (clean.length > ARTICLE_TABLE_MAX_CELL_TEXT) {
    throw new Error('INVALID_ARTICLE_BLOCK')
  }
  return clean
}

const normalizeTable = (value: unknown): ArticleTable | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_ARTICLE_BLOCK')
  }
  const candidate = value as Record<string, unknown>
  if (!Array.isArray(candidate.headers) || !Array.isArray(candidate.rows)) {
    throw new Error('INVALID_ARTICLE_BLOCK')
  }
  if (
    candidate.headers.length < 1 ||
    candidate.headers.length > ARTICLE_TABLE_MAX_COLUMNS ||
    candidate.rows.length > ARTICLE_TABLE_MAX_ROWS
  ) {
    throw new Error('INVALID_ARTICLE_BLOCK')
  }

  const headers = candidate.headers.map(normalizeTableCell)
  const rows = candidate.rows.map((row) => {
    if (!Array.isArray(row) || row.length !== headers.length) {
      throw new Error('INVALID_ARTICLE_BLOCK')
    }
    return row.map(normalizeTableCell)
  })

  return { headers, rows }
}

export const createArticleTableBlock = (
  headers = ['列 1', '列 2'],
  rows: string[][] = [['', '']],
): ArticleBlock => {
  if (
    headers.length < 1 ||
    headers.length > ARTICLE_TABLE_MAX_COLUMNS ||
    rows.length > ARTICLE_TABLE_MAX_ROWS ||
    rows.some((row) => row.length !== headers.length)
  ) {
    throw new Error('INVALID_ARTICLE_BLOCK')
  }

  const table: ArticleTable = {
    headers: headers.map(normalizeTableCell),
    rows: rows.map((row) => row.map(normalizeTableCell)),
  }

  return {
    id: crypto.randomUUID(),
    type: 'table',
    text: table.rows.map((row) => row.join('\t')).join('\n'),
    table,
  }
}

const normalizeMediaRefs = (value: unknown, type: ArticleBlockType): string[] | undefined => {
  if (type !== 'image' && type !== 'gallery') return undefined
  if (!Array.isArray(value)) throw new Error('INVALID_ARTICLE_BLOCK')
  const max = type === 'image' ? 1 : ARTICLE_MAX_MEDIA_PER_BLOCK
  if (value.length < 1 || value.length > max) throw new Error('INVALID_ARTICLE_BLOCK')
  const refs = value.map((ref) => typeof ref === 'string' ? ref.trim() : '')
  if (refs.some((ref) => !ref || ref.length > 2048)) throw new Error('INVALID_ARTICLE_BLOCK')
  return Array.from(new Set(refs))
}

export const createArticleBlock = (
  type: ArticleBlockType = 'paragraph',
  text = '',
): ArticleBlock => ({
  id: crypto.randomUUID(),
  type,
  text: stripUnsafeControls(text).slice(0, ARTICLE_MAX_BLOCK_TEXT),
  ...(type === 'heading' ? { level: 2 as const } : {}),
  ...(type === 'code' ? { language: 'plaintext' as const } : {}),
})

export const createArticleMediaBlock = (
  type: 'image' | 'gallery',
  mediaRefs: string[],
  text = '',
): ArticleBlock => {
  const refs = normalizeMediaRefs(mediaRefs, type)
  if (!refs) throw new Error('INVALID_ARTICLE_BLOCK')
  if (type === 'gallery' && refs.length < 2) throw new Error('INVALID_ARTICLE_BLOCK')
  return {
    id: crypto.randomUUID(),
    type,
    text: stripUnsafeControls(text).slice(0, ARTICLE_MAX_BLOCK_TEXT),
    mediaRefs: refs,
  }
}

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

  const blockType = type as ArticleBlockType
  const id = typeof candidate.id === 'string' && candidate.id.trim()
    ? candidate.id.trim()
    : 'block-' + String(index + 1)
  const text = blockType === 'divider'
    ? ''
    : typeof candidate.text === 'string'
      ? stripUnsafeControls(candidate.text).slice(0, ARTICLE_MAX_BLOCK_TEXT)
      : ''
  const level = candidate.level === 3 ? 3 : 2
  const language = blockType === 'code' ? normalizeCodeLanguage(candidate.language) : undefined
  const mediaRefs = normalizeMediaRefs(candidate.mediaRefs, blockType)
  const table = blockType === 'table' ? normalizeTable(candidate.table) : undefined

  if (blockType === 'gallery' && (!mediaRefs || mediaRefs.length < 2)) {
    throw new Error('INVALID_ARTICLE_BLOCK')
  }
  if (blockType === 'table' && !table) {
    throw new Error('INVALID_ARTICLE_BLOCK')
  }

  return {
    id,
    type: blockType,
    text,
    ...(blockType === 'heading' ? { level } : {}),
    ...(blockType === 'code' ? { language } : {}),
    ...(mediaRefs ? { mediaRefs } : {}),
    ...(table ? { table } : {}),
  }
}

export const normalizeArticleDocument = (value: unknown): ArticleDocument => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_ARTICLE_DOCUMENT')
  }
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.version !== 'number' ||
    !SUPPORTED_VERSIONS.has(candidate.version) ||
    !Array.isArray(candidate.blocks)
  ) {
    throw new Error('INVALID_ARTICLE_DOCUMENT')
  }
  if (candidate.blocks.length < 1 || candidate.blocks.length > ARTICLE_MAX_BLOCKS) {
    throw new Error('INVALID_ARTICLE_DOCUMENT')
  }
  const blocks = candidate.blocks.map(normalizeBlock)
  return { version: ARTICLE_DOCUMENT_VERSION, blocks }
}

export const serializeArticleDocument = (document: ArticleDocument): string => {
  const normalized = normalizeArticleDocument(document)
  const persistableBlocks = normalized.blocks.filter(
    (block) =>
      block.type === 'divider' ||
      block.type === 'image' ||
      block.type === 'gallery' ||
      block.type === 'table' ||
      Boolean(block.text.trim()),
  )
  if (!persistableBlocks.some(
    (block) =>
      block.type === 'image' ||
      block.type === 'gallery' ||
      (block.type !== 'divider' && Boolean(block.text.trim())),
  )) {
    throw new Error('ARTICLE_DOCUMENT_EMPTY')
  }
  const serialized = JSON.stringify({
    version: ARTICLE_DOCUMENT_VERSION,
    blocks: persistableBlocks,
  })
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
      if (block.type === 'table') {
        const table = block.table
        if (!table) return []
        return [table.headers.join('\t'), ...table.rows.map((row) => row.join('\t'))]
      }
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
