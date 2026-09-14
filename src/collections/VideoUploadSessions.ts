import { randomUUID } from 'node:crypto'
import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'
import { validateVideoUploadInput, buildVideoObjectKey, VIDEO_UPLOAD_TTL_MS, assertUploadSessionOpen } from '../lib/video-upload-contract'

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
  endpoints: [
    {
      path: '/init',
      method: 'post',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const body = await req.json() as Record<string, unknown>
        if (!body.content || !body.originalFilename || !body.mimeType || !body.sizeBytes || !body.sha256) throw new APIError('content, originalFilename, mimeType, sizeBytes and sha256 are required', 400)
        const input = validateVideoUploadInput(body as Parameters<typeof validateVideoUploadInput>[0])
        const existing = await req.payload.find({ collection: 'video-assets', where: { sha256: { equals: input.sha256 }, sizeBytes: { equals: input.sizeBytes } }, limit: 1, depth: 0, overrideAccess: true, req })
        if (existing.docs.length) return Response.json({ data: { mode: 'DEDUPLICATED', videoAsset: existing.docs[0].id } })
        const uploadId = randomUUID()
        const objectKey = buildVideoObjectKey(String(req.user.id), uploadId, input.originalFilename)
        const expiresAt = new Date(Date.now() + VIDEO_UPLOAD_TTL_MS).toISOString()
        const asset = await req.payload.create({ collection: 'video-assets', data: { content: input.content, originalFilename: input.originalFilename, mimeType: input.mimeType, sizeBytes: input.sizeBytes, sha256: input.sha256, uploadId, state: 'UPLOADING', chunkSizeBytes: input.chunkSizeBytes, totalChunks: input.totalChunks, uploadedChunks: 0, uploadExpiresAt: expiresAt, retryCount: 0, sourceR2Key: objectKey }, overrideAccess: true, req })
        const session = await req.payload.create({ collection: 'video-upload-sessions', data: { uploadId, videoAsset: asset.id, owner: String(req.user.id), state: 'OPEN', objectKey, expectedSha256: input.sha256, expectedSizeBytes: input.sizeBytes, chunkSizeBytes: input.chunkSizeBytes, totalChunks: input.totalChunks, receivedChunks: 0, expiresAt, version: 1 }, overrideAccess: true, req })
        return Response.json({ data: { mode: 'UPLOAD', uploadId, videoAsset: asset.id, sessionId: session.id, objectKey, chunkSizeBytes: input.chunkSizeBytes, totalChunks: input.totalChunks, expiresAt } }, { status: 201 })
      },
      custom: { openapi: { summary: 'Initialize an idempotent resumable video upload session' } },
    },
    {
      path: '/:id/status',
      method: 'get',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const session = await req.payload.findByID({ collection: 'video-upload-sessions', id: req.routeParams?.id as string, depth: 0, overrideAccess: true, req })
        if (String(session.owner) !== String(req.user.id)) throw new APIError('Forbidden', 403)
        const parts = await req.payload.find({ collection: 'video-upload-parts', where: { uploadSession: { equals: session.id } }, sort: 'partNumber', limit: 10000, depth: 0, overrideAccess: true, req })
        return Response.json({ data: { uploadId: session.uploadId, state: session.state, expiresAt: session.expiresAt, receivedChunks: session.receivedChunks, totalChunks: session.totalChunks, parts: parts.docs.map((part) => ({ partNumber: part.partNumber, sizeBytes: part.sizeBytes, sha256: part.sha256, state: part.state, etag: part.etag })) } })
      },
      custom: { openapi: { summary: 'Return resumable upload progress and verified parts' } },
    },
  ],
  fields: [
    { name: 'uploadId', type: 'text', required: true, unique: true, index: true },
    { name: 'videoAsset', type: 'relationship', relationTo: 'video-assets', required: true, unique: true, index: true },
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'state', type: 'select', required: true, defaultValue: 'OPEN', options: states.map((value) => ({ label: value, value })), index: true },
    { name: 'objectKey', type: 'text', required: true, unique: true, index: true },
    { name: 'multipartUploadId', type: 'text', index: true },
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
