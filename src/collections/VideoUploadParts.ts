import type { CollectionConfig } from 'payload'

const states = ['RECEIVED', 'VERIFIED', 'FAILED', 'DELETED'] as const

export const VideoUploadParts: CollectionConfig = {
  slug: 'video-upload-parts',
  admin: { useAsTitle: 'partKey', defaultColumns: ['partKey', 'uploadSession', 'partNumber', 'state', 'updatedAt'] },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'partKey', type: 'text', required: true, unique: true, index: true },
    { name: 'uploadSession', type: 'relationship', relationTo: 'video-upload-sessions', required: true, index: true },
    { name: 'partNumber', type: 'number', required: true, min: 1, index: true },
    { name: 'sizeBytes', type: 'number', required: true, min: 1 },
    { name: 'sha256', type: 'text', required: true, index: true },
    { name: 'r2Key', type: 'text', required: true, unique: true },
    { name: 'etag', type: 'text', maxLength: 255 },
    { name: 'state', type: 'select', required: true, defaultValue: 'RECEIVED', options: states.map((value) => ({ label: value, value })), index: true },
    { name: 'receivedAt', type: 'date', required: true },
    { name: 'verifiedAt', type: 'date' },
  ],
  timestamps: true,
}
