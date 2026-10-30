import {
  forwardW07HyperswitchWebhook,
  W07SubscriptionClientError,
} from '../../../../../subscription/w07-subscription-client.js'

import { readBoundedProviderWebhookBody } from '../../../../../subscription/provider-webhook-body.js'

/**
 * Public provider callback ingress. W01 deliberately does not authenticate a
 * user, parse/re-serialize JSON, trust the payload, or store it. W07 verifies
 * the original bytes with HMAC-SHA512 and owns durable event/payment state.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await readBoundedProviderWebhookBody(request, errorResponse)
  if (rawBody instanceof Response) return rawBody

  try {
    return await forwardW07HyperswitchWebhook({ request, rawBody })
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Payment webhook service unavailable')
  }
}
