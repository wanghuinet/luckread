import type { CollectionConfig } from 'payload'

const states = ['OPEN', 'COMPLETING', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'FAILED'] as const

export const VideoUploadSessions: CollectionConfig = {
  slug: 'video-upload-sessions',
  admin: { useAsTitle: 'uploadId', defaultColumns: ['uploadId', 'videoAsset', 'state', 'expiresAt', 'updatedAt'] },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'uploadId', type: 'text', required: true, unique: true, index: true },
    { name: 'videoAsset', type: 'relationship', relationTo: 'video-assets', required: true, unique: true, index: true },
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'state', type: 'select', required: true, defaultValue: 'OPEN', options: states.map((value) => ({ label: value, value })), index: true },
    { name: 'objectKey', type: 'text', required: true, unique: true, index: true },
    { name: 'expectedSha256', type: 'text', required: true, index: true },
    { name: 'expectedSizeBytes', type: 'number', required: true, min: 1 },
    { name: 'chunkSizeBytes', type: 'number', required: true, min: 1 },
    { name: 'totalChunks', type: 'number', required: true, min: 1 },
    { name: 'receivedChunks', type: 'number', required: true, defaultValue: 0, min: 0 },
    { name: 'expiresAt', type: 'date', required: true, index: true },
    { name: 'completedAt', type: 'date' },
    { name: 'cancelledAt', type: 'date' },
    { name: 'failureCode', type: 'text', maxLength: 100 },
    { name: 'failureMessage', type: 'textarea', maxLength: 1000 },
    { name: 'version', type: 'number', required: true, defaultValue: 1, min: 1 },
  ],
  timestamps: true,
}
