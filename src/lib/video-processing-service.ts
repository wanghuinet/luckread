import { APIError, type PayloadRequest } from 'payload'
import { getCloudflareContext } from '@opennextjs/cloudflare'

export type VideoValidationResult = {
  sizeBytes: number
  contentType: string
}

async function getR2Bucket(): Promise<R2Bucket> {
  const cloudflare = await getCloudflareContext({ async: true })
  const bucket = cloudflare.env.R2 as R2Bucket | undefined
  if (!bucket) throw new APIError('R2 binding is unavailable', 503)
  return bucket
}

export async function validateUploadedVideo(sourceR2Key: string, expectedSizeBytes: number, expectedMimeType: string): Promise<VideoValidationResult> {
  if (!sourceR2Key) throw new APIError('Video source object is unavailable', 422)
  const object = await (await getR2Bucket()).head(sourceR2Key)
  if (!object) throw new APIError('Uploaded video object was not found', 404)
  if (object.size !== expectedSizeBytes) throw new APIError('Uploaded video size does not match the declared size', 422)
  if (object.httpMetadata?.contentType && object.httpMetadata.contentType !== expectedMimeType) {
    throw new APIError('Uploaded video MIME type does not match the declared MIME type', 422)
  }
  return { sizeBytes: object.size, contentType: object.httpMetadata?.contentType ?? expectedMimeType }
}

export async function markVideoValidationSucceeded(req: PayloadRequest, videoAssetId: string | number, result: VideoValidationResult) {
  await req.payload.update({
    collection: 'video-assets',
    id: videoAssetId,
    data: { state: 'QUEUED', failureCode: null, failureMessage: null, sizeBytes: result.sizeBytes },
    overrideAccess: true,
    req,
  })
}

export async function runVideoValidationJob(req: PayloadRequest, jobId: string | number) {
  const job = await req.payload.findByID({ collection: 'video-processing-jobs', id: jobId, depth: 1, overrideAccess: true, req })
  if (job.stage !== 'VALIDATE') throw new APIError('Only VALIDATE jobs can be run by this runner', 409)
  if (job.status !== 'QUEUED') throw new APIError(`Job is already ${job.status}`, 409)

  const running = await req.payload.update({
    collection: 'video-processing-jobs', id: job.id,
    data: { status: 'RUNNING', attempts: Number(job.attempts ?? 0) + 1, startedAt: new Date().toISOString(), lastErrorCode: null, lastErrorMessage: null },
    overrideAccess: true, req,
  })

  try {
    const asset = typeof job.videoAsset === 'object' ? job.videoAsset : await req.payload.findByID({ collection: 'video-assets', id: job.videoAsset, depth: 0, overrideAccess: true, req })
    const result = await validateUploadedVideo(String(asset.sourceR2Key), Number(asset.sizeBytes), String(asset.mimeType))
    await markVideoValidationSucceeded(req, asset.id, result)
    await req.payload.update({ collection: 'video-processing-jobs', id: running.id, data: { status: 'SUCCEEDED', finishedAt: new Date().toISOString() }, overrideAccess: true, req })
    const probe = await req.payload.find({ collection: 'video-processing-jobs', where: { videoAsset: { equals: asset.id }, stage: { equals: 'PROBE' }, status: { in: ['QUEUED', 'RUNNING'] } }, limit: 1, depth: 0, overrideAccess: true, req })
    if (!probe.docs.length) {
      await req.payload.create({ collection: 'video-processing-jobs', data: { jobId: crypto.randomUUID(), videoAsset: asset.id, stage: 'PROBE', status: 'QUEUED', attempts: 0, maxAttempts: 3 }, overrideAccess: true, req })
    }
    return { status: 'SUCCEEDED', nextStage: 'PROBE' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Video validation failed'
    await req.payload.update({ collection: 'video-processing-jobs', id: running.id, data: { status: 'FAILED', finishedAt: new Date().toISOString(), lastErrorCode: 'VALIDATION_FAILED', lastErrorMessage: message }, overrideAccess: true, req })
    await req.payload.update({ collection: 'video-assets', id: typeof job.videoAsset === 'object' ? job.videoAsset.id : job.videoAsset, data: { state: 'FAILED', failureCode: 'VALIDATION_FAILED', failureMessage: message, lastAttemptAt: new Date().toISOString() }, overrideAccess: true, req })
    throw error
  }
}
