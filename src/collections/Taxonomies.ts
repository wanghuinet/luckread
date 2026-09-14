import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

const taxonomyTypes = ['CATEGORY', 'CHANNEL', 'TAG', 'TOPIC'] as const

export const Taxonomies: CollectionConfig = {
  slug: 'taxonomies',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'type', 'parent', 'status', 'updatedAt'] },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  hooks: {
    beforeChange: [({ data }) => {
      if (!taxonomyTypes.includes(data.type)) throw new APIError('Invalid taxonomy type', 400)
      if (data.type === 'TAG' || data.type === 'TOPIC') data.parent = null
      return data
    }],
  },
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 100, index: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'type', type: 'select', required: true, options: taxonomyTypes.map((value) => ({ label: value, value })), index: true },
    { name: 'parent', type: 'relationship', relationTo: 'taxonomies', index: true },
    { name: 'description', type: 'textarea', maxLength: 500 },
    { name: 'locale', type: 'text', required: true, defaultValue: 'en-US', index: true },
    { name: 'status', type: 'select', required: true, defaultValue: 'ACTIVE', options: [{ label: 'Active', value: 'ACTIVE' }, { label: 'Hidden', value: 'HIDDEN' }, { label: 'Archived', value: 'ARCHIVED' }], index: true },
    { name: 'sortOrder', type: 'number', defaultValue: 0, index: true },
  ],
  timestamps: true,
}
