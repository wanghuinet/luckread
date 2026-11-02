import { cachedPublicGet } from '../lib/public-response-cache.js'
import { enforcePublicReadRateLimit } from '../auth/traffic-limit.js'
import { hasAuthenticatedSessionCredential } from '../lib/content-list-cache-guard.js'
import {
  callW03Content,
  resolveOptionalCookieContentPrincipal,
} from './w03-content-client.js'

const contentPath = (contentId: string) =>
  `/internal/content/contents/${encodeURIComponent(contentId)}`

/**
 * Shared W01 public content-detail boundary for HTTP API handlers and
 * server-rendered pages. It stays inside the current Worker and reaches W03
 * only through the existing W03_CONTENT Service Binding.
 */
export async function getPublicContentDetailResponse(
  request: Request,
  contentId: string,
): Promise<Response> {
  if (!hasAuthenticatedSessionCredential(request)) {
    await enforcePublicReadRateLimit(request)
    return cachedPublicGet(
      request,
      'content-detail',
      () => callW03Content({
        request,
        pathname: contentPath(contentId),
        method: 'GET',
      }),
      30,
    )
  }

  const principal = await resolveOptionalCookieContentPrincipal(request)
  if (principal instanceof Response) return principal
  return callW03Content({
    request,
    pathname: contentPath(contentId),
    method: 'GET',
    principal,
  })
}
