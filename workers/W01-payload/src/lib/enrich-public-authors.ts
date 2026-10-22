import { getPayload } from 'payload'

import config from '@payload-config'

type JsonRecord = Record<string, unknown>

export type PublicAuthorProjection = {
  id: string
  username: string
  displayName: string | null
  avatar: string | null
}

const MAX_AUTHOR_IDS = 100

const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null

const normalizedId = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const id = String(value).trim()
  return id && id.length <= 128 ? id : null
}

const stringValue = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const authorProjection = (value: unknown): PublicAuthorProjection | null => {
  const row = asRecord(value)
  if (!row) return null
  const id = normalizedId(row.id)
  if (!id) return null
  return {
    id,
    username: stringValue(row.username) ?? '',
    displayName: stringValue(row.displayName),
    avatar: stringValue(row.avatar),
  }
}

const looksHydrated = (value: unknown): boolean => {
  const author = asRecord(value)
  return Boolean(
    author &&
    ['username', 'displayName', 'avatar'].every((key) =>
      Object.prototype.hasOwnProperty.call(author, key),
    ),
  )
}

async function loadPublicAuthors(ids: string[]): Promise<Map<string, PublicAuthorProjection>> {
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean))).slice(0, MAX_AUTHOR_IDS)
  const byLookupId = new Map<string, PublicAuthorProjection>()
  if (!uniqueIds.length) return byLookupId

  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'users',
    where: {
      or: [
        { id: { in: uniqueIds } },
        { identityId: { in: uniqueIds } },
      ],
    },
    depth: 0,
    limit: uniqueIds.length,
    overrideAccess: true,
    select: {
      id: true,
      identityId: true,
      username: true,
      displayName: true,
      avatar: true,
    } as any,
  })

  for (const doc of result.docs) {
    const record = doc as unknown as JsonRecord
    const author = authorProjection(record)
    if (!author) continue
    byLookupId.set(author.id, author)
    const identityId = normalizedId(record.identityId)
    if (identityId) byLookupId.set(identityId, author)
  }

  return byLookupId
}

const contentAuthorIds = (item: JsonRecord): string[] => {
  const creator = asRecord(item.creator)
  const author = asRecord(item.author)
  return [
    item.creatorId,
    item.ownerUserId,
    creator?.id,
    creator?.userId,
    author?.id,
    author?.userId,
  ].map(normalizedId).filter((id): id is string => id !== null)
}

const commentAuthorIds = (item: JsonRecord): string[] => {
  const id = normalizedId(item.authorUserId)
  return id ? [id] : []
}

const usableList = (value: unknown): { root: JsonRecord; container: JsonRecord; items: JsonRecord[]; nested: boolean } | null => {
  const root = asRecord(value)
  if (!root) return null
  const data = asRecord(root.data)
  if (data && Array.isArray(data.items)) {
    const items = data.items.map(asRecord)
    if (items.some((item) => !item)) return null
    return { root, container: data, items: items as JsonRecord[], nested: true }
  }
  if (Array.isArray(root.items)) {
    const items = root.items.map(asRecord)
    if (items.some((item) => !item)) return null
    return { root, container: root, items: items as JsonRecord[], nested: false }
  }
  return null
}

async function enrichListAuthors(
  response: Response,
  options: {
    idsForItem: (item: JsonRecord) => string[]
    outputField: 'creator' | 'author'
    shouldEnrich: (item: JsonRecord) => boolean
  },
): Promise<Response> {
  if (!response.ok) return response

  let value: unknown
  try {
    value = await response.clone().json()
  } catch {
    return response
  }

  const list = usableList(value)
  if (!list) return response

  const relevantItems = list.items.filter(options.shouldEnrich)
  if (!relevantItems.length) return response

  const ids = relevantItems.flatMap(options.idsForItem)
  if (!ids.length) return response

  try {
    const authors = await loadPublicAuthors(ids)
    if (!authors.size) return response

    const items = list.items.map((item) => {
      if (!options.shouldEnrich(item)) return item
      const author = options.idsForItem(item)
        .map((id) => authors.get(id))
        .find((candidate): candidate is PublicAuthorProjection => Boolean(candidate))
      if (!author) return item

      if (options.outputField === 'author') {
        const existing = asRecord(item.author) ?? {}
        return { ...item, author: { ...author, ...existing,
          username: stringValue(existing.username) ?? author.username,
          displayName: stringValue(existing.displayName) ?? author.displayName,
          avatar: stringValue(existing.avatar) ?? author.avatar,
        } }
      }

      const existingCreator = asRecord(item.creator)
      const existingAuthor = asRecord(item.author)
      const field = existingCreator ? 'creator' : existingAuthor ? 'author' : 'creator'
      const existing = existingCreator ?? existingAuthor ?? {}
      const merged = {
        ...author,
        ...existing,
        username: stringValue(existing.username) ?? author.username,
        displayName: stringValue(existing.displayName) ?? author.displayName,
        avatar: stringValue(existing.avatar) ?? author.avatar,
      }
      return { ...item, [field]: merged }
    })

    const updatedContainer = { ...list.container, items }
    const output = list.nested
      ? { ...list.root, data: updatedContainer }
      : updatedContainer

    const headers = new Headers(response.headers)
    headers.delete('content-length')
    headers.delete('content-encoding')
    // The enriched JSON representation is not byte-for-byte the upstream body.
    headers.delete('etag')
    return new Response(JSON.stringify(output), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch {
    // Author projection is an enhancement; never turn a valid content/comment
    // page into a failure if the profile projection lookup is temporarily down.
    return response
  }
}

/** Enrich one content page with batched public author metadata. */
export function enrichContentListAuthors(response: Response): Promise<Response> {
  return enrichListAuthors(response, {
    idsForItem: contentAuthorIds,
    outputField: 'creator',
    shouldEnrich: (item) => {
      const current = asRecord(item.creator) ?? asRecord(item.author)
      return !looksHydrated(current) && contentAuthorIds(item).length > 0
    },
  })
}

/** Enrich one comment page with batched public author metadata. */
export function enrichCommentListAuthors(response: Response): Promise<Response> {
  return enrichListAuthors(response, {
    idsForItem: commentAuthorIds,
    outputField: 'author',
    shouldEnrich: (item) => !looksHydrated(item.author) && commentAuthorIds(item).length > 0,
  })
}
