import { authorizeOrderPermission, mapOrderAdapterError, orderAdapterError } from '../../../../../commerce/w07-commerce-client.js'
import { resolveCookieSubscriptionPrincipal, callW07Subscription, W07SubscriptionClientError } from '../../../../../subscription/w07-subscription-client.js'
import { W08CreatorClientError } from '../../../../../auth/w08-creator-client.js'

type RouteContext = { params: Promise<{ orderId: string }> }

/** Order ownership is checked again by W07's customer-scoped D1-04 query. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { orderId } = await context.params
    if (typeof orderId !== 'string' || !/^ord_[A-Za-z0-9_-]{1,90}$/.test(orderId)) {
      return orderAdapterError(404, 'RESOURCE_NOT_FOUND', 'Order not found')
    }

    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal

    const denied = await authorizeOrderPermission(request, principal, 'order.read')
    if (denied) return denied

    return await callW07Subscription({
      request,
      pathname: '/commerce/orders/' + encodeURIComponent(orderId),
      method: 'GET',
      principal,
    })
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) {
      return orderAdapterError(error.status, error.code, error.message)
    }
    if (error instanceof W08CreatorClientError) {
      return orderAdapterError(503, 'AUTHORIZATION_UNAVAILABLE', 'Order authorization unavailable')
    }
    return mapOrderAdapterError(error)
  }
}
