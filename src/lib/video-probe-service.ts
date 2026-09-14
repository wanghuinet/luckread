import { APIError, type PayloadRequest } from 'payload'
import { getCloudflareContext } from '@opennextjs/cloudflare'

export type VideoProbeResult = {
  durationMs: number
  width: number
  height: number
  orientation: 'LANDSCAPE' | 'PORTRAIT' | 'SQUARE'
  frameRate?: number
  videoCodec?: string
  audioCodec?: string
  bitrate?: number
}

async function getR2Bucket(): Promise<R2Bucket> {
  const cloudflare = await getCloudflareContext({ async: true })
  const bucket = cloudflare.env.R2 as R2Bucket | undefined
  if (!bucket) throw new APIError('R2 binding is unavailable', 503)
  return bucket
}

function orientation(width: number, height: number): VideoProbeResult['orientation'] {
  if (width === height) return 'SQUARE'
  return width > height ? 'LANDSCAPE' : 'PORTRAIT'
}

/**
 * Probe metadata is intentionally adapter-based. Cloudflare R2 is storage, not a
 * media decoder; production deployments must provide a media-probe worker/service.
 * This function accepts normalized probe JSON from that adapter and never invents
 * codec/duration metadata when the adapter is unavailable.
 */
export async function applyVideoProbeResult(req: PayloadRequest, videoAssetId: string | number, result: VideoProbeResult) {
  if (!Number.isFinite(result.durationMs) || result.durationMs < 0) throw new APIError('Invalid durationMs', 422)
  if (!Number.isInteger(result.width) || result.width < 1 || !Number.isInteger(result.height) || result.height < 1) throw new APIError('Invalid video dimensions', 422)
  await req.payload.update({
    collection: 'video-assets',
    id: videoAssetId,
    data: {
      state: 'PROCESSING',
      durationMs: result.durationMs,
      width: result.width,
      height: result.height,
      orientation: result.orientation ?? orientation(result.width, result.height),
      ...(result.frameRate !== undefined ? { frameRate: result.frameRate } : {}),
      ...(result.videoCodec ? { videoCodec: result.videoCodec } : {}),
      ...(result.audioCodec ? { audioCodec: result.audioCodec } : {}),
      ...(result.bitrate !== undefined ? { bitrate: result.bitrate } : {}),
      failureCode: null,
      failureMessage: null,
    },
    overrideAccess: true,
    req,
  })
}

export async function readProbeManifest(sourceR2Key: string) {
  const bucket = await getR2Bucket()
  const key = `${sourceR2Key}.probe.json`
  const object = await bucket.get(key)
  if (!object) throw new APIError('Probe manifest is not available', 503)
  try {
    return JSON.parse(await object.text()) as VideoProbeResult
  } catch {
    throw new APIError('Probe manifest is invalid JSON', 422)
  }
}
