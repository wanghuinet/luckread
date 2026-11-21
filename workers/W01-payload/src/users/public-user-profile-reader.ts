import { getPayload } from 'payload'

import config from '@payload-config'
import { enforcePublicReadRateLimit } from '../auth/traffic-limit.js'
import { cachedPublicGet } from '../lib/public-response-cache.js'

const notFoundResponse = () => Response.json(
  { error: { code: 'NOT_FOUND', message: 'User not found', details: {} }, requestId: `req_${crypto.randomUUID()}` },
  { status: 404, headers: { 'cache-control': 'no-store' } },
)

const toPublicUser = (user: unknown): Response => {
  const publicUser = user as Record<string, unknown>
  return Response.json({
    id: String(publicUser.id ?? ''),
    identityId: typeof publicUser.identityId === 'string' ? publicUser.identityId : null,
    username: typeof publicUser.username === 'string' ? publicUser.username : '',
    displayName: typeof publicUser.displayName === 'string' ? publicUser.displayName : null,
    bio: typeof publicUser.bio === 'string' ? publicUser.bio : null,
    avatar: typeof publicUser.avatar === 'string' ? publicUser.avatar : null,
    requestId: `req_${crypto.randomUUID()}`,
  }, {
    headers: {
      'cache-control': 'public, max-age=30, stale-while-revalidate=120',
    },
  })
}

async function findPublicUser(userId: string): Promise<unknown | null> {
  const payload = await getPayload({ config })
  let user: unknown = null

  // Public profile URLs can carry either the legacy Payload row ID or the
  // canonical W02 identity ID emitted by W05 relationship pages.
  if (!/^[0-9]+$/.test(userId)) {
    const byIdentity = await payload.find({
      collection: 'users',
      where: { identityId: { equals: userId } },
      depth: 0,
      limit: 1,
      overrideAccess: true,
    })
    user = byIdentity.docs[0] ?? null
  }

  if (!user) {
    try {
      user = await payload.findByID({
        collection: 'users',
        id: userId,
        depth: 0,
        overrideAccess: true,
      })
    } catch (error) {
      // Translate only explicit missing-row errors. Database/configuration
      // faults must remain service failures and must never masquerade as 404.
      const details = error && typeof error === 'object'
        ? error as { status?: unknown; statusCode?: unknown; code?: unknown }
        : null
      if (
        details?.status === 404 ||
        details?.statusCode === 404 ||
        details?.code === 'NOT_FOUND'
      ) {
        user = null
      } else {
        throw error
      }
    }
  }

  // Numeric IDs are treated as legacy Payload row IDs first, but may also be
  // canonical identity IDs. Only fall back after a missing Payload row is proven.
  if (!user && /^[0-9]+$/.test(userId)) {
    const byIdentity = await payload.find({
      collection: 'users',
      where: { identityId: { equals: userId } },
      depth: 0,
      limit: 1,
      overrideAccess: true,
    })
    user = byIdentity.docs[0] ?? null
  }

  return user
}

/**
 * Shared W01 public-user read for the public API and server-rendered content
 * pages. Server components call this in-process instead of fetching their own
 * Worker hostname over the public network.
 */
export async function getPublicUserProfileResponse(
  request: Request,
  userId: string,
): Promise<Response> {
  await enforcePublicReadRateLimit(request)
  if (!userId || userId.length > 128) {
    return Response.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Invalid user id', details: {} }, requestId: `req_${crypto.randomUUID()}` },
      { status: 422, headers: { 'cache-control': 'no-store' } },
    )
  }

  return cachedPublicGet(
    request,
    'user-profile',
    async () => {
      const user = await findPublicUser(userId)
      return user ? toPublicUser(user) : notFoundResponse()
    },
    30,
  )
}
