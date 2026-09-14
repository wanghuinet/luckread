import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

export const SocialBlocks: CollectionConfig = {
  slug: 'social-blocks',
  admin: { useAsTitle: 'blockKey' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: () => false,
  },
  endpoints: [
    {
      path: '/:userId/block',
      method: 'post',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const blocked = String(req.routeParams?.userId ?? '')
        const blocker = String(req.user.id)
        if (!blocked || blocked === blocker) throw new APIError('Invalid blocked user', 400)
        const blockKey = `${blocker}:${blocked}`
        const existing = await req.payload.find({ collection: 'social-blocks', where: { blockKey: { equals: blockKey } }, limit: 1, depth: 0, overrideAccess: true, req })
        if (existing.docs.length) {
          const updated = existing.docs[0].status === 'ACTIVE' ? existing.docs[0] : await req.payload.update({ collection: 'social-blocks', id: existing.docs[0].id, data: { status: 'ACTIVE' }, overrideAccess: true, req })
          return Response.json({ data: updated, idempotent: true })
        }
        const created = await req.payload.create({ collection: 'social-blocks', data: { blockKey, blocker, blocked, status: 'ACTIVE' }, overrideAccess: true, req })
        return Response.json({ data: created, idempotent: false }, { status: 201 })
      },
      custom: { openapi: { summary: 'Block a user idempotently' } },
    },
    {
      path: '/:userId/block',
      method: 'delete',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const blockKey = `${String(req.user.id)}:${String(req.routeParams?.userId ?? '')}`
        const existing = await req.payload.find({ collection: 'social-blocks', where: { blockKey: { equals: blockKey } }, limit: 1, depth: 0, overrideAccess: true, req })
        if (!existing.docs.length) return Response.json({ data: null, idempotent: true })
        const updated = await req.payload.update({ collection: 'social-blocks', id: existing.docs[0].id, data: { status: 'REVOKED' }, overrideAccess: true, req })
        return Response.json({ data: updated, idempotent: true })
      },
      custom: { openapi: { summary: 'Unblock a user idempotently' } },
    },
  ],
  fields: [
    { name: 'blockKey', type: 'text', required: true, unique: true, index: true },
    { name: 'blocker', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'blocked', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'status', type: 'select', required: true, defaultValue: 'ACTIVE', options: ['ACTIVE', 'REVOKED'], index: true },
  ],
  timestamps: true,
}
