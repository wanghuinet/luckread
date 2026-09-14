import type { CollectionConfig } from 'payload'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: ({ req }) => Boolean(req.user) || true,
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'alt', type: 'text', required: true, maxLength: 500 },
    { name: 'mediaKind', type: 'select', required: true, defaultValue: 'IMAGE', options: [{ label: 'Image', value: 'IMAGE' }, { label: 'Video', value: 'VIDEO' }, { label: 'Audio', value: 'AUDIO' }, { label: 'Document', value: 'DOCUMENT' }], index: true },
    { name: 'uploadStatus', type: 'select', required: true, defaultValue: 'READY', options: [{ label: 'Uploading', value: 'UPLOADING' }, { label: 'Processing', value: 'PROCESSING' }, { label: 'Ready', value: 'READY' }, { label: 'Failed', value: 'FAILED' }, { label: 'Deleted', value: 'DELETED' }], index: true },
    { name: 'sha256', type: 'text', index: true },
    { name: 'sizeBytes', type: 'number', min: 0 },
    { name: 'width', type: 'number', min: 1 },
    { name: 'height', type: 'number', min: 1 },
    { name: 'durationMs', type: 'number', min: 0 },
    { name: 'mimeType', type: 'text', maxLength: 100, index: true },
    { name: 'orientation', type: 'select', options: [{ label: 'Landscape', value: 'LANDSCAPE' }, { label: 'Portrait', value: 'PORTRAIT' }, { label: 'Square', value: 'SQUARE' }] },
    { name: 'posterR2Key', type: 'text' },
    { name: 'deletedAt', type: 'date' },
  ],
  upload: {
    crop: false,
    focalPoint: false,
  },
  timestamps: true,
}
