import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../../subscription/w07-subscription-client.js'
import { callW08Creator, W08CreatorClientError } from '../../../../../auth/w08-creator-client.js'
import { callW06MembershipPlanAudit, W06ModerationClientError } from '../../../../../moderation/w06-moderation-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

async function authorizePlanPermission(
  request: Request,
  principalUserId: string,
  action: 'membership.plan.create.own' | 'membership.plan.read.own' | 'membership.plan.publish.own',
): Promise<Response | null> {
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('content-type', 'application/json; charset=utf-8')
  const permissionRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action,
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
  if (decision !== 'ALLOW') {
    return errorResponse(403, 'PERMISSION_DENIED', 'Creator membership plan permission required')
  }
  return null
}

async function resolveActiveCreatorId(request: Request): Promise<string | Response> {
  const response = await callW08Creator(request, '/internal/creator/self', 'GET')
  if (!response.ok) return response
  const value: unknown = await response.json().catch((): null => null)
  // W08's JSON helper wraps successful bodies in the canonical data envelope.
  const creatorId = value && typeof value === 'object'
    ? (value as { data?: { creatorId?: unknown } }).data?.creatorId
    : null
  if (typeof creatorId !== 'string' || !creatorId.trim() || creatorId.length > 256) {
    return errorResponse(503, 'CREATOR_IDENTITY_UNAVAILABLE', 'Creator identity unavailable')
  }
  return creatorId
}

type PlanBodyReadResult = { ok: true; value: unknown } | { ok: false; response: Response }

async function readBoundedPlanBody(request: Request): Promise<PlanBodyReadResult> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > 16_384) {
    return { ok: false, response: errorResponse(400, 'VALIDATION_FAILED', 'Plan request is too large') }
  }
  if (!request.body) {
    return { ok: false, response: errorResponse(400, 'VALIDATION_FAILED', 'A valid JSON plan body is required') }
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      byteLength += part.value.byteLength
      if (byteLength > 16_384) {
        await reader.cancel()
        return { ok: false, response: errorResponse(400, 'VALIDATION_FAILED', 'Plan request is too large') }
      }
      chunks.push(part.value)
    }
  } catch {
    return { ok: false, response: errorResponse(400, 'VALIDATION_FAILED', 'A valid JSON plan body is required') }
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, response: errorResponse(400, 'VALIDATION_FAILED', 'A valid JSON plan body is required') }
  }
}

/** Creator plan management stays on the canonical W01 → W08/W07 paths. */
export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal
    const denied = await authorizePlanPermission(request, principal.userId, 'membership.plan.read.own')
    if (denied) return denied
    const creatorId = await resolveActiveCreatorId(request)
    if (creatorId instanceof Response) return creatorId
    const url = new URL(request.url)
    return await callW07Subscription({
      request,
      pathname: '/membership/plans' + url.search,
      method: 'GET',
      principal,
      verifiedCreatorId: creatorId,
    })
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) return errorResponse(error.status, error.code, error.message)
    if (error instanceof W08CreatorClientError) return errorResponse(error.status, 'CREATOR_SERVICE_UNAVAILABLE', 'Creator authorization service unavailable')
    if (error instanceof W06ModerationClientError) return errorResponse(error.status, 'AUDIT_UNAVAILABLE', 'Membership audit service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Membership plan service unavailable')
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal
    const denied = await authorizePlanPermission(request, principal.userId, 'membership.plan.create.own')
    if (denied) return denied
    const creatorId = await resolveActiveCreatorId(request)
    if (creatorId instanceof Response) return creatorId
    const bodyResult = await readBoundedPlanBody(request)
    if (bodyResult.ok === false) return bodyResult.response
    const body = bodyResult.value
    const w07Response = await callW07Subscription({
      request,
      pathname: '/membership/plans',
      method: 'POST',
      principal,
      verifiedCreatorId: creatorId,
      body,
    })
    if (!w07Response.ok) return w07Response

    const responseEnvelope: unknown = await w07Response.clone().json().catch((): null => null)
    const envelope = responseEnvelope && typeof responseEnvelope === 'object' && !Array.isArray(responseEnvelope)
      ? responseEnvelope as { data?: Record<string, unknown>; requestId?: unknown }
      : undefined
    const plan = envelope?.data
    if (
      !envelope ||
      typeof envelope.requestId !== 'string' || envelope.requestId.trim().length < 1 || envelope.requestId.length > 256 ||
      !plan ||
      typeof plan.planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(plan.planId) ||
      plan.creatorId !== creatorId ||
      plan.planVersion !== 1 ||
      plan.status !== 'DRAFT' ||
      plan.visibility !== 'PRIVATE' ||
      typeof plan.createdAt !== 'string' ||
      Number.isNaN(Date.parse(plan.createdAt)) ||
      typeof plan.updatedAt !== 'string' ||
      Number.isNaN(Date.parse(plan.updatedAt)) ||
      typeof plan.version !== 'number' || plan.version !== 1 ||
      plan.etag !== '"lr-plan-v1"' ||
      typeof plan.replayed !== 'boolean' ||
      !Array.isArray(plan.benefits) ||
      plan.benefits.length > 20 ||
      plan.benefits.some((item: unknown) => typeof item !== 'string' || item.trim() !== item || item.length < 1 || item.length > 180) ||
      new Set(plan.benefits).size !== plan.benefits.length ||
      typeof plan.name !== 'string' || plan.name.trim().length < 1 || plan.name.length > 120 ||
      typeof plan.tier !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(plan.tier) ||
      (plan.billingInterval !== 'MONTHLY' && plan.billingInterval !== 'YEARLY') ||
      typeof plan.priceMinor !== 'number' || !Number.isSafeInteger(plan.priceMinor) || plan.priceMinor < 0 || plan.priceMinor > 2_147_483_647 ||
      typeof plan.currency !== 'string' || !/^[A-Z]{3}$/.test(plan.currency) ||
      typeof plan.trialDays !== 'number' || !Number.isSafeInteger(plan.trialDays) || plan.trialDays < 0 || plan.trialDays > 90
    ) {
      return errorResponse(503, 'PLAN_RESPONSE_INVALID', 'Membership plan result could not be verified')
    }

    let auditResponse: Response
    try {
      auditResponse = await callW06MembershipPlanAudit({
        request,
        principal,
        body: {
          eventId: 'evt_mpl_created_' + plan.planId,
          planId: plan.planId,
          creatorId,
          planVersion: 1,
          status: 'DRAFT',
          visibility: 'PRIVATE',
          occurredAt: plan.createdAt,
          name: plan.name,
          tier: plan.tier,
          billingInterval: plan.billingInterval,
          priceMinor: plan.priceMinor,
          currency: plan.currency,
          trialDays: plan.trialDays,
        },
      })
    } catch {
      return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Membership audit service unavailable')
    }
    const auditResult: unknown = await auditResponse.json().catch((): null => null)
    if (
      (auditResponse.status !== 200 && auditResponse.status !== 201) ||
      !auditResult || typeof auditResult !== 'object' ||
      (auditResult as { eventId?: unknown }).eventId !== 'evt_mpl_created_' + plan.planId ||
      (auditResult as { action?: unknown }).action !== 'membership.plan.created' ||
      (auditResult as { targetId?: unknown }).targetId !== plan.planId
    ) {
      return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Membership plan audit was not durably confirmed')
    }
    return w07Response
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) return errorResponse(error.status, error.code, error.message)
    if (error instanceof W08CreatorClientError) return errorResponse(error.status, 'CREATOR_SERVICE_UNAVAILABLE', 'Creator authorization service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Membership plan service unavailable')
  }
}
