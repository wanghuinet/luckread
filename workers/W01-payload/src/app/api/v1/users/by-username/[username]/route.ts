import { getPayload } from 'payload'

import config from '@payload-config'
import { enforcePublicReadRateLimit, TrafficLimitError, rateLimitResponse } from '../../../../../../auth/traffic-limit.js'
import { hasAuthenticatedSessionCredential } from '../../../../../../lib/content-list-cache-guard.js'
import { cachedPublicGet } from '../../../../../../lib/public-response-cache.js'

const usernamePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export async function GET(
  request: Request,
  context: { params: Promise<{ username: string }> },
): Promise<Response> {
  try {
    await enforcePublicReadRateLimit(request)
    const { username: rawUsername } = await context.params
    const username = rawUsername?.trim() ?? ''

    if (!username || !usernamePattern.test(username)) {
      return Response.json(
        { error: { code: 'VALIDATION_FAILED', message: 'Invalid username', details: {} }, requestId: crypto.randomUUID() },
        { status: 400, headers: { 'cache-control': 'no-store' } },
      )
    }

    const loadProfile = async (cacheControl: 'public' | 'private' = 'public'): Promise<Response> => {
      const payload = await getPayload({ config })
      const result = await payload.find({
        collection: 'users',
        where: { username: { equals: username } },
        depth: 0,
        limit: 1,
        overrideAccess: true,
      })

      const user = result.docs[0]
      if (!user) {
        return Response.json(
          { error: { code: 'RESOURCE_NOT_FOUND', message: 'User not found', details: {} }, requestId: crypto.randomUUID() },
          { status: 404, headers: { 'cache-control': 'no-store' } },
        )
      }

      const publicUser = user as unknown as Record<string, unknown>
      return Response.json({
        id: String(publicUser.id ?? ''),
        username: typeof publicUser.username === 'string' ? publicUser.username : '',
        displayName: typeof publicUser.displayName === 'string' ? publicUser.displayName : null,
        bio: typeof publicUser.bio === 'string' ? publicUser.bio : null,
        avatar: typeof publicUser.avatar === 'string' ? publicUser.avatar : null,
      }, {
        headers: {
          'cache-control': cacheControl === 'private' ? 'private, no-store' : 'public, max-age=30, stale-while-revalidate=120',
        },
      })
    }

    if (hasAuthenticatedSessionCredential(request)) return await loadProfile('private')
    return await cachedPublicGet(request, 'user-profile-by-username', loadProfile, 30)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return Response.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Profile service unavailable', details: {} }, requestId: crypto.randomUUID() },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
