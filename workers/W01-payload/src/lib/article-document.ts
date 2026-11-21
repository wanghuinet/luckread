export const ARTICLE_DOCUMENT_VERSION = 2 as const
export const ARTICLE_MAX_BLOCKS = 200
export const ARTICLE_MAX_BLOCK_TEXT = 20_000
export const ARTICLE_MAX_MEDIA_PER_BLOCK = 12
export const ARTICLE_MAX_SERIALIZED_BYTES = 256_000

export type ArticleBlockType =
  | 'paragraph'
  | 'heading'
  | 'quote'
  | 'bulletList'
  | 'orderedList'
  | 'divider'
  | 'image'
  | 'gallery'

export type ArticleBlock = {
  id: string
  type: ArticleBlockType
  text: string
  level?: 2 | 3
  mediaRefs?: string[]
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
]

const stripUnsafeControls = (value: string): string =>
  value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')

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
  const mediaRefs = normalizeMediaRefs(candidate.mediaRefs, blockType)

  if (blockType === 'gallery' && (!mediaRefs || mediaRefs.length < 2)) {
    throw new Error('INVALID_ARTICLE_BLOCK')
  }

  return {
    id,
    type: blockType,
    text,
    ...(blockType === 'heading' ? { level } : {}),
    ...(mediaRefs ? { mediaRefs } : {}),
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

export const ARTICLE_BLOCK_CLIPBOARD_PREFIX = 'LUCKREAD_ARTICLE_BLOCK_V1:'

export const serializeArticleBlockForClipboard = (block: ArticleBlock): string =>
  ARTICLE_BLOCK_CLIPBOARD_PREFIX + JSON.stringify(normalizeArticleDocument({
    version: ARTICLE_DOCUMENT_VERSION,
    blocks: [block],
  }).blocks[0])

export const parseArticleBlockFromClipboard = (raw: string): ArticleBlock | null => {
  if (!raw.startsWith(ARTICLE_BLOCK_CLIPBOARD_PREFIX)) return null
  try {
    const payload = raw.slice(ARTICLE_BLOCK_CLIPBOARD_PREFIX.length)
    return normalizeArticleDocument({
      version: ARTICLE_DOCUMENT_VERSION,
      blocks: [JSON.parse(payload)],
    }).blocks[0] ?? null
  } catch {
    return null
  }
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

export const mediaRefsFromArticleDocument = (document: ArticleDocument): string[] =>
  Array.from(
    new Set(
      document.blocks
        .flatMap((block) => block.mediaRefs ?? [])
        .map((ref) => ref.trim())
        .filter(Boolean),
    ),
  )

export const removeMediaRefFromArticleDocument = (
  document: ArticleDocument,
  mediaRef: string,
): ArticleDocument => {
  const target = mediaRef.trim()
  if (!target) return document

  const blocks: ArticleBlock[] = []
  let changed = false

  for (const block of document.blocks) {
    if (!block.mediaRefs?.length) {
      blocks.push(block)
      continue
    }

    const mediaRefs = block.mediaRefs.filter((ref) => ref !== target)
    if (mediaRefs.length === block.mediaRefs.length) {
      blocks.push(block)
      continue
    }

    changed = true
    if (mediaRefs.length === 0) {
      blocks.push({
        id: block.id,
        type: 'paragraph',
        text: block.text,
      })
    } else if (block.type === 'gallery' && mediaRefs.length === 1) {
      blocks.push({ ...block, type: 'image', mediaRefs })
    } else {
      blocks.push({ ...block, mediaRefs })
    }
  }

  return changed ? { ...document, blocks } : document
}

export const reorderArticleMediaRef = (
  document: ArticleDocument,
  blockIndex: number,
  fromIndex: number,
  toIndex: number,
): ArticleDocument => {
  const block = document.blocks[blockIndex]
  if (
    !block ||
    block.type !== 'gallery' ||
    !block.mediaRefs ||
    block.mediaRefs.length < 2 ||
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= block.mediaRefs.length ||
    toIndex >= block.mediaRefs.length ||
    fromIndex === toIndex
  ) {
    return document
  }

  const mediaRefs = [...block.mediaRefs]
  const [moved] = mediaRefs.splice(fromIndex, 1)
  if (!moved) return document
  mediaRefs.splice(toIndex, 0, moved)

  return {
    ...document,
    blocks: document.blocks.map((candidate, candidateIndex) =>
      candidateIndex === blockIndex
        ? { ...candidate, mediaRefs }
        : candidate,
    ),
  }
}

export const hasArticleDocumentContent = (document: ArticleDocument): boolean =>
  Boolean(plainTextFromArticleDocument(document).trim()) ||
  mediaRefsFromArticleDocument(document).length > 0

export const duplicateArticleBlock = (block: ArticleBlock): ArticleBlock => ({
  ...block,
  id: crypto.randomUUID(),
  ...(block.mediaRefs ? { mediaRefs: [...block.mediaRefs] } : {}),
})

export const insertArticleBlockAfter = (
  document: ArticleDocument,
  index: number,
  type: ArticleBlockType = 'paragraph',
): ArticleDocument => {
  if (index < -1 || index >= document.blocks.length) return document
  const block = createArticleBlock(type)
  const insertAt = index + 1
  return {
    ...document,
    blocks: [
      ...document.blocks.slice(0, insertAt),
      block,
      ...document.blocks.slice(insertAt),
    ],
  }
}

export const insertArticleMediaBlockAfter = (
  document: ArticleDocument,
  index: number,
  type: 'image' | 'gallery',
  mediaRefs: string[],
): ArticleDocument => {
  if (index < -1 || index >= document.blocks.length || document.blocks.length >= ARTICLE_MAX_BLOCKS) {
    return document
  }

  const refs = Array.from(new Set(mediaRefs.map((ref) => ref.trim()).filter(Boolean)))
  if ((type === 'image' && refs.length < 1) || (type === 'gallery' && refs.length < 2)) {
    return document
  }

  const block = createArticleMediaBlock(
    type,
    type === 'image' ? refs.slice(0, 1) : refs.slice(0, ARTICLE_MAX_MEDIA_PER_BLOCK),
  )
  const insertAt = index + 1

  return {
    ...document,
    blocks: [
      ...document.blocks.slice(0, insertAt),
      block,
      ...document.blocks.slice(insertAt),
    ],
  }
}

export const transformArticleBlock = (
  block: ArticleBlock,
  nextType: ArticleBlockType,
): ArticleBlock => {
  if (block.type === nextType) return block

  if (nextType === 'divider') {
    return {
      id: block.id,
      type: 'divider',
      text: '',
    }
  }

  if (nextType === 'image' || nextType === 'gallery') {
    const refs = block.mediaRefs ? [...block.mediaRefs] : []
    if (nextType === 'image' && refs.length < 1) return block
    if (nextType === 'gallery' && refs.length < 2) return block
    return {
      id: block.id,
      type: nextType,
      text: block.text,
      mediaRefs: refs.slice(0, nextType === 'image' ? 1 : ARTICLE_MAX_MEDIA_PER_BLOCK),
    }
  }

  return {
    id: block.id,
    type: nextType,
    text: block.text,
    ...(nextType === 'heading' ? { level: block.level ?? 2 } : {}),
  }
}

const isMergeableTextBlock = (type: ArticleBlockType): boolean =>
  type === 'paragraph' ||
  type === 'quote' ||
  type === 'bulletList' ||
  type === 'orderedList'

export const splitArticleBlock = (
  document: ArticleDocument,
  index: number,
  offset: number,
): ArticleDocument => {
  const block = document.blocks[index]
  if (
    !block ||
    !isMergeableTextBlock(block.type) ||
    !Number.isInteger(offset) ||
    offset <= 0 ||
    offset >= block.text.length ||
    document.blocks.length >= ARTICLE_MAX_BLOCKS
  ) {
    return document
  }

  const before = block.text.slice(0, offset)
  const after = block.text.slice(offset)
  if (before.length > ARTICLE_MAX_BLOCK_TEXT || after.length > ARTICLE_MAX_BLOCK_TEXT) return document

  const nextBlock: ArticleBlock = {
    ...block,
    id: crypto.randomUUID(),
    text: after,
    ...(block.mediaRefs ? { mediaRefs: [...block.mediaRefs] } : {}),
  }
  const currentBlock: ArticleBlock = {
    ...block,
    text: before,
    ...(block.mediaRefs ? { mediaRefs: [...block.mediaRefs] } : {}),
  }

  return {
    ...document,
    blocks: [
      ...document.blocks.slice(0, index),
      currentBlock,
      nextBlock,
      ...document.blocks.slice(index + 1),
    ],
  }
}

export const mergeArticleBlockWithPrevious = (
  document: ArticleDocument,
  index: number,
): ArticleDocument => {
  if (index <= 0 || index >= document.blocks.length) return document

  const previous = document.blocks[index - 1]
  const current = document.blocks[index]
  if (
    !isMergeableTextBlock(previous.type) ||
    previous.type !== current.type
  ) {
    return document
  }

  const separator = previous.type === 'bulletList' || previous.type === 'orderedList'
    ? '\\n'
    : '\\n\\n'
  const mergedText = previous.text + separator + current.text
  if (mergedText.length > ARTICLE_MAX_BLOCK_TEXT) return document

  return {
    ...document,
    blocks: [
      ...document.blocks.slice(0, index - 1),
      {
        ...previous,
        text: mergedText,
      },
      ...document.blocks.slice(index + 1),
    ],
  }
}

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
