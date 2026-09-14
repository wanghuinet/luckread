import type { CollectionConfig } from 'payload'

const sources = ['manual', 'subscription', 'organization', 'promotion', 'system'] as const

export const EntitlementGrants: CollectionConfig = {
  slug: 'entitlement-grants',
  admin: { useAsTitle: 'entitlement' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'entitlement', type: 'relationship', relationTo: 'entitlements', required: true, index: true },
    { name: 'sourceType', type: 'select', required: true, options: sources.map((value) => ({ label: value, value })) },
    { name: 'sourceId', type: 'text', index: true },
    { name: 'scope', type: 'json' },
    { name: 'startsAt', type: 'date', required: true },
    { name: 'endsAt', type: 'date' },
    { name: 'status', type: 'select', required: true, defaultValue: 'ACTIVE', options: [
      { label: 'Active', value: 'ACTIVE' },
      { label: 'Revoked', value: 'REVOKED' },
      { label: 'Expired', value: 'EXPIRED' },
    ], index: true },
    { name: 'metadata', type: 'json' },
  ],
  timestamps: true,
}
