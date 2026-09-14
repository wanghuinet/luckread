import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

export const SocialMutes: CollectionConfig = {
  slug: 'social-mutes',
  admin: { useAsTitle: 'muteKey' },
  access: { read: ({ req }) => Boolean(req.user), create: ({ req }) => Boolean(req.user), update: ({ req }) => Boolean(req.user), delete: () => false },
  endpoints: [
    { path: '/:userId/mute', method: 'post', handler: async (req) => {
      if (!req.user) throw new APIError('Authentication required', 401)
      const muted = String(req.routeParams?.userId ?? ''), muter = String(req.user.id)
      if (!muted || muted === muter) throw new APIError('Invalid muted user', 400)
      const muteKey = `${muter}:${muted}`
      const existing = await req.payload.find({ collection: 'social-mutes', where: { muteKey: { equals: muteKey } }, limit: 1, depth: 0, overrideAccess: true, req })
      if (existing.docs.length) {
        const current = existing.docs[0]
        const data = current.status === 'ACTIVE' ? current : await req.payload.update({ collection: 'social-mutes', id: current.id, data: { status: 'ACTIVE' }, overrideAccess: true, req })
        return Response.json({ data, idempotent: true })
      }
      const data = await req.payload.create({ collection: 'social-mutes', data: { muteKey, muter, muted, status: 'ACTIVE' }, overrideAccess: true, req })
      return Response.json({ data, idempotent: false }, { status: 201 })
    }, custom: { openapi: { summary: 'Mute a user idempotently' } } },
    { path: '/:userId/mute', method: 'delete', handler: async (req) => {
      if (!req.user) throw new APIError('Authentication required', 401)
      const muteKey = `${String(req.user.id)}:${String(req.routeParams?.userId ?? '')}`
      const existing = await req.payload.find({ collection: 'social-mutes', where: { muteKey: { equals: muteKey } }, limit: 1, depth: 0, overrideAccess: true, req })
      if (!existing.docs.length) return Response.json({ data: null, idempotent: true })
      const data = await req.payload.update({ collection: 'social-mutes', id: existing.docs[0].id, data: { status: 'REVOKED' }, overrideAccess: true, req })
      return Response.json({ data, idempotent: true })
    }, custom: { openapi: { summary: 'Unmute a user idempotently' } } },
  ],
  fields: [
    { name: 'muteKey', type: 'text', required: true, unique: true, index: true },
    { name: 'muter', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'muted', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'status', type: 'select', required: true, defaultValue: 'ACTIVE', options: ['ACTIVE', 'REVOKED'], index: true },
  ],
  timestamps: true,
}
