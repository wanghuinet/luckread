import { randomUUID } from 'node:crypto'
import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'
import { validateVideoUploadInput, buildVideoObjectKey, VIDEO_UPLOAD_TTL_MS } from '../lib/video-upload-contract'

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
        const content = await req.payload.findByID({ collection: 'content', id: input.content, depth: 0, overrideAccess: true, req })
        const authorId = String((content as { author?: string | { id: string | number } }).author && typeof (content as { author?: unknown }).author === 'object' ? ((content as { author: { id: string | number } }).author).id : (content as { author?: string }).author || '')
        if (authorId !== String(req.user.id)) throw new APIError('Content ownership required', 403)
        const existing = await req.payload.find({ collection: 'video-assets', where: { sha256: { equals: input.sha256 }, sizeBytes: { equals: input.sizeBytes }, state: { equals: 'READY' } }, limit: 1, depth: 0, overrideAccess: true, req })
        if (existing.docs.length) return Response.json({ data: { mode: 'DEDUPLICATED', videoAsset: existing.docs[0].id } })
        const uploadId = randomUUID()
        const objectKey = buildVideoObjectKey(String(req.user.id), uploadId, input.originalFilename)
        const expiresAt = new Date(Date.now() + VIDEO_UPLOAD_TTL_MS).toISOString()
        const asset = await req.payload.create({ collection: 'video-assets', data: { content: input.content, originalFilename: input.originalFilename, mimeType: input.mimeType, sizeBytes: input.sizeBytes, sha256: input.sha256, uploadId, state: 'UPLOADING', chunkSizeBytes: input.chunkSizeBytes, totalChunks: input.totalChunks, uploadedChunks: 0, uploadExpiresAt: expiresAt, retryCount: 0 }, overrideAccess: true, req })
        const { getCloudflareContext } = await import('@opennextjs/cloudflare')
        const cloudflare = await getCloudflareContext({ async: true })
        const multipart = await cloudflare.env.R2.createMultipartUpload(objectKey, { httpMetadata: { contentType: input.mimeType } })
        const session = await req.payload.create({ collection: 'video-upload-sessions', data: { uploadId, videoAsset: asset.id, owner: String(req.user.id), state: 'OPEN', objectKey, multipartUploadId: multipart.uploadId, expectedSha256: input.sha256, expectedSizeBytes: input.sizeBytes, chunkSizeBytes: input.chunkSizeBytes, totalChunks: input.totalChunks, receivedChunks: 0, expiresAt, version: 1 }, overrideAccess: true, req })
        return Response.json({ data: { mode: 'UPLOAD', uploadId, videoAsset: asset.id, sessionId: session.id, chunkSizeBytes: input.chunkSizeBytes, totalChunks: input.totalChunks, expiresAt } }, { status: 201 })
      },
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
    },
    {
      path: '/:id/complete',
      method: 'post',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const id = String(req.routeParams?.id || '')
        const session = await req.payload.findByID({ collection: 'video-upload-sessions', id, depth: 0, overrideAccess: true, req })
        if (String(session.owner) !== String(req.user.id)) throw new APIError('Forbidden', 403)
        if (session.state === 'COMPLETED') return Response.json({ data: { state: 'COMPLETED', videoAsset: session.videoAsset } })
        if (session.state !== 'OPEN') throw new APIError(`Upload session is ${session.state}`, 409)
        if (new Date(session.expiresAt).getTime() <= Date.now()) throw new APIError('Upload session expired', 410)
        const parts = await req.payload.find({ collection: 'video-upload-parts', where: { uploadSession: { equals: session.id }, state: { equals: 'VERIFIED' } }, sort: 'partNumber', limit: 10000, depth: 0, overrideAccess: true, req })
        if (parts.totalDocs !== Number(session.totalChunks)) throw new APIError('Not all upload parts are verified', 409)
        const ordered = [...parts.docs].sort((a, b) => Number(a.partNumber) - Number(b.partNumber))
        for (let index = 0; index < ordered.length; index += 1) if (Number(ordered[index].partNumber) !== index + 1 || !ordered[index].etag) throw new APIError('Upload parts are incomplete or unordered', 409)
        const { getCloudflareContext } = await import('@opennextjs/cloudflare')
        const cloudflare = await getCloudflareContext({ async: true })
        if (!session.multipartUploadId) throw new APIError('Multipart upload is not initialized', 409)
        await req.payload.update({ collection: 'video-upload-sessions', id, data: { state: 'COMPLETING', version: Number(session.version) + 1 }, overrideAccess: true, req })
        try {
          const multipart = cloudflare.env.R2.resumeMultipartUpload(session.objectKey, session.multipartUploadId)
          await multipart.complete(ordered.map((part) => ({ partNumber: Number(part.partNumber), etag: String(part.etag) })))
          await req.payload.update({ collection: 'video-assets', id: session.videoAsset, data: { state: 'UPLOADED', sourceR2Key: session.objectKey, uploadedChunks: ordered.length }, overrideAccess: true, req })
          await req.payload.update({ collection: 'video-upload-sessions', id, data: { state: 'COMPLETED', receivedChunks: ordered.length, completedAt: new Date().toISOString(), version: Number(session.version) + 2 }, overrideAccess: true, req })
          const jobId = `video-${session.videoAsset}-probe-${Date.now()}`
          await req.payload.create({ collection: 'video-processing-jobs', data: { jobId, videoAsset: session.videoAsset, stage: 'VALIDATE', status: 'QUEUED', attempts: 0, maxAttempts: 3 }, overrideAccess: true, req })
          return Response.json({ data: { state: 'COMPLETED', videoAsset: session.videoAsset, processing: 'QUEUED' } })
        } catch (error) {
          await req.payload.update({ collection: 'video-upload-sessions', id, data: { state: 'FAILED', failureCode: 'MULTIPART_COMPLETE_FAILED', failureMessage: error instanceof Error ? error.message.slice(0, 1000) : 'Multipart completion failed' }, overrideAccess: true, req })
          throw error
        }
      },
    },
    {
      path: '/:id/cancel',
      method: 'post',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const id = String(req.routeParams?.id || '')
        const session = await req.payload.findByID({ collection: 'video-upload-sessions', id, depth: 0, overrideAccess: true, req })
        if (String(session.owner) !== String(req.user.id)) throw new APIError('Forbidden', 403)
        if (session.state === 'CANCELLED') return Response.json({ data: { state: 'CANCELLED' } })
        if (session.state !== 'OPEN') throw new APIError(`Upload session is ${session.state}`, 409)
        if (session.multipartUploadId) {
          const { getCloudflareContext } = await import('@opennextjs/cloudflare')
          const cloudflare = await getCloudflareContext({ async: true })
          await cloudflare.env.R2.resumeMultipartUpload(session.objectKey, session.multipartUploadId).abort()
        }
        await req.payload.update({ collection: 'video-upload-sessions', id, data: { state: 'CANCELLED', cancelledAt: new Date().toISOString(), version: Number(session.version) + 1 }, overrideAccess: true, req })
        await req.payload.update({ collection: 'video-assets', id: session.videoAsset, data: { state: 'CANCELLED' }, overrideAccess: true, req })
        return Response.json({ data: { state: 'CANCELLED' } })
      },
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
