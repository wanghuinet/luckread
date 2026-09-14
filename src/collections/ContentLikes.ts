import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

export const ContentLikes: CollectionConfig = {
  slug: 'content-likes',
  admin: { useAsTitle: 'likeKey' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: () => false,
  },
  endpoints: [
    {
      path: '/:contentId/like',
      method: 'post',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const contentId = String(req.routeParams?.contentId ?? '')
        const userId = String(req.user.id)
        if (!contentId) throw new APIError('contentId is required', 400)
        const content = await req.payload.findByID({ collection: 'content', id: contentId, depth: 0, overrideAccess: true, req })
        if (content.state !== 'PUBLISHED') throw new APIError('Only published content can be liked', 409)
        const likeKey = `${userId}:${contentId}`
        const existing = await req.payload.find({ collection: 'content-likes', where: { likeKey: { equals: likeKey } }, limit: 1, depth: 0, overrideAccess: true, req })
        if (existing.docs.length) {
          const current = existing.docs[0]
          if (current.status === 'ACTIVE') return Response.json({ data: current, idempotent: true })
          const restored = await req.payload.update({ collection: 'content-likes', id: current.id, data: { status: 'ACTIVE' }, overrideAccess: true, req })
          return Response.json({ data: restored, idempotent: true })
        }
        const created = await req.payload.create({ collection: 'content-likes', data: { likeKey, content: contentId, user: userId, status: 'ACTIVE' }, overrideAccess: true, req })
        return Response.json({ data: created, idempotent: false }, { status: 201 })
      },
      custom: { openapi: { summary: 'Create or reactivate a content like' } },
    },
    {
      path: '/:contentId/like',
      method: 'delete',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const likeKey = `${String(req.user.id)}:${String(req.routeParams?.contentId ?? '')}`
        const existing = await req.payload.find({ collection: 'content-likes', where: { likeKey: { equals: likeKey } }, limit: 1, depth: 0, overrideAccess: true, req })
        if (!existing.docs.length) return Response.json({ data: null, idempotent: true })
        const updated = await req.payload.update({ collection: 'content-likes', id: existing.docs[0].id, data: { status: 'REVOKED' }, overrideAccess: true, req })
        return Response.json({ data: updated, idempotent: true })
      },
      custom: { openapi: { summary: 'Revoke a content like idempotently' } },
    },
  ],
  fields: [
    { name: 'likeKey', type: 'text', required: true, unique: true, index: true },
    { name: 'content', type: 'relationship', relationTo: 'content', required: true, index: true },
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'status', type: 'select', required: true, defaultValue: 'ACTIVE', options: ['ACTIVE', 'REVOKED'], index: true },
  ],
  timestamps: true,
}
