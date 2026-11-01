import { getPayload } from 'payload'

import config from '@payload-config'
import { enforcePublicReadRateLimit, TrafficLimitError, rateLimitResponse } from '@/auth/traffic-limit'
import { cachedPublicGet } from '@/lib/public-response-cache'
import {
  normalizeUsernameRedirectHandle,
  usernameRedirectFromPath,
  usernameRedirectTargetPath,
} from '@/lib/username-redirect'

type UsernameRedirectDocument = {
  type?: unknown
  redirectScope?: unknown
  identityId?: unknown
  destinationUsername?: unknown
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

    return await cachedPublicGet(
      request,
      'username-redirect',
      async () => {
        const payload = await getPayload({ config })
        const result = await redirectAPI(payload).find({
          collection: 'redirects',
          where: {
            and: [
              { from: { equals: usernameRedirectFromPath(username) } },
              { redirectScope: { equals: 'username' } },
            ],
          },
          depth: 0,
          limit: 1,
          overrideAccess: true,
        })

        const redirect = result.docs[0]
        const destinationUsername = normalizeUsernameRedirectHandle(redirect?.destinationUsername)
        const destinationPath = destinationUsername
          ? usernameRedirectTargetPath(destinationUsername)
          : null

        if (
          !redirect ||
          redirect.type !== '301' ||
          redirect.redirectScope !== 'username' ||
          typeof redirect.identityId !== 'string' ||
          !redirect.identityId.trim() ||
          redirect.to?.type !== 'custom' ||
          !destinationPath ||
          redirect.to.url !== destinationPath
        ) {
          return notFound()
        }

        return Response.json(
          { targetUsername: destinationUsername },
          { headers: { 'cache-control': 'public, max-age=0, s-maxage=10' } },
        )
      },
      10,
    )
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return Response.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Username redirect service unavailable', details: {} }, requestId: `req_${crypto.randomUUID()}` },
      { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '1' } },
    )
  }
}
