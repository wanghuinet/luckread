import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

export const Organizations: CollectionConfig = {
  slug: 'organizations',
  admin: { useAsTitle: 'name' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  endpoints: [
    {
      path: '/:id/members',
      method: 'get',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const organizationId = String(req.routeParams.id)
        const membership = await req.payload.find({
          collection: 'organization-memberships',
          where: { and: [{ organization: { equals: organizationId } }, { user: { equals: String(req.user.id) } }, { status: { equals: 'ACTIVE' } }] },
          limit: 1,
          depth: 0,
          overrideAccess: true,
          req,
        })
        if (membership.docs.length !== 1 && String((req.user as { role?: string }).role ?? '') !== 'admin' && String((req.user as { role?: string }).role ?? '') !== 'super_admin') {
          throw new APIError('Organization membership required', 403)
        }
        const members = await req.payload.find({
          collection: 'organization-memberships',
          where: { organization: { equals: organizationId } },
          limit: 100,
          depth: 1,
          overrideAccess: true,
          req,
        })
        return Response.json({ data: members.docs })
      },
      custom: { openapi: { summary: 'List organization members within caller scope' } },
    },
  ],
  fields: [
    { name: 'name', type: 'text', required: true, index: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'organizationType', type: 'select', required: true, defaultValue: 'creator_org', options: [
      { label: 'Creator Organization', value: 'creator_org' },
      { label: 'MCN', value: 'mcn' },
      { label: 'Publisher', value: 'publisher' },
      { label: 'Brand', value: 'brand' },
    ] },
    { name: 'status', type: 'select', required: true, defaultValue: 'ACTIVE', options: [
      { label: 'Active', value: 'ACTIVE' },
      { label: 'SUSPENDED', value: 'SUSPENDED' },
      { label: 'DELETED', value: 'DELETED' },
    ], index: true },
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'metadata', type: 'json' },
  ],
  timestamps: true,
}
