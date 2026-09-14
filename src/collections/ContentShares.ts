import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

export const ContentShares: CollectionConfig = {
  slug: 'content-shares',
  admin: { useAsTitle: 'shareId' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: () => false,
    delete: () => false,
  },
  endpoints: [{
    path: '/create-idempotent',
    method: 'post',
    handler: async (req) => {
      if (!req.user) throw new APIError('Authentication required', 401)
      const body = await req.json() as { content?: string | number; channel?: string; target?: string; requestId?: string; metadata?: unknown }
      if (!body.content || !body.channel || !body.requestId) throw new APIError('content, channel and requestId are required', 400)
      const existing = await req.payload.find({
        collection: 'content-shares',
        where: { requestId: { equals: body.requestId } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
        req,
      })
      if (existing.docs.length === 1) return Response.json({ data: existing.docs[0], idempotent: true })
      const content = await req.payload.findByID({ collection: 'content', id: body.content, depth: 0, overrideAccess: true, req })
      if (content.state !== 'PUBLISHED') throw new APIError('Only published content can be shared', 409)
      const created = await req.payload.create({
        collection: 'content-shares',
        data: {
          shareId: `${String(req.user.id)}:${body.requestId}`,
          content: body.content,
          user: String(req.user.id),
          channel: body.channel,
          target: body.target,
          requestId: body.requestId,
          metadata: body.metadata,
        },
        overrideAccess: true,
        req,
      })
      return Response.json({ data: created, idempotent: false }, { status: 201 })
    },
    custom: { openapi: { summary: 'Create a content share with request-id idempotency' } },
  }],
  fields: [
    { name: 'shareId', type: 'text', required: true, unique: true, index: true },
    { name: 'content', type: 'relationship', relationTo: 'content', required: true, index: true },
    { name: 'user', type: 'relationship', relationTo: 'users', index: true },
    { name: 'channel', type: 'text', required: true, index: true },
    { name: 'target', type: 'text' },
    { name: 'requestId', type: 'text', required: true, unique: true, index: true },
    { name: 'metadata', type: 'json' },
  ],
  timestamps: true,
}
