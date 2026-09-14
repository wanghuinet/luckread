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
