import type { CollectionConfig } from 'payload'

export const VideoSubtitles: CollectionConfig = {
  slug: 'video-subtitles',
  admin: { useAsTitle: 'label', defaultColumns: ['label', 'videoAsset', 'locale', 'kind', 'status'] },
  access: {
    read: ({ req }) => Boolean(req.user) || true,
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'videoAsset', type: 'relationship', relationTo: 'video-assets', required: true, index: true },
    { name: 'label', type: 'text', required: true, maxLength: 100 },
    { name: 'locale', type: 'text', required: true, defaultValue: 'en-US', index: true },
    { name: 'kind', type: 'select', required: true, options: [{ label: 'Subtitles', value: 'SUBTITLES' }, { label: 'Captions', value: 'CAPTIONS' }, { label: 'Audio Description', value: 'AUDIO_DESCRIPTION' }] },
    { name: 'format', type: 'select', required: true, options: [{ label: 'WebVTT', value: 'WEBVTT' }, { label: 'TTML', value: 'TTML' }, { label: 'SRT', value: 'SRT' }] },
    { name: 'r2Key', type: 'text', required: true },
    { name: 'status', type: 'select', required: true, defaultValue: 'READY', options: [{ label: 'Pending', value: 'PENDING' }, { label: 'Ready', value: 'READY' }, { label: 'Failed', value: 'FAILED' }] },
    { name: 'isDefault', type: 'checkbox', defaultValue: false },
  ],
  timestamps: true,
}
