import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

export const Follows: CollectionConfig = {
  slug: 'follows',
  admin: { useAsTitle: 'followKey' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: () => false,
  },
  endpoints: [
    {
      path: '/:userId/follow',
      method: 'post',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const userId = String(req.routeParams?.userId ?? '')
        const follower = String(req.user.id)
        if (!userId) throw new APIError('userId is required', 400)
        if (userId === follower) throw new APIError('Self-follow is not allowed', 409)
        const followKey = `${follower}:${userId}`
        const existing = await req.payload.find({
          collection: 'follows',
          where: { followKey: { equals: followKey } },
          limit: 1,
          depth: 0,
          overrideAccess: true,
          req,
        })
        if (existing.docs.length) {
          const current = existing.docs[0]
          if (current.status === 'ACTIVE') return Response.json({ data: current, idempotent: true })
          const restored = await req.payload.update({
            collection: 'follows', id: current.id,
            data: { status: 'ACTIVE' }, overrideAccess: true, req,
          })
          return Response.json({ data: restored, idempotent: true })
        }
        const target = await req.payload.findByID({ collection: 'users', id: userId, depth: 0, overrideAccess: true, req })
        if (['BANNED', 'DELETED'].includes(String(target.accountState))) throw new APIError('Target user is not followable', 409)
        const created = await req.payload.create({
          collection: 'follows',
          data: { followKey, follower, following: userId, status: 'ACTIVE' },
          overrideAccess: true, req,
        })
        return Response.json({ data: created, idempotent: false }, { status: 201 })
      },
      custom: { openapi: { summary: 'Create or reactivate a follow relation' } },
    },
    {
      path: '/:userId/follow',
      method: 'delete',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const userId = String(req.routeParams?.userId ?? '')
        const followKey = `${String(req.user.id)}:${userId}`
        const existing = await req.payload.find({ collection: 'follows', where: { followKey: { equals: followKey } }, limit: 1, depth: 0, overrideAccess: true, req })
        if (!existing.docs.length) return Response.json({ data: null, idempotent: true })
        const updated = await req.payload.update({ collection: 'follows', id: existing.docs[0].id, data: { status: 'REVOKED' }, overrideAccess: true, req })
        return Response.json({ data: updated, idempotent: true })
      },
      custom: { openapi: { summary: 'Revoke a follow relation idempotently' } },
    },
  ],
  fields: [
    { name: 'followKey', type: 'text', required: true, unique: true, index: true },
    { name: 'follower', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'following', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'status', type: 'select', required: true, defaultValue: 'ACTIVE', options: ['ACTIVE', 'REVOKED'], index: true },
  ],
  timestamps: true,
}
