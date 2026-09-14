import { APIError, type PayloadRequest } from 'payload'
import type { CollectionConfig } from 'payload'

import { hasPermission, type AuthorizationUser } from '../lib/authorization'

const membershipRoles = ['owner', 'admin', 'editor', 'operator', 'member'] as const
const membershipStatuses = ['ACTIVE', 'SUSPENDED', 'REVOKED'] as const

function relationshipId(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && 'id' in value) { const id = (value as { id?: unknown }).id; return typeof id === 'string' || typeof id === 'number' ? String(id) : null }
  return null
}
function platformAdmin(user: unknown): boolean {
  const role = String((user as { role?: string } | null)?.role ?? '')
  return role === 'admin' || role === 'super_admin'
}
async function canManageOrganization(req: PayloadRequest, organizationId: string, user: AuthorizationUser): Promise<boolean> {
  if (platformAdmin(user) && hasPermission(user, 'organization.members.manage')) return true
  const result = await req.payload.find({ collection: 'organization-memberships', where: { and: [{ organization: { equals: organizationId } }, { user: { equals: String(user.id) } }, { status: { equals: 'ACTIVE' } }] }, limit: 1, depth: 0, overrideAccess: true, req })
  const membership = result.docs[0]
  return Boolean(membership && (membership.role === 'owner' || membership.role === 'admin') && hasPermission(user, 'organization.members.manage'))
}

export const OrganizationMemberships: CollectionConfig = {
  slug: 'organization-memberships',
  admin: { useAsTitle: 'role' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user) && hasPermission(req.user as AuthorizationUser, 'organization.members.manage'),
    update: ({ req }) => Boolean(req.user) && hasPermission(req.user as AuthorizationUser, 'organization.members.manage'),
    delete: ({ req }) => Boolean(req.user) && hasPermission(req.user as AuthorizationUser, 'organization.members.manage'),
  },
  hooks: {
    beforeChange: [async ({ data, req }) => {
      if (!req.user) throw new APIError('Authentication required', 401)
      const organizationId = relationshipId(data.organization)
      if (!organizationId) throw new APIError('Organization is required', 400)
      if (!await canManageOrganization(req, organizationId, req.user as AuthorizationUser)) throw new APIError('Organization membership management permission denied for this organization', 403)
      if (data.role && !membershipRoles.includes(data.role)) throw new APIError('Invalid organization membership role')
      if (data.status && !membershipStatuses.includes(data.status)) throw new APIError('Invalid organization membership status')
      return data
    }],
  },
  fields: [
    { name: 'organization', type: 'relationship', relationTo: 'organizations', required: true, index: true },
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'role', type: 'select', required: true, options: membershipRoles.map((value) => ({ label: value, value })) },
    { name: 'status', type: 'select', required: true, defaultValue: 'ACTIVE', options: membershipStatuses.map((value) => ({ label: value, value })), index: true },
    { name: 'scopes', type: 'json' }, { name: 'startsAt', type: 'date', required: true }, { name: 'endsAt', type: 'date' },
  ],
  timestamps: true,
}
