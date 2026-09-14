import type { CollectionConfig } from 'payload'

export const IPs: CollectionConfig = {
  slug: 'ips',
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
    { name: 'principal', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'organization', type: 'relationship', relationTo: 'organizations', index: true },
    { name: 'status', type: 'select', required: true, defaultValue: 'ACTIVE', options: [
      { label: 'Active', value: 'ACTIVE' },
      { label: 'Restricted', value: 'RESTRICTED' },
      { label: 'Suspended', value: 'SUSPENDED' },
      { label: 'Deleted', value: 'DELETED' },
    ], index: true },
    { name: 'description', type: 'textarea' },
  ],
  timestamps: true,
}
