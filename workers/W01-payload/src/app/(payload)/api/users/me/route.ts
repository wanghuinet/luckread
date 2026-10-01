import { getPayload } from 'payload'

import config from '@payload-config'

import { etagForUserProfile, normalizeEtag, pickUserProfileSnapshot, PROFILE_MUTABLE_FIELDS } from '@/auth/user-profile-etag'
import { readVerifiedPayloadTokenVersion } from '@/auth/payload-access-token'
import { validateSession } from '@/auth/w02-session-client'

const unauthorized = () =>
  new Response(
    JSON.stringify({
      errors: [{ message: 'Authentication failed' }],
    }),
    {
      status: 401,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  )

const errorResponse = (status: number, code: string, message: string) =>
  new Response(
    JSON.stringify({
      error: { code, message, details: {} },
      requestId: crypto.randomUUID(),
    }),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  )

const profileResponse = async (user: Record<string, unknown>, status = 200) => {
  const etag = await etagForUserProfile(user)
  return new Response(JSON.stringify({
    id: String(user.id ?? ''),
    email: typeof user.email === 'string' ? user.email : '',
    ...pickUserProfileSnapshot(user),
  }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ETag: etag,
    },
  })
}

async function authenticate(request: Request) {
  const payload = await getPayload({ config })

  let authResult: Awaited<ReturnType<typeof payload.auth>>
  try {
    authResult = await payload.auth({
      headers: request.headers,
      canSetHeaders: false,
    })
  } catch {
    return null
  }

  const user = authResult.user as unknown as ({ id?: string | number; _sid?: string } & Record<string, unknown>) | null
  if (!user?.id || typeof user._sid !== 'string' || user._sid.length === 0) return null

  const tokenVersion = readVerifiedPayloadTokenVersion(request)
  if (tokenVersion === null) return null

  const active = await validateSession({
    sessionId: user._sid,
    userId: String(user.id),
    tokenVersion,
  }).catch(() => false)

  return active ? { payload, user } : null
}

export async function GET(request: Request): Promise<Response> {
  const authenticated = await authenticate(request)
  if (!authenticated) return unauthorized()

  return profileResponse(authenticated.user)
}

export async function PATCH(request: Request): Promise<Response> {
  const authenticated = await authenticate(request)
  if (!authenticated) return unauthorized()

  const ifMatch = request.headers.get('If-Match')?.trim() ?? ''
  if (!ifMatch) return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match is required')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid request body')
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid request body')
  }

  const input = body as Record<string, unknown>
  const hasUnknownField = Object.keys(input).some(
    (key) => !PROFILE_MUTABLE_FIELDS.includes(key as typeof PROFILE_MUTABLE_FIELDS[number]),
  )
  if (hasUnknownField) return errorResponse(400, 'VALIDATION_FAILED', 'Unsupported profile field')

  const current = await authenticated.payload.findByID({
    collection: 'users',
    id: authenticated.user.id,
    depth: 0,
  }) as unknown as Record<string, unknown>

  const currentEtag = await etagForUserProfile(current)
  if (normalizeEtag(ifMatch) !== normalizeEtag(currentEtag)) {
    return errorResponse(412, 'PRECONDITION_FAILED', 'If-Match does not match current profile ETag')
  }

  const data: Record<string, string | null> = {}
  for (const field of PROFILE_MUTABLE_FIELDS) {
    if (!(field in input)) continue
    const value = input[field]

    if (field === 'username') {
      if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
        return errorResponse(400, 'VALIDATION_FAILED', 'Invalid username')
      }
      data[field] = value.trim()
      continue
    }

    if (value !== null && typeof value !== 'string') {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid profile field')
    }
    data[field] = typeof value === 'string' ? value : null
  }

  if (Object.keys(data).length === 0) {
    return errorResponse(400, 'VALIDATION_FAILED', 'No profile fields to update')
  }

  let updated: unknown
  try {
    updated = await authenticated.payload.update({
      collection: 'users',
      where: {
        and: [
          { id: { equals: authenticated.user.id } },
          { updatedAt: { equals: current.updatedAt } },
        ],
      },
      data,
      overrideAccess: false,
      depth: 0,
    })
  } catch (error) {
    if (error instanceof Error && /unique constraint|duplicate|username/i.test(error.message)) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Profile update could not be completed')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Profile service unavailable')
  }

  if (!updated || typeof updated !== 'object') {
    return errorResponse(412, 'PRECONDITION_FAILED', 'Profile changed before update')
  }

  return profileResponse(updated as Record<string, unknown>)
}
