import type { CollectionConfig } from 'payload'

export const ContentSeries: CollectionConfig = {
  slug: 'content-series',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug', 'owner', 'status', 'updatedAt'] },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 200 },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'description', type: 'textarea', maxLength: 2000 },
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'coverMedia', type: 'relationship', relationTo: 'media' },
    { name: 'status', type: 'select', required: true, defaultValue: 'ACTIVE', options: [{ label: 'Active', value: 'ACTIVE' }, { label: 'Hidden', value: 'HIDDEN' }, { label: 'Archived', value: 'ARCHIVED' }], index: true },
    { name: 'seriesType', type: 'select', required: true, defaultValue: 'SERIES', options: [{ label: 'Series', value: 'SERIES' }, { label: 'Collection', value: 'COLLECTION' }, { label: 'Playlist', value: 'PLAYLIST' }], index: true },
    { name: 'locale', type: 'text', required: true, defaultValue: 'en-US', index: true },
  ],
  timestamps: true,
}
