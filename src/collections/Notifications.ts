import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

export const Notifications: CollectionConfig = {
  slug: 'notifications',
  admin: { useAsTitle: 'dedupeKey' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: () => false,
  },
  endpoints: [
    {
      path: '/create-idempotent',
      method: 'post',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const body = await req.json() as {
          recipient?: string | number; actor?: string | number; type?: string; content?: string | number; comment?: string | number; dedupeKey?: string; payload?: unknown
        }
        if (!body.recipient || !body.type || !body.dedupeKey) throw new APIError('recipient, type and dedupeKey are required', 400)
        const existing = await req.payload.find({ collection: 'notifications', where: { dedupeKey: { equals: body.dedupeKey } }, limit: 1, depth: 0, overrideAccess: true, req })
        if (existing.docs.length) return Response.json({ data: existing.docs[0], idempotent: true })
        const created = await req.payload.create({
          collection: 'notifications',
          data: {
            recipient: body.recipient,
            actor: body.actor,
            type: body.type,
            content: body.content,
            comment: body.comment,
            dedupeKey: body.dedupeKey,
            payload: body.payload,
          },
          overrideAccess: true,
          req,
        })
        return Response.json({ data: created, idempotent: false }, { status: 201 })
      },
      custom: { openapi: { summary: 'Create a notification with deduplication' } },
    },
    {
      path: '/:id/read',
      method: 'post',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const current = await req.payload.findByID({ collection: 'notifications', id: String(req.routeParams?.id), depth: 0, overrideAccess: true, req })
        if (String(current.recipient) !== String(req.user.id)) throw new APIError('Permission denied', 403)
        if (current.readAt) return Response.json({ data: current, idempotent: true })
        const updated = await req.payload.update({ collection: 'notifications', id: current.id, data: { readAt: new Date().toISOString() }, overrideAccess: true, req })
        return Response.json({ data: updated, idempotent: false })
      },
      custom: { openapi: { summary: 'Mark an owned notification as read' } },
    },
  ],
  fields: [
    { name: 'recipient', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'actor', type: 'relationship', relationTo: 'users', index: true },
    { name: 'type', type: 'select', required: true, options: ['FOLLOW', 'LIKE', 'COMMENT', 'REPLY', 'MENTION', 'SYSTEM', 'CREATOR', 'REVENUE'], index: true },
    { name: 'content', type: 'relationship', relationTo: 'content', index: true },
    { name: 'comment', type: 'relationship', relationTo: 'comments', index: true },
    { name: 'dedupeKey', type: 'text', required: true, unique: true, index: true },
    { name: 'payload', type: 'json' },
    { name: 'readAt', type: 'date', index: true },
  ],
  timestamps: true,
}
