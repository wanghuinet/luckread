import { APIError, type PayloadRequest } from 'payload'
import { getCloudflareContext } from '@opennextjs/cloudflare'

export type VideoTranscodeVariant = {
  name: string
  format: 'MP4' | 'HLS'
  width: number
  height: number
  bitrate: number
  frameRate?: number
  videoCodec?: string
  audioCodec?: string
  r2Key: string
  manifestR2Key?: string
  sizeBytes?: number
}

async function getR2Bucket(): Promise<R2Bucket> {
  const cloudflare = await getCloudflareContext({ async: true })
  const bucket = cloudflare.env.R2 as R2Bucket | undefined
  if (!bucket) throw new APIError('R2 binding is unavailable', 503)
  return bucket
}

function validateVariant(value: unknown): VideoTranscodeVariant {
  if (!value || typeof value !== 'object') throw new APIError('Invalid transcode variant', 422)
  const item = value as Record<string, unknown>
  if (typeof item.name !== 'string' || !item.name.trim()) throw new APIError('Invalid variant name', 422)
  if (item.format !== 'MP4' && item.format !== 'HLS') throw new APIError('Invalid variant format', 422)
  for (const field of ['width', 'height', 'bitrate']) {
    if (!Number.isInteger(item[field]) || Number(item[field]) < 1) throw new APIError(`Invalid ${field}`, 422)
  }
  if (item.frameRate !== undefined && (!Number.isFinite(Number(item.frameRate)) || Number(item.frameRate) <= 0)) throw new APIError('Invalid frameRate', 422)
  if (item.sizeBytes !== undefined && (!Number.isInteger(item.sizeBytes) || Number(item.sizeBytes) < 0)) throw new APIError('Invalid sizeBytes', 422)
  if (typeof item.r2Key !== 'string' || !item.r2Key.trim()) throw new APIError('Invalid variant R2 key', 422)
  if (item.manifestR2Key !== undefined && typeof item.manifestR2Key !== 'string') throw new APIError('Invalid manifestR2Key', 422)
  return {
    name: item.name.trim(),
    format: item.format,
    width: Number(item.width),
    height: Number(item.height),
    bitrate: Number(item.bitrate),
    ...(item.frameRate !== undefined ? { frameRate: Number(item.frameRate) } : {}),
    ...(typeof item.videoCodec === 'string' ? { videoCodec: item.videoCodec } : {}),
    ...(typeof item.audioCodec === 'string' ? { audioCodec: item.audioCodec } : {}),
    r2Key: item.r2Key,
    ...(typeof item.manifestR2Key === 'string' ? { manifestR2Key: item.manifestR2Key } : {}),
    ...(item.sizeBytes !== undefined ? { sizeBytes: Number(item.sizeBytes) } : {}),
  }
}

export async function readTranscodeManifest(sourceR2Key: string): Promise<VideoTranscodeVariant[]> {
  const bucket = await getR2Bucket()
  const object = await bucket.get(`${sourceR2Key}.transcode.json`)
  if (!object) throw new APIError('Transcode manifest is not available', 503)
  let parsed: unknown
  try {
    parsed = JSON.parse(await object.text())
  } catch {
    throw new APIError('Transcode manifest is invalid JSON', 422)
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 20) throw new APIError('Transcode manifest must contain 1-20 variants', 422)
  return parsed.map(validateVariant)
}

export async function applyVideoTranscodeResult(
  req: PayloadRequest,
  videoAssetId: string | number,
  variants: VideoTranscodeVariant[],
) {
  const bucket = await getR2Bucket()
  const seen = new Set<string>()
  const formats = new Set<'MP4' | 'HLS'>()

  for (const variant of variants) {
    const variantKey = `${String(videoAssetId)}:${variant.format}:${variant.name}`
    if (seen.has(variantKey)) throw new APIError(`Duplicate variant ${variantKey}`, 422)
    seen.add(variantKey)
    const output = await bucket.head(variant.r2Key)
    if (!output) throw new APIError(`Transcode output is missing: ${variant.r2Key}`, 503)
    if (variant.sizeBytes !== undefined && output.size !== variant.sizeBytes) throw new APIError(`Transcode output size mismatch: ${variant.r2Key}`, 422)
    formats.add(variant.format)

    const existing = await req.payload.find({
      collection: 'video-variants',
      where: { variantKey: { equals: variantKey } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      req,
    })
    const data = {
      videoAsset: videoAssetId,
      variantKey,
      name: variant.name,
      format: variant.format,
      width: variant.width,
      height: variant.height,
      bitrate: variant.bitrate,
      ...(variant.frameRate !== undefined ? { frameRate: variant.frameRate } : {}),
      ...(variant.videoCodec ? { videoCodec: variant.videoCodec } : {}),
      ...(variant.audioCodec ? { audioCodec: variant.audioCodec } : {}),
      r2Key: variant.r2Key,
      ...(variant.manifestR2Key ? { manifestR2Key: variant.manifestR2Key } : {}),
      ...(variant.sizeBytes !== undefined ? { sizeBytes: variant.sizeBytes } : { sizeBytes: output.size }),
      status: 'READY' as const,
    }
    if (existing.docs[0]) {
      await req.payload.update({ collection: 'video-variants', id: existing.docs[0].id, data, overrideAccess: true, req })
    } else {
      await req.payload.create({ collection: 'video-variants', data, overrideAccess: true, req })
    }
  }

  const mp4 = variants.find((variant) => variant.format === 'MP4')
  const hls = variants.find((variant) => variant.format === 'HLS')
  await req.payload.update({
    collection: 'video-assets',
    id: videoAssetId,
    data: {
      state: 'PROCESSING',
      deliveryFormats: [...formats],
      ...(mp4 ? { mp4R2Key: mp4.r2Key } : {}),
      ...(hls ? { hlsMasterR2Key: hls.manifestR2Key ?? hls.r2Key } : {}),
      failureCode: null,
      failureMessage: null,
      lastAttemptAt: new Date().toISOString(),
    },
    overrideAccess: true,
    req,
  })
}
