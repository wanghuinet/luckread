import type { CollectionConfig } from 'payload'

const states = ['UPLOADING', 'UPLOADED', 'VALIDATING', 'QUEUED', 'PROCESSING', 'READY', 'FAILED', 'CANCELLED', 'DELETED'] as const
const deliveryFormats = ['MP4', 'HLS'] as const

export const VideoAssets: CollectionConfig = {
  slug: 'video-assets',
  admin: { useAsTitle: 'originalFilename', defaultColumns: ['originalFilename', 'state', 'content', 'durationMs', 'updatedAt'] },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'content', type: 'relationship', relationTo: 'content', required: true, index: true },
    { name: 'originalFilename', type: 'text', required: true, maxLength: 255 },
    { name: 'mimeType', type: 'text', required: true, maxLength: 100, index: true },
    { name: 'sizeBytes', type: 'number', required: true, min: 1 },
    { name: 'sha256', type: 'text', required: true, index: true },
    { name: 'uploadId', type: 'text', required: true, unique: true, index: true },
    { name: 'state', type: 'select', required: true, defaultValue: 'UPLOADING', options: states.map((value) => ({ label: value, value })), index: true },
    { name: 'chunkSizeBytes', type: 'number', min: 1 },
    { name: 'totalChunks', type: 'number', min: 1 },
    { name: 'uploadedChunks', type: 'number', required: true, defaultValue: 0, min: 0 },
    { name: 'uploadExpiresAt', type: 'date', index: true },
    { name: 'failureCode', type: 'text', maxLength: 100 },
    { name: 'failureMessage', type: 'textarea', maxLength: 1000 },
    { name: 'retryCount', type: 'number', required: true, defaultValue: 0, min: 0 },
    { name: 'durationMs', type: 'number', min: 0, index: true },
    { name: 'width', type: 'number', min: 1 },
    { name: 'height', type: 'number', min: 1 },
    { name: 'orientation', type: 'select', options: [{ label: 'Landscape', value: 'LANDSCAPE' }, { label: 'Portrait', value: 'PORTRAIT' }, { label: 'Square', value: 'SQUARE' }] },
    { name: 'frameRate', type: 'number', min: 0 },
    { name: 'videoCodec', type: 'text', maxLength: 50 },
    { name: 'audioCodec', type: 'text', maxLength: 50 },
    { name: 'bitrate', type: 'number', min: 0 },
    { name: 'sourceR2Key', type: 'text', required: true },
    { name: 'coverMedia', type: 'relationship', relationTo: 'media' },
    { name: 'posterR2Key', type: 'text' },
    { name: 'deliveryFormats', type: 'select', hasMany: true, options: deliveryFormats.map((value) => ({ label: value, value })) },
    { name: 'hlsMasterR2Key', type: 'text' },
    { name: 'mp4R2Key', type: 'text' },
    { name: 'processedAt', type: 'date' },
    { name: 'lastAttemptAt', type: 'date' },
    { name: 'deletedAt', type: 'date' },
  ],
  timestamps: true,
}
