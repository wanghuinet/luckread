import { APIError } from 'payload'
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

export async function markVideoValidationSucceeded(req: Parameters<typeof validateUploadedVideo>[0] extends never ? never : any, videoAssetId: string | number, result: VideoValidationResult) {
  await req.payload.update({
    collection: 'video-assets',
    id: videoAssetId,
    data: { state: 'VALIDATING', failureCode: null, failureMessage: null, sizeBytes: result.sizeBytes },
    overrideAccess: true,
    req,
  })
}
