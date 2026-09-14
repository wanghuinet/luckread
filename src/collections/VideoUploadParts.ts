import { APIError } from 'payload'
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
  endpoints: [{
    path: '/:id/part/:partNumber',
    method: 'put',
    handler: async (req) => {
      if (!req.user) throw new APIError('Authentication required', 401)
      const sessionId = String(req.routeParams?.id || '')
      const partNumber = Number(req.routeParams?.partNumber)
      if (!Number.isInteger(partNumber) || partNumber < 1) throw new APIError('Invalid part number', 400)
      const session = await req.payload.findByID({ collection: 'video-upload-sessions', id: sessionId, depth: 0, overrideAccess: true, req })
      if (String(session.owner) !== String(req.user.id)) throw new APIError('Forbidden', 403)
      if (session.state !== 'OPEN') throw new APIError(`Upload session is ${session.state}`, 409)
      if (new Date(session.expiresAt).getTime() <= Date.now()) throw new APIError('Upload session expired', 410)
      if (partNumber > Number(session.totalChunks)) throw new APIError('Part number exceeds totalChunks', 400)
      const body = await req.arrayBuffer()
      if (body.byteLength < 1) throw new APIError('Empty upload part', 400)
      const expected = partNumber === Number(session.totalChunks) ? Number(session.expectedSizeBytes) - Number(session.chunkSizeBytes) * (Number(session.totalChunks) - 1) : Number(session.chunkSizeBytes)
      if (body.byteLength !== expected) throw new APIError('Invalid part size', 400)
      const digest = await crypto.subtle.digest('SHA-256', body)
      const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
      const requestedSha256 = req.headers.get('x-part-sha256')?.toLowerCase()
      if (requestedSha256 && requestedSha256 !== sha256) throw new APIError('Part SHA-256 mismatch', 422)
      const partKey = `${session.uploadId}:${partNumber}`
      const existing = await req.payload.find({ collection: 'video-upload-parts', where: { partKey: { equals: partKey } }, limit: 1, depth: 0, overrideAccess: true, req })
      if (existing.docs.length && existing.docs[0].sha256 === sha256 && existing.docs[0].state === 'VERIFIED') return Response.json({ data: { partNumber, state: 'VERIFIED', sha256, etag: existing.docs[0].etag, idempotent: true } })
      const { getCloudflareContext } = await import('@opennextjs/cloudflare')
      const cloudflare = await getCloudflareContext({ async: true })
      if (!session.multipartUploadId) throw new APIError('Multipart upload is not initialized', 409)
      const multipart = cloudflare.env.R2.resumeMultipartUpload(session.objectKey, session.multipartUploadId)
      const uploaded = await multipart.uploadPart(partNumber, body)
      const data = { partKey, uploadSession: session.id, partNumber, sizeBytes: body.byteLength, sha256, r2Key: `${session.objectKey}#part-${partNumber}`, etag: uploaded.etag, state: 'VERIFIED' as const, receivedAt: new Date().toISOString(), verifiedAt: new Date().toISOString() }
      if (existing.docs.length) {
        await req.payload.update({ collection: 'video-upload-parts', id: existing.docs[0].id, data, overrideAccess: true, req })
      } else {
        await req.payload.create({ collection: 'video-upload-parts', data, overrideAccess: true, req })
      }
      const verified = await req.payload.find({ collection: 'video-upload-parts', where: { uploadSession: { equals: session.id }, state: { equals: 'VERIFIED' } }, limit: 10000, depth: 0, overrideAccess: true, req })
      await req.payload.update({ collection: 'video-upload-sessions', id: session.id, data: { receivedChunks: verified.totalDocs }, overrideAccess: true, req })
      return Response.json({ data: { partNumber, state: 'VERIFIED', sha256, etag: uploaded.etag, idempotent: false } })
    },
  }],
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
