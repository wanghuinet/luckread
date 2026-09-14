import type { CollectionConfig } from 'payload'

export const OrganizationMemberships: CollectionConfig = {
  slug: 'organization-memberships',
  admin: { useAsTitle: 'role' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'organization', type: 'relationship', relationTo: 'organizations', required: true, index: true },
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'role', type: 'select', required: true, options: [
      { label: 'Owner', value: 'owner' },
      { label: 'Admin', value: 'admin' },
      { label: 'Editor', value: 'editor' },
      { label: 'Operator', value: 'operator' },
      { label: 'Member', value: 'member' },
    ] },
    { name: 'status', type: 'select', required: true, defaultValue: 'ACTIVE', options: [
      { label: 'Active', value: 'ACTIVE' },
      { label: 'Suspended', value: 'SUSPENDED' },
      { label: 'Revoked', value: 'REVOKED' },
    ], index: true },
    { name: 'scopes', type: 'json' },
    { name: 'startsAt', type: 'date', required: true },
    { name: 'endsAt', type: 'date' },
  ],
  timestamps: true,
}
