import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../../../../subscription/w07-subscription-client.js'
import { callW08Creator, W08CreatorClientError } from '../../../../../../../auth/w08-creator-client.js'
import {
  callW06MembershipPlanLifecycleAudit,
  callW06MembershipPlanLifecycleRequestAudit,
  W06ModerationClientError,
} from '../../../../../../../moderation/w06-moderation-client.js'

type RouteContext = { params: Promise<{ planId: string }> }
type LifecycleAction = 'pause' | 'resume'
const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() }, { status, headers: { 'cache-control': 'no-store' } })

async function authorizePlanLifecycle(request: Request, principalUserId: string): Promise<Response | null> {
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('content-type', 'application/json; charset=utf-8')
  const permissionRequest = new Request(request.url, {
    method: 'POST', headers,
    body: JSON.stringify({ action: 'membership.plan.lifecycle.own', resourceType: 'MembershipPlan', resourceAttributes: { ownerId: principalUserId } }),
  })
  const response = await callW08Creator(permissionRequest, '/internal/authz/check-permission', 'POST')
  if (!response.ok) return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Creator authorization unavailable')
  const value: unknown = await response.json().catch((): null => null)
  const decision = value && typeof value === 'object' ? (value as { data?: { decision?: unknown } }).data?.decision : undefined
  return decision === 'ALLOW' ? null : errorResponse(403, 'PERMISSION_DENIED', 'Creator membership plan lifecycle permission required')
}

async function resolveActiveCreatorId(request: Request): Promise<string | Response> {
  const response = await callW08Creator(request, '/internal/creator/self', 'GET')
  if (!response.ok) return response
  const value: unknown = await response.json().catch((): null => null)
  const creatorId = value && typeof value === 'object' ? (value as { data?: { creatorId?: unknown } }).data?.creatorId : null
  if (typeof creatorId !== 'string' || !creatorId.trim() || creatorId.length > 256) return errorResponse(503, 'CREATOR_IDENTITY_UNAVAILABLE', 'Creator identity unavailable')
  return creatorId
}

async function readLifecycleAction(request: Request): Promise<LifecycleAction | Response> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > 1024) return errorResponse(400, 'VALIDATION_FAILED', 'Plan lifecycle body is too large')
  if (!request.body) return errorResponse(400, 'VALIDATION_FAILED', 'A pause or resume action is required')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      byteLength += part.value.byteLength
      if (byteLength > 1024) { await reader.cancel(); return errorResponse(400, 'VALIDATION_FAILED', 'Plan lifecycle body is too large') }
      chunks.push(part.value)
    }
  } catch { return errorResponse(400, 'VALIDATION_FAILED', 'A valid JSON lifecycle body is required') }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
  catch { return errorResponse(400, 'VALIDATION_FAILED', 'A valid JSON lifecycle body is required') }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value as Record<string, unknown>).length !== 1 ||
      !Object.hasOwn(value, 'action') ||
      !['pause', 'resume'].includes(String((value as Record<string, unknown>).action))) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Only pause or resume is accepted')
  }
  return (value as { action: LifecycleAction }).action
}

function validLifecyclePlan(value: unknown, planId: string, creatorId: string, action: LifecycleAction, expectedVersion: number): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const plan = value as Record<string, unknown>
  const status = action === 'pause' ? 'PAUSED' : 'ACTIVE'
  const visibility = action === 'pause' ? 'PRIVATE' : 'PUBLIC'
  return plan.planId === planId && plan.creatorId === creatorId &&
    Number.isSafeInteger(plan.planVersion) && Number(plan.planVersion) >= 1 &&
    plan.status === status && plan.visibility === visibility &&
    Number.isSafeInteger(plan.version) &&
    (Number(plan.version) === expectedVersion || Number(plan.version) === expectedVersion + 1) &&
    plan.etag === '"lr-plan-v' + String(plan.version) + '"' &&
    typeof plan.replayed === 'boolean' &&
    (Number(plan.version) !== expectedVersion || plan.replayed === true) &&
    typeof plan.name === 'string' && plan.name.trim().length >= 1 && plan.name.length <= 120 &&
    typeof plan.tier === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(plan.tier) &&
    (plan.billingInterval === 'MONTHLY' || plan.billingInterval === 'YEARLY') &&
    Number.isSafeInteger(plan.priceMinor) && Number(plan.priceMinor) >= 0 && Number(plan.priceMinor) <= 2_147_483_647 &&
    typeof plan.currency === 'string' && /^[A-Z]{3}$/.test(plan.currency) &&
    Array.isArray(plan.benefits) && plan.benefits.length <= 20 &&
    plan.benefits.every((item) => typeof item === 'string' && item.length >= 1 && item.length <= 180) &&
    new Set(plan.benefits).size === plan.benefits.length &&
    typeof plan.createdAt === 'string' && !Number.isNaN(Date.parse(plan.createdAt)) &&
    typeof plan.updatedAt === 'string' && !Number.isNaN(Date.parse(plan.updatedAt))
}

/** Lifecycle affects new sales only; existing subscriptions and entitlements are not changed. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { planId } = await context.params
    if (typeof planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(planId)) return errorResponse(404, 'RESOURCE_NOT_FOUND', 'Membership plan not found')
    const ifMatch = request.headers.get('If-Match')
    if (!ifMatch) return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match is required to change plan lifecycle')
    const match = /^"lr-plan-v([1-9]\d*)"$/.exec(ifMatch)
    const expectedVersion = match?.[1] ? Number(match[1]) : Number.NaN
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return errorResponse(412, 'PRECONDITION_FAILED', 'Membership plan version does not match')
    const action = await readLifecycleAction(request)
    if (action instanceof Response) return action
    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal
    const denied = await authorizePlanLifecycle(request, principal.userId)
    if (denied) return denied
    const creatorId = await resolveActiveCreatorId(request)
    if (creatorId instanceof Response) return creatorId

    const requestedStatus = action === 'pause' ? 'PAUSED' : 'ACTIVE'
    const requestedVisibility = action === 'pause' ? 'PRIVATE' : 'PUBLIC'
    const intentEventId = 'evt_mpl_lifecycle_requested_' + action + '_' + planId + '_v' + expectedVersion
    let intentResponse: Response
    try {
      intentResponse = await callW06MembershipPlanLifecycleRequestAudit({
        request, principal, body: { eventId: intentEventId, planId, creatorId, expectedVersion, action, requestedStatus, requestedVisibility },
      })
    } catch { return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Membership plan lifecycle intent could not be durably recorded') }
    const intentValue: unknown = await intentResponse.json().catch((): null => null)
    if (
      (intentResponse.status !== 200 && intentResponse.status !== 201) ||
      !intentValue || typeof intentValue !== 'object' ||
      (intentValue as { eventId?: unknown }).eventId !== intentEventId ||
      (intentValue as { action?: unknown }).action !== 'membership.plan.lifecycle_requested' ||
      (intentValue as { targetId?: unknown }).targetId !== planId
    ) return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Membership plan lifecycle intent was not durably confirmed')

    const w07Response = await callW07Subscription({
      request, pathname: '/membership/plans/' + encodeURIComponent(planId) + '/lifecycle',
      method: 'POST', principal, verifiedCreatorId: creatorId, body: { action },
    })
    if (!w07Response.ok) return w07Response
    const envelopeValue: unknown = await w07Response.clone().json().catch((): null => null)
    const envelope = envelopeValue && typeof envelopeValue === 'object' && !Array.isArray(envelopeValue)
      ? envelopeValue as { data?: unknown; requestId?: unknown } : undefined
    if (!envelope || typeof envelope.requestId !== 'string' || !envelope.requestId.trim() || envelope.requestId.length > 256 ||
        !validLifecyclePlan(envelope.data, planId, creatorId, action, expectedVersion)) {
      return errorResponse(503, 'PLAN_RESPONSE_INVALID', 'Membership plan lifecycle result could not be verified')
    }
    const plan = envelope.data
    if (Number(plan.version) === expectedVersion && plan.replayed === true) return w07Response

    const eventAction = action === 'pause' ? 'paused' : 'activated'
    const finalEventId = 'evt_mpl_plan_' + eventAction + '_' + planId + '_v' + plan.version
    let auditResponse: Response
    try {
      auditResponse = await callW06MembershipPlanLifecycleAudit({
        request, principal,
        body: { eventId: finalEventId, planId, creatorId, expectedVersion, planVersion: plan.planVersion as number,
          action, status: requestedStatus, visibility: requestedVisibility, version: plan.version as number, occurredAt: plan.updatedAt as string },
      })
    } catch { return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Membership plan lifecycle audit service unavailable') }
    const auditValue: unknown = await auditResponse.json().catch((): null => null)
    if ((auditResponse.status !== 200 && auditResponse.status !== 201) ||
        !auditValue || typeof auditValue !== 'object' ||
        (auditValue as { eventId?: unknown }).eventId !== finalEventId ||
        (auditValue as { action?: unknown }).action !== (action === 'pause' ? 'membership.plan.paused' : 'membership.plan.activated') ||
        (auditValue as { targetId?: unknown }).targetId !== planId) {
      return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Membership plan lifecycle audit was not durably confirmed')
    }
    return w07Response
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) return errorResponse(error.status, error.code, error.message)
    if (error instanceof W08CreatorClientError) return errorResponse(503, 'CREATOR_SERVICE_UNAVAILABLE', 'Creator authorization service unavailable')
    if (error instanceof W06ModerationClientError) return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Membership audit service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Membership plan lifecycle service unavailable')
  }
}
