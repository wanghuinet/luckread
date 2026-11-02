import { getPayload } from 'payload'

import config from '@payload-config'
import { enforcePublicReadRateLimit, TrafficLimitError, rateLimitResponse } from '@/auth/traffic-limit'
import {
  normalizeUsernameRedirectHandle,
  isUsernameRedirectActive,
  usernameRedirectFromPath,
  usernameRedirectTargetPath,
} from '@/lib/username-redirect'

type UsernameRedirectDocument = {
  type?: unknown
  redirectScope?: unknown
  identityId?: unknown
  destinationUsername?: unknown
  expiresAt?: unknown
  to?: { type?: unknown; url?: unknown } | null
}

type RedirectCollectionAPI = {
  find: (args: {
    collection: 'redirects'
    where: Record<string, unknown>
    depth: 0
    limit: 1
    overrideAccess: true
  }) => Promise<{ docs: UsernameRedirectDocument[] }>
}

const redirectAPI = (payload: unknown): RedirectCollectionAPI =>
  payload as RedirectCollectionAPI

const notFound = () => Response.json(
  { error: { code: 'NOT_FOUND', message: 'Username redirect not found', details: {} }, requestId: `req_${crypto.randomUUID()}` },
  { status: 404, headers: { 'cache-control': 'no-store' } },
)

export async function GET(
  request: Request,
  context: { params: Promise<{ username: string }> },
): Promise<Response> {
  try {
    await enforcePublicReadRateLimit(request)
    const { username: rawUsername } = await context.params
    const username = normalizeUsernameRedirectHandle(rawUsername)
    if (!username) return notFound()
    const now = new Date()
    const payload = await getPayload({ config })
    const result = await redirectAPI(payload).find({
      collection: 'redirects',
      where: { and: [
        { from: { equals: usernameRedirectFromPath(username) } },
        { redirectScope: { equals: 'username' } },
        { expiresAt: { greater_than: now.toISOString() } },
      ] },
      depth: 0, limit: 1, overrideAccess: true,
    })
    const redirect = result.docs[0]
    const identityId = typeof redirect?.identityId === 'string' ? redirect.identityId.trim() : ''
    const destinationUsername = normalizeUsernameRedirectHandle(redirect?.destinationUsername)
    const destinationPath = destinationUsername ? usernameRedirectTargetPath(destinationUsername) : null
    if (!redirect || redirect.type !== '301' || redirect.redirectScope !== 'username' || !identityId ||
        !isUsernameRedirectActive(redirect.expiresAt, now) || redirect.to?.type !== 'custom' ||
        !destinationPath || redirect.to.url !== destinationPath) return notFound()
    // Never trust a historical row if the recorded identity no longer owns the destination handle.
    const ownerResult = await payload.find({
      collection: 'users',
      where: { identityId: { equals: identityId } },
      depth: 0, limit: 1, overrideAccess: true,
    })
    const currentOwner = ownerResult.docs[0]
    const currentOwnerUsername = normalizeUsernameRedirectHandle(currentOwner?.username)
    if (!currentOwner || currentOwner.identityId !== identityId || !currentOwnerUsername ||
        currentOwnerUsername.toLowerCase() !== destinationUsername.toLowerCase()) return notFound()
    return Response.json({ targetUsername: destinationUsername }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return Response.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Username redirect service unavailable', details: {} }, requestId: 'req_' + crypto.randomUUID() },
      { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '1' } },
    )
  }
}
