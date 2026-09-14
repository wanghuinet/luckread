import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

export const ContentFavorites: CollectionConfig = {
  slug: 'content-favorites',
  admin: { useAsTitle: 'favoriteKey' },
  access: { read: ({ req }) => Boolean(req.user), create: ({ req }) => Boolean(req.user), update: ({ req }) => Boolean(req.user), delete: () => false },
  endpoints: [
    { path: '/:contentId/favorite', method: 'post', handler: async (req) => {
      if (!req.user) throw new APIError('Authentication required', 401)
      const contentId = String(req.routeParams?.contentId ?? ''), userId = String(req.user.id)
      const content = await req.payload.findByID({ collection: 'content', id: contentId, depth: 0, overrideAccess: true, req })
      if (content.state !== 'PUBLISHED') throw new APIError('Only published content can be favorited', 409)
      const favoriteKey = `${userId}:${contentId}`
      const existing = await req.payload.find({ collection: 'content-favorites', where: { favoriteKey: { equals: favoriteKey } }, limit: 1, depth: 0, overrideAccess: true, req })
      if (existing.docs.length) {
        const current = existing.docs[0]
        const data = current.status === 'ACTIVE' ? current : await req.payload.update({ collection: 'content-favorites', id: current.id, data: { status: 'ACTIVE' }, overrideAccess: true, req })
        return Response.json({ data, idempotent: true })
      }
      const data = await req.payload.create({ collection: 'content-favorites', data: { favoriteKey, content: contentId, user: userId, status: 'ACTIVE' }, overrideAccess: true, req })
      return Response.json({ data, idempotent: false }, { status: 201 })
    }, custom: { openapi: { summary: 'Favorite published content idempotently' } } },
    { path: '/:contentId/favorite', method: 'delete', handler: async (req) => {
      if (!req.user) throw new APIError('Authentication required', 401)
      const favoriteKey = `${String(req.user.id)}:${String(req.routeParams?.contentId ?? '')}`
      const existing = await req.payload.find({ collection: 'content-favorites', where: { favoriteKey: { equals: favoriteKey } }, limit: 1, depth: 0, overrideAccess: true, req })
      if (!existing.docs.length) return Response.json({ data: null, idempotent: true })
      const data = await req.payload.update({ collection: 'content-favorites', id: existing.docs[0].id, data: { status: 'REVOKED' }, overrideAccess: true, req })
      return Response.json({ data, idempotent: true })
    }, custom: { openapi: { summary: 'Unfavorite content idempotently' } } },
  ],
  fields: [
    { name: 'favoriteKey', type: 'text', required: true, unique: true, index: true },
    { name: 'content', type: 'relationship', relationTo: 'content', required: true, index: true },
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'status', type: 'select', required: true, defaultValue: 'ACTIVE', options: ['ACTIVE', 'REVOKED'], index: true },
  ],
  timestamps: true,
}
