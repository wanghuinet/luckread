import { randomUUID } from 'node:crypto'
import { APIError, type CollectionConfig } from 'payload'
import { applyVideoProbeResult, readProbeManifest } from '../lib/video-probe-service'

const stages = ['VALIDATE', 'PROBE', 'TRANSCODE', 'POSTER', 'PUBLISH'] as const
const statuses = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const

export const VideoProcessingJobs: CollectionConfig = {
  slug: 'video-processing-jobs',
  admin: { useAsTitle: 'jobId', defaultColumns: ['jobId', 'videoAsset', 'stage', 'status', 'attempts', 'updatedAt'] },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  endpoints: [{
    path: '/:id/run-probe',
    method: 'post',
    handler: async (req) => {
      if (!req.user) throw new APIError('Authentication required', 401)
      const id = String(req.routeParams?.id || '')
      if (!id) throw new APIError('Job id is required', 400)
      const job = await req.payload.findByID({ collection: 'video-processing-jobs', id, depth: 0, overrideAccess: true, req })
      if (job.stage !== 'PROBE') throw new APIError('Only PROBE jobs can be run by this endpoint', 409)
      if (job.status !== 'QUEUED') throw new APIError(`Job is already ${job.status}`, 409)
      await req.payload.update({ collection: 'video-processing-jobs', id, data: { status: 'RUNNING', attempts: Number(job.attempts ?? 0) + 1, startedAt: new Date().toISOString(), lastErrorCode: null, lastErrorMessage: null }, overrideAccess: true, req })
      try {
        const assetId = typeof job.videoAsset === 'object' && job.videoAsset !== null ? String(job.videoAsset.id) : String(job.videoAsset)
        const asset = await req.payload.findByID({ collection: 'video-assets', id: assetId, depth: 0, overrideAccess: true, req })
        const result = await readProbeManifest(String(asset.sourceR2Key))
        await applyVideoProbeResult(req, asset.id, result)
        await req.payload.update({ collection: 'video-processing-jobs', id, data: { status: 'SUCCEEDED', finishedAt: new Date().toISOString() }, overrideAccess: true, req })
        await req.payload.create({ collection: 'video-processing-jobs', data: { jobId: randomUUID(), videoAsset: asset.id, stage: 'TRANSCODE', status: 'QUEUED', attempts: 0, maxAttempts: 3 }, overrideAccess: true, req })
        return Response.json({ data: { status: 'SUCCEEDED', nextStage: 'TRANSCODE' } })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Video probe failed'
        const assetId = typeof job.videoAsset === 'object' && job.videoAsset !== null ? String(job.videoAsset.id) : String(job.videoAsset)
        await req.payload.update({ collection: 'video-processing-jobs', id, data: { status: 'FAILED', finishedAt: new Date().toISOString(), lastErrorCode: 'PROBE_FAILED', lastErrorMessage: message }, overrideAccess: true, req })
        await req.payload.update({ collection: 'video-assets', id: assetId, data: { state: 'FAILED', failureCode: 'PROBE_FAILED', failureMessage: message, lastAttemptAt: new Date().toISOString() }, overrideAccess: true, req })
        throw error
      }
    },
  }],
  fields: [
    { name: 'jobId', type: 'text', required: true, unique: true, index: true },
    { name: 'videoAsset', type: 'relationship', relationTo: 'video-assets', required: true, index: true },
    { name: 'stage', type: 'select', required: true, options: stages.map((value) => ({ label: value, value })), index: true },
    { name: 'status', type: 'select', required: true, defaultValue: 'QUEUED', options: statuses.map((value) => ({ label: value, value })), index: true },
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
