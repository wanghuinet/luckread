import { getPayload } from 'payload'

import { TrafficLimitError, enforcePublicReadRateLimit, enforceW01WriteRateLimit, rateLimitResponse } from '@/auth/traffic-limit'
import config from '@payload-config'
import { callW02, getBetterAuthPrincipal, W02AuthClientError } from '@/auth/w02-session-client'
import { invalidatePublicUserProfile, invalidatePublicUserProfileByUsername } from '@/lib/public-response-cache'

type JsonRecord = Record<string, unknown>

type UsernameState = {
  data?: {
    username?: unknown
    usernameVersion?: unknown
    canChangeAt?: unknown
  }
}

const requestId = () => `req_${crypto.randomUUID()}`

const errorResponse = (status: number, code: string, message: string) => Response.json(
  { error: { code, message, details: {} }, requestId: requestId() },
  { status, headers: { 'cache-control': 'no-store' } },
)

const authErrorResponse = (error: unknown): Response => {
  if (error instanceof W02AuthClientError && error.status === 401) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')
  }
  return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Username service unavailable')
}

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json() } catch { return null }
}

function forwardW02Response(response: Response, payload: unknown): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  const etag = response.headers.get('ETag')
  if (etag) headers.set('ETag', etag)
  return new Response(JSON.stringify(
    payload && typeof payload === 'object'
      ? { ...(payload as JsonRecord), requestId: requestId() }
      : { error: { code: 'SERVICE_UNAVAILABLE', message: 'Invalid username service response' }, requestId: requestId() },
  ), { status: response.status, headers })
}

const w02Headers = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
}

export async function GET(request: Request): Promise<Response> {
  try {
    await enforcePublicReadRateLimit(request)
    const response = await callW02('/internal/auth/username/state', {
      request,
      method: 'GET',
      headers: w02Headers,
    })
    return forwardW02Response(response, await readJson(response))
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return authErrorResponse(error)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    await enforceW01WriteRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Username service unavailable')
  }

  let principal
  try {
    principal = await getBetterAuthPrincipal(request)
  } catch (error) {
    return authErrorResponse(error)
  }

  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  const ifMatch = request.headers.get('If-Match')?.trim() ?? ''
  if (!idempotencyKey) return errorResponse(428, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required')
  if (!ifMatch) return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match is required')

  let input: unknown
  try { input = await request.json() } catch {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid username request')
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid username request')
  }
  const record = input as JsonRecord
  if (Object.keys(record).length !== 1 || typeof record.username !== 'string') {
    return errorResponse(422, 'VALIDATION_FAILED', 'Only the username field is accepted')
  }

  let response: Response
  let payload: unknown
  try {
    response = await callW02('/internal/auth/username/change', {
      request,
      method: 'POST',
      body: { username: record.username },
      headers: {
        ...w02Headers,
        'Idempotency-Key': idempotencyKey,
        'If-Match': ifMatch,
      },
    })
    payload = await readJson(response)
  } catch (error) {
    return authErrorResponse(error)
  }
  if (!response.ok) return forwardW02Response(response, payload)

  const state = payload && typeof payload === 'object'
    ? (payload as UsernameState).data
    : null
  const changedUsername = state && typeof state.username === 'string' ? state.username : null
  if (!changedUsername) return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Username service returned an invalid result')

  try {
    const payloadClient = await getPayload({ config })
    const existing = await payloadClient.find({
      collection: 'users',
      where: { identityId: { equals: principal.userId } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const user = existing.docs[0] as unknown as JsonRecord | undefined
    if (!user || typeof user.id !== 'string') {
      return errorResponse(503, 'PROFILE_PROJECTION_PENDING', 'Username changed but profile projection is not available; retry with the same Idempotency-Key')
    }

    const previousUsername = typeof user.username === 'string' ? user.username : ''
    if (previousUsername !== changedUsername) {
      // W02 remains authoritative. This is only W01's Payload read projection;
      // the Users collection hooks own the public URL history side effect.
      await payloadClient.update({
        collection: 'users',
        id: user.id,
        data: { username: changedUsername },
        depth: 0,
        overrideAccess: true,
      })
    }

    await invalidatePublicUserProfile(request, principal.userId)
    const usernames = new Set([previousUsername, changedUsername].filter(Boolean))
    await Promise.all([...usernames].map(username => invalidatePublicUserProfileByUsername(request, username)))
  } catch {
    // The W02 mutation is durable and idempotent. Retrying with the same key
    // replays its exact result and completes this W01 projection step safely.
    return errorResponse(503, 'PROFILE_PROJECTION_PENDING', 'Username changed but profile projection is pending; retry with the same Idempotency-Key')
  }

  return forwardW02Response(response, payload)
}
