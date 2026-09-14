import type { CollectionConfig } from 'payload'

export const VideoVariants: CollectionConfig = {
  slug: 'video-variants',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'videoAsset', 'format', 'width', 'height', 'bitrate'] },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'videoAsset', type: 'relationship', relationTo: 'video-assets', required: true, index: true },
    { name: 'name', type: 'text', required: true, maxLength: 100 },
    { name: 'format', type: 'select', required: true, options: [{ label: 'MP4', value: 'MP4' }, { label: 'HLS', value: 'HLS' }], index: true },
    { name: 'width', type: 'number', required: true, min: 1 },
    { name: 'height', type: 'number', required: true, min: 1 },
    { name: 'bitrate', type: 'number', required: true, min: 1 },
    { name: 'frameRate', type: 'number', min: 0 },
    { name: 'videoCodec', type: 'text', maxLength: 50 },
    { name: 'audioCodec', type: 'text', maxLength: 50 },
    { name: 'r2Key', type: 'text', required: true },
    { name: 'manifestR2Key', type: 'text' },
    { name: 'sizeBytes', type: 'number', min: 0 },
    { name: 'status', type: 'select', required: true, defaultValue: 'READY', options: [{ label: 'Pending', value: 'PENDING' }, { label: 'Ready', value: 'READY' }, { label: 'Failed', value: 'FAILED' }] },
  ],
  timestamps: true,
}
