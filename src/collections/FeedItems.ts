import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

const encodeCursor = (publishedAt: string, id: string) => btoa(JSON.stringify({ publishedAt, id }))

const decodeCursor = (value: string): { publishedAt: string; id: string } => {
  try {
    const parsed = JSON.parse(atob(value)) as { publishedAt?: unknown; id?: unknown }
    if (typeof parsed.publishedAt !== 'string' || typeof parsed.id !== 'string' || !parsed.publishedAt || !parsed.id) throw new Error('invalid')
    return { publishedAt: parsed.publishedAt, id: parsed.id }
  } catch {
    throw new APIError('Invalid cursor', 400)
  }
}

const activeRelationIds = async (req: any, collection: 'social-blocks' | 'social-mutes', field: 'blocked' | 'muted', userId: string) => {
  const result = await req.payload.find({
    collection,
    where: { and: [{ [collection === 'social-blocks' ? 'blocker' : 'muter']: { equals: userId } }, { status: { equals: 'ACTIVE' } }] },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
    req,
  })
  return result.docs.map((doc: any) => String(doc[field]))
}

export const FeedItems: CollectionConfig = {
  slug: 'feed-items',
  admin: { useAsTitle: 'feedKey' },
  access: { read: ({ req }) => Boolean(req.user), create: () => false, update: () => false, delete: () => false },
  endpoints: [
    {
      path: '/publish',
      method: 'post',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const body = await req.json() as { content?: string | number; source?: string }
        if (!body.content) throw new APIError('content is required', 400)
        const content = await req.payload.findByID({ collection: 'content', id: body.content, depth: 0, overrideAccess: true, req })
        if (content.state !== 'PUBLISHED') throw new APIError('Only published content can enter feed', 409)
        const feedKey = `home:${String(content.id)}`
        const existing = await req.payload.find({ collection: 'feed-items', where: { feedKey: { equals: feedKey } }, limit: 1, depth: 0, overrideAccess: true, req })
        if (existing.docs.length) return Response.json({ data: existing.docs[0], idempotent: true })
        const created = await req.payload.create({ collection: 'feed-items', data: { feedKey, content: content.id, author: content.author, source: body.source || 'publish', visibility: 'PUBLIC', publishedAt: content.publishedAt || new Date().toISOString(), score: 0 }, overrideAccess: true, req })
        return Response.json({ data: created, idempotent: false }, { status: 201 })
      },
      custom: { openapi: { summary: 'Index published content into the rebuildable feed' } },
    },
    {
      path: '/home',
      method: 'get',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const userId = String(req.user.id)
        const limit = Math.min(Math.max(Number(req.query?.limit || 20), 1), 50)
        const cursorValue = String(req.query?.cursor || '')
        const where: any = { and: [{ visibility: { equals: 'PUBLIC' } }] }
        if (cursorValue) {
          const cursor = decodeCursor(cursorValue)
          where.and.push({ or: [{ publishedAt: { less_than: cursor.publishedAt } }, { and: [{ publishedAt: { equals: cursor.publishedAt } }, { id: { less_than: cursor.id } }] }] })
        }
        const excluded = new Set([
          ...(await activeRelationIds(req, 'social-blocks', 'blocked', userId)),
          ...(await activeRelationIds(req, 'social-mutes', 'muted', userId)),
        ])
        if (excluded.size) where.and.push({ author: { not_in: [...excluded] } })
        const result = await req.payload.find({ collection: 'feed-items', where, sort: '-publishedAt,-id', limit: limit + 1, depth: 1, overrideAccess: true, req })
        const visible = result.docs.filter((item: any) => item.content && typeof item.content === 'object' && item.content.state === 'PUBLISHED')
        const page = visible.slice(0, limit)
        const last = page[page.length - 1] as any
        const hasNextPage = visible.length > limit
        const nextCursor = hasNextPage && last ? encodeCursor(String(last.publishedAt), String(last.id)) : null
        return Response.json({ data: page, pagination: { limit, nextCursor, hasNextPage } })
      },
      custom: { openapi: { summary: 'Read the public home feed with opaque cursor and safety filters' } },
    },
    {
      path: '/following',
      method: 'get',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const userId = String(req.user.id)
        const limit = Math.min(Math.max(Number(req.query?.limit || 20), 1), 50)
        const cursorValue = String(req.query?.cursor || '')
        const follows = await req.payload.find({ collection: 'follows', where: { and: [{ follower: { equals: userId } }, { status: { equals: 'ACTIVE' } }] }, limit: 1000, depth: 0, overrideAccess: true, req })
        const followingIds = follows.docs.map((doc: any) => String(doc.following))
        if (!followingIds.length) return Response.json({ data: [], pagination: { limit, nextCursor: null, hasNextPage: false } })
        const excluded = new Set([
          ...(await activeRelationIds(req, 'social-blocks', 'blocked', userId)),
          ...(await activeRelationIds(req, 'social-mutes', 'muted', userId)),
        ])
        const allowedAuthors = followingIds.filter((id) => !excluded.has(id))
        if (!allowedAuthors.length) return Response.json({ data: [], pagination: { limit, nextCursor: null, hasNextPage: false } })
        const where: any = { and: [{ visibility: { equals: 'PUBLIC' } }, { author: { in: allowedAuthors } }] }
        if (cursorValue) {
          const cursor = decodeCursor(cursorValue)
          where.and.push({ or: [{ publishedAt: { less_than: cursor.publishedAt } }, { and: [{ publishedAt: { equals: cursor.publishedAt } }, { id: { less_than: cursor.id } }] }] })
        }
        const result = await req.payload.find({ collection: 'feed-items', where, sort: '-publishedAt,-id', limit: limit + 1, depth: 1, overrideAccess: true, req })
        const visible = result.docs.filter((item: any) => item.content && typeof item.content === 'object' && item.content.state === 'PUBLISHED')
        const page = visible.slice(0, limit)
        const last = page[page.length - 1] as any
        const hasNextPage = visible.length > limit
        const nextCursor = hasNextPage && last ? encodeCursor(String(last.publishedAt), String(last.id)) : null
        return Response.json({ data: page, pagination: { limit, nextCursor, hasNextPage } })
      },
      custom: { openapi: { summary: 'Read the authenticated users following feed with block and mute filtering' } },
    },
  ],
  fields: [
    { name: 'feedKey', type: 'text', required: true, unique: true, index: true },
    { name: 'content', type: 'relationship', relationTo: 'content', required: true, index: true },
    { name: 'author', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'source', type: 'text', required: true, index: true },
    { name: 'visibility', type: 'select', required: true, defaultValue: 'PUBLIC', options: ['PUBLIC', 'HIDDEN'], index: true },
    { name: 'publishedAt', type: 'date', required: true, index: true },
    { name: 'score', type: 'number', required: true, defaultValue: 0, index: true },
  ],
  timestamps: true,
}
