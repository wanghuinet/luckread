import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

export const FeedItems: CollectionConfig = {
  slug: 'feed-items',
  admin: { useAsTitle: 'feedKey' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: () => false,
    update: () => false,
    delete: () => false,
  },
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
        const created = await req.payload.create({
          collection: 'feed-items',
          data: { feedKey, content: content.id, author: content.author, source: body.source || 'publish', visibility: 'PUBLIC', publishedAt: content.publishedAt || new Date().toISOString(), score: 0 },
          overrideAccess: true,
          req,
        })
        return Response.json({ data: created, idempotent: false }, { status: 201 })
      },
      custom: { openapi: { summary: 'Index published content into the rebuildable feed' } },
    },
    {
      path: '/home',
      method: 'get',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const limit = Math.min(Math.max(Number(req.query?.limit || 20), 1), 50)
        const cursor = String(req.query?.cursor || '')
        const where: Record<string, unknown> = { visibility: { equals: 'PUBLIC' } }
        if (cursor) where.publishedAt = { less_than: cursor }
        const result = await req.payload.find({ collection: 'feed-items', where, sort: '-publishedAt,-id', limit, depth: 1, overrideAccess: true, req })
        const docs = result.docs.filter((item) => item.content && typeof item.content === 'object' && item.content.state === 'PUBLISHED')
        const nextCursor = docs.length === limit ? String(docs[docs.length - 1].publishedAt || '') : null
        return Response.json({ data: docs, pagination: { limit, nextCursor, hasNextPage: Boolean(nextCursor) } })
      },
      custom: { openapi: { summary: 'Read the public home feed with cursor pagination' } },
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
