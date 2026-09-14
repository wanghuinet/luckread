import type { CollectionConfig } from 'payload'

import { hasPermission, type AuthorizationUser } from '../lib/authorization'

const membershipRoles = ['owner', 'admin', 'editor', 'operator', 'member'] as const
const membershipStatuses = ['ACTIVE', 'SUSPENDED', 'REVOKED'] as const

function relationshipId(value: unknown): string | number | null {
  if (typeof value === 'string' || typeof value === 'number') return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    return typeof id === 'string' || typeof id === 'number' ? id : null
  }
  return null
}

function canManageMembership(reqUser: unknown): boolean {
  return hasPermission(reqUser as AuthorizationUser | null, 'organization.members.manage')
}

export const OrganizationMemberships: CollectionConfig = {
  slug: 'organization-memberships',
  admin: { useAsTitle: 'role' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => canManageMembership(req.user),
    update: ({ req }) => canManageMembership(req.user),
    delete: ({ req }) => canManageMembership(req.user),
  },
  hooks: {
    beforeChange: [
      ({ data, req }) => {
        if (!relationshipId(data.organization)) throw new Error('Organization is required')
        if (!canManageMembership(req.user)) throw new Error('Organization membership management permission denied')
        if (data.role && !membershipRoles.includes(data.role)) throw new Error('Invalid organization membership role')
        if (data.status && !membershipStatuses.includes(data.status)) throw new Error('Invalid organization membership status')
        return data
      },
    ],
  },
  fields: [
    { name: 'organization', type: 'relationship', relationTo: 'organizations', required: true, index: true },
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'role', type: 'select', required: true, options: membershipRoles.map((value) => ({ label: value, value })) },
    { name: 'status', type: 'select', required: true, defaultValue: 'ACTIVE', options: membershipStatuses.map((value) => ({ label: value, value })), index: true },
    { name: 'scopes', type: 'json' },
    { name: 'startsAt', type: 'date', required: true },
    { name: 'endsAt', type: 'date' },
  ],
  timestamps: true,
}
