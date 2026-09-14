import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

const MODERATION_ROLES = new Set(['moderator', 'admin', 'super_admin'])

export const Comments: CollectionConfig = {
  slug: 'comments',
  admin: { useAsTitle: 'commentKey' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: () => false,
  },
  endpoints: [
    {
      path: '/create',
      method: 'post',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const body = await req.json() as { content?: string | number; parent?: string | number; body?: string; requestId?: string }
        if (!body.content || !body.body?.trim() || !body.requestId) throw new APIError('content, body and requestId are required', 400)
        const existing = await req.payload.find({ collection: 'comments', where: { requestId: { equals: body.requestId } }, limit: 1, depth: 0, overrideAccess: true, req })
        if (existing.docs.length) return Response.json({ data: existing.docs[0], idempotent: true })
        const content = await req.payload.findByID({ collection: 'content', id: body.content, depth: 0, overrideAccess: true, req })
        if (content.state !== 'PUBLISHED') throw new APIError('Only published content can receive comments', 409)
        let parent: string | undefined
        if (body.parent) {
          const parentDoc = await req.payload.findByID({ collection: 'comments', id: body.parent, depth: 0, overrideAccess: true, req })
          if (String(parentDoc.content) !== String(body.content)) throw new APIError('Reply target belongs to another content item', 409)
          if (parentDoc.state === 'DELETED') throw new APIError('Cannot reply to a deleted comment', 409)
          parent = String(parentDoc.id)
        }
        const created = await req.payload.create({
          collection: 'comments',
          data: {
            commentKey: `${String(req.user.id)}:${body.requestId}`,
            requestId: body.requestId,
            content: body.content,
            parent,
            author: String(req.user.id),
            body: body.body.trim(),
            state: 'PENDING',
          },
          overrideAccess: true,
          req,
        })
        return Response.json({ data: created, idempotent: false }, { status: 201 })
      },
      custom: { openapi: { summary: 'Create a moderated comment or reply idempotently' } },
    },
    {
      path: '/:id/state',
      method: 'post',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        if (!MODERATION_ROLES.has(String(req.user.role))) throw new APIError('Moderation permission required', 403)
        const body = await req.json() as { state?: string }
        if (!body.state || !['APPROVED', 'REJECTED', 'DELETED'].includes(body.state)) throw new APIError('Invalid moderation state', 400)
        const current = await req.payload.findByID({ collection: 'comments', id: String(req.routeParams?.id), depth: 0, overrideAccess: true, req })
        if (current.state === 'DELETED' && body.state !== 'DELETED') throw new APIError('Deleted comments are terminal', 409)
        const updated = await req.payload.update({ collection: 'comments', id: current.id, data: { state: body.state }, overrideAccess: true, req })
        return Response.json({ data: updated })
      },
      custom: { openapi: { summary: 'Moderate a comment' } },
    },
    {
      path: '/:id/delete',
      method: 'post',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const current = await req.payload.findByID({ collection: 'comments', id: String(req.routeParams?.id), depth: 0, overrideAccess: true, req })
        const isOwner = String(current.author) === String(req.user.id)
        if (!isOwner && !MODERATION_ROLES.has(String(req.user.role))) throw new APIError('Permission denied', 403)
        if (current.state === 'DELETED') return Response.json({ data: current, idempotent: true })
        const updated = await req.payload.update({ collection: 'comments', id: current.id, data: { state: 'DELETED' }, overrideAccess: true, req })
        return Response.json({ data: updated, idempotent: false })
      },
      custom: { openapi: { summary: 'Soft-delete an owned comment' } },
    },
  ],
  fields: [
    { name: 'commentKey', type: 'text', required: true, unique: true, index: true },
    { name: 'requestId', type: 'text', required: true, unique: true, index: true },
    { name: 'content', type: 'relationship', relationTo: 'content', required: true, index: true },
    { name: 'parent', type: 'relationship', relationTo: 'comments', index: true },
    { name: 'author', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'body', type: 'textarea', required: true },
    { name: 'state', type: 'select', required: true, defaultValue: 'PENDING', options: ['PENDING', 'APPROVED', 'REJECTED', 'DELETED'], index: true },
  ],
  timestamps: true,
}
