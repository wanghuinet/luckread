import { getPayload } from 'payload'

import config from '@payload-config'

import {
  resolveOptionalCookieContentPrincipal,
  callW03Content,
  W03ContentClientError,
  type ContentPrincipal,
} from '@/content/w03-content-client'
import {
  TrafficLimitError,
  enforcePublicReadRateLimit,
  rateLimitResponse,
} from '../../../../../auth/traffic-limit'
import { apiErrorResponse, appendRequestIdToJsonResponse } from '../../../../../lib/api-response'
import { isCanonicalMediaDeliveryUrl, mediaHostKind } from '../../../../../media/media-delivery'

type MediaAccess = {
  isPublic: boolean
  isMemberContent: boolean
  allowed: boolean
}

function readAccess(value: unknown): MediaAccess | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const envelope = value as Record<string, unknown>
  const data = envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)
    ? envelope.data as Record<string, unknown>
    : null
  if (
    typeof data?.isPublic !== 'boolean' ||
    typeof data?.isMemberContent !== 'boolean' ||
    typeof data?.allowed !== 'boolean'
  ) return null
  return {
    isPublic: data.isPublic,
    isMemberContent: data.isMemberContent,
    allowed: data.allowed,
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const requestedUrls = url.searchParams.getAll('url')
  const mediaUrls = [...new Set(requestedUrls)]
  if (
    requestedUrls.length < 1 ||
    requestedUrls.length > 4 ||
    [...url.searchParams.keys()].some((key) => key !== 'url') ||
    mediaUrls.some((mediaUrl) =>
      !isCanonicalMediaDeliveryUrl(mediaUrl) ||
      mediaHostKind(new URL(mediaUrl).hostname) !== 'image'
    )
  ) {
    return apiErrorResponse(422, 'VALIDATION_FAILED', 'Provide one to four canonical LuckRead media URLs')
  }

  let principal: ContentPrincipal | null = null
  try {
    if (!request.headers.has('Authorization') && !request.headers.has('cookie')) {
      await enforcePublicReadRateLimit(request)
    }
    const resolved = await resolveOptionalCookieContentPrincipal(request)
    // Match the byte-delivery path: invalid/unavailable optional identity is
    // treated as anonymous. W03 will still deny every member-only reference.
    if (!(resolved instanceof Response)) principal = resolved
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Media metadata service unavailable')
  }

  try {
    // W03 remains the authority for published references and membership.
    // Metadata for an unreferenced/private media object is never projected.
    const accessResults = await Promise.all(mediaUrls.map(async (mediaUrl) => {
      const response = await callW03Content({
        request,
        pathname: '/internal/content/public-media-reference?url=' + encodeURIComponent(mediaUrl),
        method: 'GET',
        principal,
      })
      if (!response.ok) throw new W03ContentClientError(503, 'SERVICE_UNAVAILABLE', 'Content authorization unavailable')
      const access = readAccess(await response.json().catch((): null => null))
      if (!access) throw new W03ContentClientError(503, 'SERVICE_UNAVAILABLE', 'Content authorization response invalid')
      return {
        url: mediaUrl,
        allowed: access.allowed && (access.isPublic || access.isMemberContent),
      }
    }))
    const allowedUrls = accessResults.filter((item) => item.allowed).map((item) => item.url)
    if (allowedUrls.length === 0) {
      return await appendRequestIdToJsonResponse(new Response(JSON.stringify({
        data: { items: [] },
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'private, no-store',
        },
      }))
    }

    const payload = await getPayload({ config })
    const result = await payload.find({
      collection: 'media',
      where: { or: allowedUrls.map((mediaUrl) => ({ url: { equals: mediaUrl } })) } as any,
      limit: allowedUrls.length,
      page: 1,
      depth: 0,
      overrideAccess: true,
      select: { url: true, alt: true, mimeType: true } as any,
    })
    const allowedSet = new Set(allowedUrls)
    const items = result.docs
      .filter((doc) =>
        typeof doc.url === 'string' &&
        allowedSet.has(doc.url) &&
        typeof doc.mimeType === 'string' &&
        doc.mimeType.startsWith('image/')
      )
      .map((doc) => ({
        url: doc.url,
        alt: typeof doc.alt === 'string' ? doc.alt : '',
        mimeType: doc.mimeType,
      }))
    return await appendRequestIdToJsonResponse(new Response(JSON.stringify({
      data: { items },
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, no-store',
      },
    }))
  } catch (error) {
    if (error instanceof W03ContentClientError) {
      return apiErrorResponse(error.status, error.code, 'Media metadata authorization unavailable')
    }
    return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Media metadata service unavailable')
  }
}
