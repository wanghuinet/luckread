import {
  forwardW07HyperswitchWebhook,
  W07SubscriptionClientError,
} from '../../../../../subscription/w07-subscription-client.js'

import { readBoundedProviderWebhookBody } from '../../../../../subscription/provider-webhook-body.js'
import { callW06SubscriptionPlanChangeAudit } from '../../../../../moderation/w06-moderation-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

/**
 * Public provider callback ingress. W01 deliberately does not authenticate a
 * user, parse/re-serialize JSON, trust the payload, or store it. W07 verifies
 * the original bytes with HMAC-SHA512 and owns durable event/payment state.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await readBoundedProviderWebhookBody(request, errorResponse)
  if (rawBody instanceof Response) return rawBody

  try {
    const response = await forwardW07HyperswitchWebhook({ request, rawBody })
    const envelope: unknown = await response.clone().json().catch((): null => null)
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return response
    const root = envelope as Record<string, unknown>
    const data = root.data
    if (!data || typeof data !== 'object' || Array.isArray(data)) return response
    const dataObject = data as Record<string, unknown>
    const fulfillment = dataObject.membershipPurchaseFulfillment
    if (!fulfillment || typeof fulfillment !== 'object' || Array.isArray(fulfillment)) return response
    const fulfillmentObject = fulfillment as Record<string, unknown>
    if (!Object.hasOwn(fulfillmentObject, 'subscriptionPlanChangeAudit')) return response

    const audit = fulfillmentObject.subscriptionPlanChangeAudit
    if (!audit || typeof audit !== 'object' || Array.isArray(audit)) {
      return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Subscription change audit facts could not be verified')
    }
    const value = audit as Record<string, unknown>
    if (
      typeof value.eventId !== 'string' || !/^evt_spc_scr_[a-f0-9]{60}$/.test(value.eventId) ||
      typeof value.actorUserId !== 'string' || value.actorUserId.length < 1 || value.actorUserId.length > 128 ||
      (typeof value.actorLayer !== 'string' || !/^L[2-8]$/.test(value.actorLayer)) ||
      typeof value.changeRequestId !== 'string' || !/^scr_[a-f0-9]{60}$/.test(value.changeRequestId) ||
      value.eventId !== 'evt_spc_' + value.changeRequestId ||
      typeof value.subscriptionId !== 'string' || value.subscriptionId.length < 1 || value.subscriptionId.length > 256 ||
      !Number.isSafeInteger(value.sourceSubscriptionVersion) || (value.sourceSubscriptionVersion as number) < 1 ||
      !Number.isSafeInteger(value.appliedSubscriptionVersion) ||
      value.appliedSubscriptionVersion !== (value.sourceSubscriptionVersion as number) + 1 ||
      typeof value.sourcePlanId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(value.sourcePlanId) ||
      !Number.isSafeInteger(value.sourcePlanVersion) || (value.sourcePlanVersion as number) < 1 ||
      typeof value.targetPlanId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(value.targetPlanId) ||
      !Number.isSafeInteger(value.targetPlanVersion) || (value.targetPlanVersion as number) < 1 ||
      typeof value.orderId !== 'string' || !/^ord_[A-Za-z0-9_-]{1,90}$/.test(value.orderId) ||
      typeof value.paymentId !== 'string' || !/^pay_[A-Za-z0-9]{26}$/.test(value.paymentId) ||
      typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency) ||
      !Number.isSafeInteger(value.amountBeforeTaxMinor) || (value.amountBeforeTaxMinor as number) <= 0 ||
      typeof value.currentPeriodStart !== 'string' || !Number.isFinite(Date.parse(value.currentPeriodStart)) ||
      typeof value.currentPeriodEnd !== 'string' || !Number.isFinite(Date.parse(value.currentPeriodEnd)) ||
      Date.parse(value.currentPeriodEnd) <= Date.parse(value.currentPeriodStart) ||
      typeof value.occurredAt !== 'string' || !Number.isFinite(Date.parse(value.occurredAt))
    ) {
      return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Subscription change audit facts could not be verified')
    }

    // The actor and layer originate from W07's immutable paid OrderLine
    // snapshot, which W01 originally populated from its W02-derived principal.
    // The webhook's browser/provider headers never set the audit actor.
    const auditResponse = await callW06SubscriptionPlanChangeAudit({
      request,
      principal: { userId: value.actorUserId, layer: value.actorLayer },
      body: {
        eventId: value.eventId,
        changeRequestId: value.changeRequestId,
        subscriptionId: value.subscriptionId,
        sourceSubscriptionVersion: value.sourceSubscriptionVersion as number,
        appliedSubscriptionVersion: value.appliedSubscriptionVersion as number,
        sourcePlanId: value.sourcePlanId,
        sourcePlanVersion: value.sourcePlanVersion as number,
        targetPlanId: value.targetPlanId,
        targetPlanVersion: value.targetPlanVersion as number,
        orderId: value.orderId,
        paymentId: value.paymentId,
        currency: value.currency,
        amountBeforeTaxMinor: value.amountBeforeTaxMinor as number,
        currentPeriodStart: value.currentPeriodStart,
        currentPeriodEnd: value.currentPeriodEnd,
        occurredAt: value.occurredAt,
      },
    })
    const auditResult: unknown = await auditResponse.json().catch((): null => null)
    if (
      (auditResponse.status !== 200 && auditResponse.status !== 201) ||
      !auditResult || typeof auditResult !== 'object' ||
      (auditResult as { eventId?: unknown }).eventId !== value.eventId ||
      (auditResult as { action?: unknown }).action !== 'membership.subscription.plan_changed' ||
      (auditResult as { targetType?: unknown }).targetType !== 'Subscription' ||
      (auditResult as { targetId?: unknown }).targetId !== value.subscriptionId
    ) {
      // A provider retry replays W07's immutable receipt and this deterministic
      // W06 event ID; never acknowledge the callback before durable audit.
      return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Subscription change audit was not durably confirmed')
    }

    // Keep internal actor and audit metadata out of the provider-facing reply.
    delete fulfillmentObject.subscriptionPlanChangeAudit
    return Response.json(envelope, { status: response.status, headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Payment webhook service unavailable')
  }
}
