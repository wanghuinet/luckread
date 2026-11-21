import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../subscription/w07-subscription-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

/**
 * Discovery of purchasable plans is routed through W01 to the W07 authority.
 * W07 returns only ACTIVE + PUBLIC creator plans and the immutable current
 * version. No client-provided owner or price data is accepted by this route.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal
    const url = new URL(request.url)
    return await callW07Subscription({
      request,
      pathname: '/plans' + url.search,
      method: 'GET',
      principal,
    })
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Plan discovery service unavailable')
  }
}
