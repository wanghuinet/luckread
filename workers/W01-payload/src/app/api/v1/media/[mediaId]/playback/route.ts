import { getPayload } from 'payload'
import config from '@payload-config'

import {
  callW03Content,
  resolveOptionalCookieContentPrincipal,
  W03ContentClientError,
  type ContentPrincipal,
} from '@/content/w03-content-client'
import { TrafficLimitError, enforcePublicReadRateLimit, rateLimitResponse } from '@/auth/traffic-limit'
import { apiErrorResponse, appendRequestIdToJsonResponse } from '@/lib/api-response'
import { resolvePayloadOwnerUserId } from '@/media/media-owner'
import { isCanonicalMediaDeliveryUrl } from '@/media/media-delivery'

type MediaPayload = {
  id?: string | number
  url?: string | null
  mimeType?: string | null
  filename?: string | null
  filesize?: number | null
  ownerUserId?: string | number | null
}
type Access = { isPublic: boolean; isMemberContent: boolean; allowed: boolean }

const unavailable = (status: number, code: string) =>
  apiErrorResponse(status, code, 'Media playback unavailable')

function readAccess(value: unknown): Access | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const envelope = value as Record<string, unknown>
  const data = envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)
    ? envelope.data as Record<string, unknown>
    : null
  if (typeof data?.isPublic !== 'boolean' ||
      typeof data?.isMemberContent !== 'boolean' ||
      typeof data?.allowed !== 'boolean') return null
  return { isPublic: data.isPublic, isMemberContent: data.isMemberContent, allowed: data.allowed }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ mediaId: string }> },
): Promise<Response> {
  try {
    await enforcePublicReadRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return unavailable(503, 'SERVICE_UNAVAILABLE')
  }

  const { mediaId } = await context.params
  if (!mediaId?.trim() || mediaId.length > 256) return unavailable(404, 'NOT_FOUND')

  let principal: ContentPrincipal | null = null
  try {
    const resolved = await resolveOptionalCookieContentPrincipal(request)
    if (resolved instanceof Response) {
      if (resolved.status !== 401) return unavailable(resolved.status, resolved.status === 503 ? 'SERVICE_UNAVAILABLE' : 'NOT_FOUND')
    } else {
      principal = resolved
    }
  } catch {
    return unavailable(503, 'SERVICE_UNAVAILABLE')
  }

  try {
    const payload = await getPayload({ config })
    const media = await payload.findByID({
      collection: 'media',
      id: mediaId,
      depth: 0,
      overrideAccess: true,
    }).catch((): null => null) as unknown as MediaPayload | null
    if (!media || String(media.id ?? '') !== mediaId ||
        typeof media.url !== 'string' || !isCanonicalMediaDeliveryUrl(media.url) ||
        typeof media.mimeType !== 'string' || !media.mimeType.trim()) {
      return unavailable(404, 'NOT_FOUND')
    }

    // Published references and membership are decided by W03, never by the
    // client or by the media owner collection. The byte-delivery route repeats
    // this check, so the playback URL itself cannot bypass visibility changes.
    const visibilityResponse = await callW03Content({
      request,
      pathname: '/internal/content/public-media-reference?url=' + encodeURIComponent(media.url),
      method: 'GET',
      principal,
    })
    if (!visibilityResponse.ok) return unavailable(503, 'SERVICE_UNAVAILABLE')
    const access = readAccess(await visibilityResponse.json().catch((): null => null))
    if (!access) return unavailable(503, 'SERVICE_UNAVAILABLE')

    let allowed = access.allowed && (access.isPublic || access.isMemberContent)
    // Owner fallback applies only to unreferenced standalone media. It must not
    // override a protected published reference denied by W03. Payload's owner
    // profile mapping is server-derived.
    if (!allowed && !access.isMemberContent && !access.isPublic && principal) {
      const payloadOwnerId = await resolvePayloadOwnerUserId(payload, principal.userId)
      allowed = Boolean(payloadOwnerId && String(media.ownerUserId ?? '') === payloadOwnerId)
    }
    if (!allowed) return unavailable(404, 'NOT_FOUND')

    return await appendRequestIdToJsonResponse(new Response(JSON.stringify({
      id: String(media.id),
      url: media.url,
      mimeType: media.mimeType,
      filename: typeof media.filename === 'string' ? media.filename : null,
      filesize: typeof media.filesize === 'number' ? media.filesize : null,
      status: 'READY',
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, no-store',
      },
    }))
  } catch (error) {
    if (error instanceof W03ContentClientError) return unavailable(error.status, error.code)
    return unavailable(503, 'SERVICE_UNAVAILABLE')
  }
}
