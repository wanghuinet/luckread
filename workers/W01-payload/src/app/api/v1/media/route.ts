import { getPayload } from 'payload'

import config from '@payload-config'
import { POST as payloadMediaPost } from '../../../(payload)/api/[...slug]/route'

import { getBetterAuthPrincipal, W02AuthClientError } from '@/auth/w02-session-client'
import { TrafficLimitError, enforcePublicReadRateLimit, enforceW01WriteRateLimit, rateLimitResponse } from '@/auth/traffic-limit'
import { apiErrorResponse, appendRequestIdToJsonResponse, normalizeApiErrorResponse } from '@/lib/api-response'

type PayloadRouteContext = Parameters<typeof payloadMediaPost>[1]

const unauthorized = () => apiErrorResponse(401, 'UNAUTHENTICATED', 'Authentication required')

async function authenticate(request: Request) {
  const principal = await getBetterAuthPrincipal(request)
  const payload = await getPayload({ config })
  return { payload, userId: principal.userId }
}

const authenticateErrorResponse = (error: unknown): Response => {
  if (error instanceof W02AuthClientError && error.status === 401) return unauthorized()
  return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Media authentication service unavailable')
}
export async function GET(request: Request): Promise<Response> {
  try {
    await enforcePublicReadRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Media service unavailable')
  }

  let authenticated: Awaited<ReturnType<typeof authenticate>>
  try {
    authenticated = await authenticate(request)
  } catch (error) {
    return authenticateErrorResponse(error)
  }

  const url = new URL(request.url)
  const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '24', 10)
  const requestedPage = Number.parseInt(url.searchParams.get('page') ?? '1', 10)
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 24
  const page = Number.isFinite(requestedPage) ? Math.max(requestedPage, 1) : 1

  try {
    const result = await authenticated.payload.find({
      collection: 'media',
      where: { ownerUserId: { equals: authenticated.userId } },
      sort: '-createdAt',
      limit,
      page,
      depth: 0,
      overrideAccess: true,
    })

    return await appendRequestIdToJsonResponse(new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    }))
  } catch {
    return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Media service unavailable')
  }
}

type MediaUploadRecord = {
  id?: string | number
  url?: string | null
  filename?: string | null
  mimeType?: string | null
  filesize?: number | null
  width?: number | null
  height?: number | null
  alt?: string | null
  ownerUserId?: string | number | null
  uploadIdempotencyKey?: string | null
  uploadFingerprint?: string | null
}

const uploadConflict = () =>
  apiErrorResponse(409, 'IDEMPOTENCY_KEY_REUSE_CONFLICT', 'Idempotency-Key cannot be reused with a different upload')

const replayUploadedMedia = async (media: MediaUploadRecord): Promise<Response> =>
  appendRequestIdToJsonResponse(Response.json({
    doc: {
      id: media.id ?? null,
      url: media.url ?? null,
      filename: media.filename ?? null,
      mimeType: media.mimeType ?? null,
      filesize: media.filesize ?? null,
      width: media.width ?? null,
      height: media.height ?? null,
      alt: media.alt ?? null,
    },
    message: 'Media upload already completed',
  }, {
    status: 201,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  }))

async function findUploadByIdempotencyKey(
  payload: Awaited<ReturnType<typeof getPayload>>,
  key: string,
): Promise<MediaUploadRecord | null> {
  const result = await payload.find({
    collection: 'media',
    where: { uploadIdempotencyKey: { equals: key } } as any,
    limit: 1,
    page: 1,
    depth: 0,
    overrideAccess: true,
  })
  return (result.docs[0] as unknown as MediaUploadRecord | undefined) ?? null
}

async function resolvePreviousUpload(
  request: Request,
  payload: Awaited<ReturnType<typeof getPayload>>,
  payloadUserId: string,
  idempotencyKey: string,
  uploadFingerprint: string | null,
): Promise<Response | null> {
  const existing = await findUploadByIdempotencyKey(payload, idempotencyKey)
  if (!existing) return null

  // Do not disclose an existing asset to a different account. Reuse requires
  // both the canonical Payload profile owner and the same upload fingerprint.
  if (
    String(existing.ownerUserId ?? '') !== payloadUserId ||
    (existing.uploadFingerprint ?? null) !== uploadFingerprint
  ) {
    return uploadConflict()
  }

  return replayUploadedMedia(existing)
}

/**
 * Stable v1 upload entry for clients.
 *
 * The canonical media implementation remains Payload Media + R2. This route
 * only normalizes the public URL to Payload's existing /api/media upload
 * handler; it does not introduce a second media authority or storage path.
 */
export async function POST(request: Request): Promise<Response> {
  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!idempotencyKey) return apiErrorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
  if (idempotencyKey.length > 256) return apiErrorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')

  const fingerprintHeader = request.headers.get('X-LuckRead-Upload-Fingerprint')?.trim() ?? ''
  if (fingerprintHeader && !/^lr-up1-[a-f0-9]{16}$/.test(fingerprintHeader)) {
    return apiErrorResponse(422, 'VALIDATION_FAILED', 'Invalid upload fingerprint')
  }
  const uploadFingerprint = fingerprintHeader || null

  try {
    await enforceW01WriteRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Media service unavailable')
  }

  let authenticated: Awaited<ReturnType<typeof authenticate>>
  try {
    authenticated = await authenticate(request)
  } catch (error) {
    return authenticateErrorResponse(error)
  }

  try {
    const profileResult = await authenticated.payload.find({
      collection: 'users',
      where: { identityId: { equals: authenticated.userId } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      select: { id: true } as any,
    })
    const payloadUserId = profileResult.docs[0]?.id
    if (payloadUserId === undefined || payloadUserId === null) {
      return apiErrorResponse(401, 'UNAUTHENTICATED', 'Account profile is not available')
    }

    const previous = await resolvePreviousUpload(
      request,
      authenticated.payload,
      String(payloadUserId),
      idempotencyKey,
      uploadFingerprint,
    )
    if (previous) return previous

    const target = new URL('/api/media', request.url)
    const context: PayloadRouteContext = {
      params: Promise.resolve({ slug: ['media'] }),
    }
    const response = await payloadMediaPost(new Request(target, request.clone()), context)
    if (response.ok) return appendRequestIdToJsonResponse(response)

    // A concurrent retry can pass the initial lookup before the winner commits.
    // Recheck after the Payload write so the losing request can replay the
    // canonical media record instead of surfacing a duplicate-key server error.
    const afterWrite = await resolvePreviousUpload(
      request,
      authenticated.payload,
      String(payloadUserId),
      idempotencyKey,
      uploadFingerprint,
    )
    if (afterWrite) return afterWrite

    return normalizeApiErrorResponse(response, 'Media service unavailable')
  } catch {
    return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Media service unavailable')
  }
}