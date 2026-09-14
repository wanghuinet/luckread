import type { CollectionConfig } from 'payload'

export const VideoProcessingJobs: CollectionConfig = {
  slug: 'video-processing-jobs',
  admin: { useAsTitle: 'jobId', defaultColumns: ['jobId', 'videoAsset', 'stage', 'status', 'attempts', 'updatedAt'] },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'jobId', type: 'text', required: true, unique: true, index: true },
    { name: 'videoAsset', type: 'relationship', relationTo: 'video-assets', required: true, index: true },
    { name: 'stage', type: 'select', required: true, options: [{ label: 'Validate', value: 'VALIDATE' }, { label: 'Probe', value: 'PROBE' }, { label: 'Transcode', value: 'TRANSCODE' }, { label: 'Poster', value: 'POSTER' }, { label: 'Publish', value: 'PUBLISH' }] },
    { name: 'status', type: 'select', required: true, defaultValue: 'QUEUED', options: [{ label: 'Queued', value: 'QUEUED' }, { label: 'Running', value: 'RUNNING' }, { label: 'Succeeded', value: 'SUCCEEDED' }, { label: 'Failed', value: 'FAILED' }, { label: 'Cancelled', value: 'CANCELLED' }] },
    { name: 'attempts', type: 'number', required: true, defaultValue: 0, min: 0 },
    { name: 'maxAttempts', type: 'number', required: true, defaultValue: 3, min: 1, max: 10 },
    { name: 'lastErrorCode', type: 'text', maxLength: 100 },
    { name: 'lastErrorMessage', type: 'textarea', maxLength: 1000 },
    { name: 'startedAt', type: 'date' },
    { name: 'finishedAt', type: 'date' },
    { name: 'nextAttemptAt', type: 'date', index: true },
  ],
  timestamps: true,
}
