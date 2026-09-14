import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

import { hasPermission, type AuthorizationUser } from '../lib/authorization'
import { assertOrganizationScope } from '../lib/organization-scope'

function relationshipId(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && 'id' in value) { const id = (value as { id?: unknown }).id; return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined }
  return undefined
}

const canAdminister = (user: unknown) => hasPermission(user as AuthorizationUser | null, 'organization.members.manage')

export const IPs: CollectionConfig = {
  slug: 'ips',
  admin: { useAsTitle: 'name' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  hooks: {
    beforeChange: [async ({ data, originalDoc, req }) => {
      if (!req.user) throw new APIError('Authentication required', 401)
      const organizationId = relationshipId(data.organization ?? originalDoc?.organization)
      const principalId = relationshipId(data.principal ?? originalDoc?.principal)
      const actorId = String(req.user.id)
      if (!principalId) throw new APIError('IP principal is required', 400)
      if (!organizationId) throw new APIError('Organization is required for IP scope', 400)
      const isAdmin = canAdminister(req.user)
      if (!isAdmin && principalId !== actorId) throw new APIError('IP principal ownership permission denied', 403)
      if (!isAdmin) await assertOrganizationScope({ payload: req.payload, user: req.user as AuthorizationUser, organizationId, requiredScope: 'ip.write' })
      return data
    }],
  },
  endpoints: [{
    path: '/:id/contents', method: 'get',
    handler: async (req) => {
      if (!req.user) throw new APIError('Authentication required', 401)
      const id = String(req.routeParams.id)
      const ip = await req.payload.findByID({ collection: 'ips', id, depth: 0, overrideAccess: true, req })
      const principalId = relationshipId(ip.principal)
      const organizationId = relationshipId(ip.organization)
      const actorId = String(req.user.id)
      const isAdmin = canAdminister(req.user)
      if (!isAdmin && principalId !== actorId) {
        if (!organizationId) throw new APIError('IP organization scope is missing', 403)
        await assertOrganizationScope({ payload: req.payload, user: req.user as AuthorizationUser, organizationId, requiredScope: 'ip.read' })
      }
      const result = await req.payload.find({ collection: 'content', where: { ip: { equals: id } }, depth: 0, limit: 50, req })
      return Response.json({ docs: result.docs, totalDocs: result.totalDocs, page: result.page, totalPages: result.totalPages })
    },
    custom: { openapi: { summary: 'List content owned by an IP principal within authorization scope' } },
  }],
  fields: [
    { name: 'name', type: 'text', required: true, index: true }, { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'principal', type: 'relationship', relationTo: 'users', required: true, index: true }, { name: 'organization', type: 'relationship', relationTo: 'organizations', required: true, index: true },
    { name: 'status', type: 'select', required: true, defaultValue: 'ACTIVE', options: [{ label: 'Active', value: 'ACTIVE' }, { label: 'Restricted', value: 'RESTRICTED' }, { label: 'Suspended', value: 'SUSPENDED' }, { label: 'Deleted', value: 'DELETED' }], index: true },
    { name: 'description', type: 'textarea' },
  ], timestamps: true,
}
