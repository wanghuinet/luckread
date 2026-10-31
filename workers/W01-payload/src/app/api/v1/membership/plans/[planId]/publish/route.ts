import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../../../../subscription/w07-subscription-client.js'
import { callW08Creator, W08CreatorClientError } from '../../../../../../../auth/w08-creator-client.js'
import {
  callW06MembershipPlanPublishAudit,
  callW06MembershipPlanPublishRequestAudit,
  W06ModerationClientError,
} from '../../../../../../../moderation/w06-moderation-client.js'

type RouteContext = { params: Promise<{ planId: string }> }

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

async function authorizePlanPublish(
  request: Request,
  principalUserId: string,
): Promise<Response | null> {
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('content-type', 'application/json; charset=utf-8')
  const permissionRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'membership.plan.publish.own',
      resourceType: 'MembershipPlan',
      resourceAttributes: { ownerId: principalUserId },
    }),
  })
  const response = await callW08Creator(permissionRequest, '/internal/authz/check-permission', 'POST')
  if (!response.ok) return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Creator authorization unavailable')
  const value: unknown = await response.json().catch((): null => null)
  const decision = value && typeof value === 'object'
    ? (value as { data?: { decision?: unknown } }).data?.decision
    : undefined
  return decision === 'ALLOW'
    ? null
    : errorResponse(403, 'PERMISSION_DENIED', 'Creator membership plan publish permission required')
}

async function resolveActiveCreatorId(request: Request): Promise<string | Response> {
  const response = await callW08Creator(request, '/internal/creator/self', 'GET')
  if (!response.ok) return response
  const value: unknown = await response.json().catch((): null => null)
  const creatorId = value && typeof value === 'object'
    ? (value as { data?: { creatorId?: unknown } }).data?.creatorId
    : null
  if (typeof creatorId !== 'string' || !creatorId.trim() || creatorId.length > 256) {
    return errorResponse(503, 'CREATOR_IDENTITY_UNAVAILABLE', 'Creator identity unavailable')
  }
  return creatorId
}

function validPublishedPlan(value: unknown, expectedPlanId: string, expectedCreatorId: string): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const plan = value as Record<string, unknown>
  return plan.planId === expectedPlanId &&
    plan.creatorId === expectedCreatorId &&
    Number.isSafeInteger(plan.planVersion) && Number(plan.planVersion) >= 1 &&
    plan.status === 'ACTIVE' &&
    plan.visibility === 'PUBLIC' &&
    Number.isSafeInteger(plan.version) && Number(plan.version) >= 2 &&
    plan.etag === `"lr-plan-v${String(plan.version)}"` &&
    typeof plan.replayed === 'boolean' &&
    typeof plan.name === 'string' && plan.name.trim().length >= 1 && plan.name.length <= 120 &&
    typeof plan.tier === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(plan.tier) &&
    (plan.billingInterval === 'MONTHLY' || plan.billingInterval === 'YEARLY') &&
    Number.isSafeInteger(plan.priceMinor) && Number(plan.priceMinor) >= 0 && Number(plan.priceMinor) <= 2_147_483_647 &&
    typeof plan.currency === 'string' && /^[A-Z]{3}$/.test(plan.currency) &&
    Number.isSafeInteger(plan.trialDays) && Number(plan.trialDays) >= 0 && Number(plan.trialDays) <= 90 &&
    Array.isArray(plan.benefits) && plan.benefits.length <= 20 &&
    plan.benefits.every((item) => typeof item === 'string' && item.length >= 1 && item.length <= 180) &&
    new Set(plan.benefits).size === plan.benefits.length &&
    typeof plan.createdAt === 'string' && !Number.isNaN(Date.parse(plan.createdAt)) &&
    typeof plan.updatedAt === 'string' && !Number.isNaN(Date.parse(plan.updatedAt))
}

/**
 * Publishing is an owner-only lifecycle transition. W01 requires CASL, checks
 * W08's active creator identity, delegates the conditional write to W07, and
 * waits for W06's immutable audit event before returning success.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    if (request.body !== null) {
      await request.body.cancel().catch((): void => {})
      return errorResponse(400, 'VALIDATION_FAILED', 'Plan publish does not accept a request body')
    }
    const { planId } = await context.params
    if (typeof planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(planId)) {
      return errorResponse(404, 'RESOURCE_NOT_FOUND', 'Membership plan not found')
    }
    const ifMatch = request.headers.get('If-Match')
    if (!ifMatch) return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match is required to publish a plan')
    const ifMatchVersion = /^"lr-plan-v([1-9]\d*)"$/.exec(ifMatch)
    const expectedVersion = ifMatchVersion?.[1] ? Number(ifMatchVersion[1]) : Number.NaN
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      return errorResponse(412, 'PRECONDITION_FAILED', 'Membership plan version does not match')
    }

    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal
    const denied = await authorizePlanPublish(request, principal.userId)
    if (denied) return denied
    const creatorId = await resolveActiveCreatorId(request)
    if (creatorId instanceof Response) return creatorId

    const publishRequestEventId = 'evt_mpl_publish_requested_' + planId + '_v' + expectedVersion
    let publishRequestAudit: Response
    try {
      publishRequestAudit = await callW06MembershipPlanPublishRequestAudit({
        request,
        principal,
        body: {
          eventId: publishRequestEventId,
          planId,
          creatorId,
          expectedVersion,
          requestedStatus: 'ACTIVE',
          requestedVisibility: 'PUBLIC',
        },
      })
    } catch {
      return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Membership plan publish intent could not be durably recorded')
    }
    const publishRequestAuditValue: unknown = await publishRequestAudit.json().catch((): null => null)
    if (
      (publishRequestAudit.status !== 200 && publishRequestAudit.status !== 201) ||
      !publishRequestAuditValue || typeof publishRequestAuditValue !== 'object' ||
      (publishRequestAuditValue as { eventId?: unknown }).eventId !== publishRequestEventId ||
      (publishRequestAuditValue as { action?: unknown }).action !== 'membership.plan.publish_requested' ||
      (publishRequestAuditValue as { targetId?: unknown }).targetId !== planId
    ) {
      return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Membership plan publish intent was not durably confirmed')
    }

    const w07Response = await callW07Subscription({
      request,
      pathname: '/membership/plans/' + encodeURIComponent(planId) + '/publish',
      method: 'POST',
      principal,
    })
    if (!w07Response.ok) return w07Response

    const envelopeValue: unknown = await w07Response.clone().json().catch((): null => null)
    const envelope = envelopeValue && typeof envelopeValue === 'object' && !Array.isArray(envelopeValue)
      ? envelopeValue as { data?: unknown; requestId?: unknown }
      : undefined
    if (
      !envelope ||
      typeof envelope.requestId !== 'string' || envelope.requestId.trim().length < 1 || envelope.requestId.length > 256 ||
      !validPublishedPlan(envelope.data, planId, creatorId)
    ) {
      return errorResponse(503, 'PLAN_RESPONSE_INVALID', 'Published membership plan result could not be verified')
    }
    const plan = envelope.data

    let auditResponse: Response
    try {
      auditResponse = await callW06MembershipPlanPublishAudit({
        request,
        principal,
        body: {
          eventId: 'evt_mpl_published_' + plan.planId + '_v' + plan.version,
          planId: plan.planId as string,
          creatorId,
          planVersion: plan.planVersion as number,
          status: 'ACTIVE',
          visibility: 'PUBLIC',
          version: plan.version as number,
          occurredAt: plan.updatedAt as string,
          name: plan.name as string,
          tier: plan.tier as string,
          billingInterval: plan.billingInterval as 'MONTHLY' | 'YEARLY',
          priceMinor: plan.priceMinor as number,
          currency: plan.currency as string,
          trialDays: plan.trialDays as number,
        },
      })
    } catch {
      return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Membership plan audit service unavailable')
    }
    const auditValue: unknown = await auditResponse.json().catch((): null => null)
    if (
      (auditResponse.status !== 200 && auditResponse.status !== 201) ||
      !auditValue || typeof auditValue !== 'object' ||
      (auditValue as { eventId?: unknown }).eventId !== 'evt_mpl_published_' + plan.planId + '_v' + plan.version ||
      (auditValue as { action?: unknown }).action !== 'membership.plan.published' ||
      (auditValue as { targetId?: unknown }).targetId !== plan.planId
    ) {
      return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Membership plan publish audit was not durably confirmed')
    }
    return w07Response
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) return errorResponse(error.status, error.code, error.message)
    if (error instanceof W08CreatorClientError) return errorResponse(503, 'CREATOR_SERVICE_UNAVAILABLE', 'Creator authorization service unavailable')
    if (error instanceof W06ModerationClientError) return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Membership audit service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Membership plan publish service unavailable')
  }
}
