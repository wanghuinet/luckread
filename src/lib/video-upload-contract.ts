import { APIError } from 'payload'

export const VIDEO_UPLOAD_MAX_SIZE_BYTES = 10 * 1024 * 1024 * 1024
export const VIDEO_UPLOAD_MIN_CHUNK_BYTES = 5 * 1024 * 1024
export const VIDEO_UPLOAD_MAX_CHUNK_BYTES = 100 * 1024 * 1024
export const VIDEO_UPLOAD_DEFAULT_CHUNK_BYTES = 16 * 1024 * 1024
export const VIDEO_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000

export type VideoUploadInitInput = {
  content: string | number
  originalFilename: string
  mimeType: string
  sizeBytes: number
  sha256: string
  chunkSizeBytes?: number
}

export function validateVideoUploadInput(input: VideoUploadInitInput) {
  if (!input.originalFilename || input.originalFilename.length > 255) throw new APIError('Invalid originalFilename', 400)
  if (!/^video\/[a-z0-9.+-]+$/i.test(input.mimeType)) throw new APIError('Only video MIME types are accepted', 415)
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > VIDEO_UPLOAD_MAX_SIZE_BYTES) {
    throw new APIError('Invalid video size', 400)
  }
  if (!/^[a-f0-9]{64}$/i.test(input.sha256)) throw new APIError('sha256 must be a 64-character hexadecimal digest', 400)
  const chunkSize = input.chunkSizeBytes ?? VIDEO_UPLOAD_DEFAULT_CHUNK_BYTES
  if (!Number.isSafeInteger(chunkSize) || chunkSize < VIDEO_UPLOAD_MIN_CHUNK_BYTES || chunkSize > VIDEO_UPLOAD_MAX_CHUNK_BYTES) {
    throw new APIError('Invalid chunkSizeBytes', 400)
  }
  const totalChunks = Math.ceil(input.sizeBytes / chunkSize)
  if (totalChunks < 1 || totalChunks > 10000) throw new APIError('Too many upload chunks', 400)
  return { ...input, sha256: input.sha256.toLowerCase(), chunkSizeBytes: chunkSize, totalChunks }
}

export function assertUploadSessionOpen(state: string, expiresAt: string | Date) {
  if (state !== 'OPEN') throw new APIError(`Upload session is ${state}`, 409)
  if (new Date(expiresAt).getTime() <= Date.now()) throw new APIError('Upload session expired', 410)
}

export function buildVideoObjectKey(ownerId: string | number, uploadId: string, filename: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-180)
  return `videos/${String(ownerId)}/${uploadId}/source/${safe}`
}
