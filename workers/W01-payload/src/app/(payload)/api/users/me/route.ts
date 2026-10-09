import { getPayload } from 'payload'

import { TrafficLimitError, enforcePublicReadRateLimit, enforceW01WriteRateLimit, rateLimitResponse } from '@/auth/traffic-limit'
import config from '@payload-config'
import { etagForUserProfile, normalizeEtag, pickUserProfileSnapshot, PROFILE_MUTABLE_FIELDS } from '@/auth/user-profile-etag'
import { invalidatePublicUserProfile, invalidatePublicUserProfileByUsername } from '@/lib/public-response-cache'
import { getBetterAuthPrincipal, W02AuthClientError } from '@/auth/w02-session-client'

const unauthorized = () => Response.json({ errors: [{ message: 'Authentication failed' }] }, { status: 401, headers: { 'cache-control': 'no-store' } })
const errorResponse = (status: number, code: string, message: string) => Response.json({ error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` }, { status, headers: { 'cache-control': 'no-store' } })

const profileResponse = async (user: Record<string, unknown>, status = 200) => {
  const etag = await etagForUserProfile(user)
  return new Response(JSON.stringify({ id: String(user.id ?? ''), email: typeof user.email === 'string' ? user.email : '', ...pickUserProfileSnapshot(user) }), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ETag: etag },
  })
}

async function authenticate(request: Request) {
  const principal = await getBetterAuthPrincipal(request)
  const payload = await getPayload({ config })
  const result = await payload.find({ collection: 'users', where: { identityId: { equals: principal.userId } }, limit: 1, depth: 0, overrideAccess: true })
  const user = result.docs[0] as unknown as Record<string, unknown> | undefined
  return user ? { payload, principal, user } : null
}

const authenticateErrorResponse = (error: unknown): Response => {
  if (error instanceof W02AuthClientError && error.status === 401) return unauthorized()
  return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Profile authentication service unavailable')
}

export async function GET(request: Request): Promise<Response> {
  try { await enforcePublicReadRateLimit(request) }
  catch (error) { if (error instanceof TrafficLimitError) return rateLimitResponse(request); return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Profile service unavailable') }
  try {
    const authenticated = await authenticate(request)
    return authenticated ? profileResponse(authenticated.user) : unauthorized()
  } catch (error) {
    return authenticateErrorResponse(error)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try { await enforceW01WriteRateLimit(request) }
  catch (error) { if (error instanceof TrafficLimitError) return rateLimitResponse(request); return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Profile service unavailable') }
  let authenticated: Awaited<ReturnType<typeof authenticate>>
  try {
    authenticated = await authenticate(request)
  } catch (error) {
    return authenticateErrorResponse(error)
  }
  if (!authenticated) return unauthorized()

  const ifMatch = request.headers.get('If-Match')?.trim() ?? ''
  if (!ifMatch) return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match is required')
  let body: unknown
  try { body = await request.json() } catch { return errorResponse(400, 'VALIDATION_FAILED', 'Invalid request body') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid request body')
  const input = body as Record<string, unknown>
  if (Object.keys(input).some(key => !PROFILE_MUTABLE_FIELDS.includes(key as typeof PROFILE_MUTABLE_FIELDS[number]))) return errorResponse(400, 'VALIDATION_FAILED', 'Unsupported profile field')

  const current = authenticated.user
  const currentEtag = await etagForUserProfile(current)
  if (normalizeEtag(ifMatch) !== normalizeEtag(currentEtag)) return errorResponse(412, 'PRECONDITION_FAILED', 'If-Match does not match current profile ETag')

  const data: Record<string, string | null> = {}
  for (const field of PROFILE_MUTABLE_FIELDS) {
    if (!(field in input)) continue
    const value = input[field]
    if (field === 'username') {
      if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid username')
      data[field] = value.trim()
    } else {
      if (value !== null && typeof value !== 'string') return errorResponse(400, 'VALIDATION_FAILED', 'Invalid profile field')
      data[field] = typeof value === 'string' ? value : null
    }
  }
  if (Object.keys(data).length === 0) return errorResponse(400, 'VALIDATION_FAILED', 'No profile fields to update')

  let updated: unknown
  try {
    updated = await authenticated.payload.update({
      collection: 'users',
      where: { and: [{ id: { equals: current.id } }, { updatedAt: { equals: current.updatedAt } }] },
      data, overrideAccess: true, depth: 0,
    })
  } catch (error) {
    if (error instanceof Error && /unique constraint|duplicate|username/i.test(error.message)) return errorResponse(400, 'VALIDATION_FAILED', 'Profile update could not be completed')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Profile service unavailable')
  }
  if (!updated || typeof updated !== 'object') return errorResponse(412, 'PRECONDITION_FAILED', 'Profile changed before update')
  const updatedRecord = updated as Record<string, unknown>
  await invalidatePublicUserProfile(request, String(current.id))
  const usernames = new Set<string>()
  for (const value of [current.username, updatedRecord.username]) if (typeof value === 'string' && value.trim()) usernames.add(value.trim())
  await Promise.all([...usernames].map(username => invalidatePublicUserProfileByUsername(request, username)))
  return profileResponse(updatedRecord)
}
