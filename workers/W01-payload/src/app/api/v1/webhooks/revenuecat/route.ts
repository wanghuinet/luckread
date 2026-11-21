import {
  forwardW07RevenueCatWebhook,
  W07SubscriptionClientError,
} from '../../../../../subscription/w07-subscription-client.js'
import { readBoundedProviderWebhookBody } from '../../../../../subscription/provider-webhook-body.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

/**
 * Public RevenueCat provider callback ingress. W01 does not parse the body,
 * resolve a browser session, or persist provider state. It forwards only the
 * configured webhook Authorization, optional HMAC signature, fixed internal
 * transport metadata, and the exact bounded raw bytes to W07.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await readBoundedProviderWebhookBody(request, errorResponse)
  if (rawBody instanceof Response) return rawBody

  try {
    return await forwardW07RevenueCatWebhook({ request, rawBody })
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'RevenueCat webhook service unavailable')
  }
}
