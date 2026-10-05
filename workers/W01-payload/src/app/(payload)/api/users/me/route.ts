import { enforceW01WriteRateLimit, enforcePublicReadRateLimit, TrafficLimitError, rateLimitResponse } from '@/auth/traffic-limit'
import { callW02UserProfile, W02UserProfileClientError } from '@/auth/w02-user-profile-client'
import { invalidatePublicUserProfile, invalidatePublicUserProfileByUsername } from '@/lib/public-response-cache'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const forward = async (response: Response): Promise<Response> => {
  const headers = new Headers()
  headers.set('content-type', response.headers.get('content-type') ?? 'application/json; charset=utf-8')
  headers.set('cache-control', response.headers.get('cache-control') ?? 'no-store')
  const etag = response.headers.get('ETag')
  if (etag) headers.set('ETag', etag)
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers,
  })
}

const parseProfileMeta = async (response: Response): Promise<{ id: string | null; username: string | null }> => {
  try {
    const body = await response.clone().json() as { id?: unknown; username?: unknown }
    return {
      id: typeof body.id === 'string' && body.id.length > 0 ? body.id : null,
      username: typeof body.username === 'string' && body.username.trim() ? body.username.trim() : null,
    }
  } catch {
    return { id: null, username: null }
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    await enforcePublicReadRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Profile service unavailable')
  }

  try {
    return forward(await callW02UserProfile(request, '/internal/account/profile', 'GET'))
  } catch (error) {
    if (error instanceof W02UserProfileClientError) {
      return errorResponse(error.status, 'SERVICE_UNAVAILABLE', 'Profile service unavailable')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Profile service unavailable')
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    await enforceW01WriteRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Profile service unavailable')
  }

  if (!request.headers.get('If-Match')?.trim()) {
    return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match is required')
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid request body')
  }

  try {
    const currentResponse = await callW02UserProfile(request, '/internal/account/profile', 'GET')
    if (!currentResponse.ok) return forward(currentResponse)
    const previous = await parseProfileMeta(currentResponse)

    const updatedResponse = await callW02UserProfile(
      request,
      '/internal/account/profile',
      'PATCH',
      body,
    )
    if (!updatedResponse.ok) return forward(updatedResponse)

    const updated = await parseProfileMeta(updatedResponse)
    try {
      if (updated.id) await invalidatePublicUserProfile(request, updated.id)
      for (const username of new Set([previous.username, updated.username])) {
        if (username) await invalidatePublicUserProfileByUsername(request, username)
      }
    } catch {
      // Cache invalidation is best-effort; the authoritative W02 mutation already succeeded.
    }

    return forward(updatedResponse)
  } catch (error) {
    if (error instanceof W02UserProfileClientError) {
      return errorResponse(error.status, 'SERVICE_UNAVAILABLE', 'Profile service unavailable')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Profile service unavailable')
  }
}
