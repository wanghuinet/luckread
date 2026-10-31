import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../../../subscription/w07-subscription-client.js'
import { callW08Creator, W08CreatorClientError } from '../../../../../../auth/w08-creator-client.js'
import {
  callW06MembershipPlanUpdateAudit,
  callW06MembershipPlanUpdateRequestAudit,
  W06ModerationClientError,
} from '../../../../../../moderation/w06-moderation-client.js'

type RouteContext = { params: Promise<{ planId: string }> }

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

async function authorizePlanUpdate(request: Request, principalUserId: string): Promise<Response | null> {
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('content-type', 'application/json; charset=utf-8')
  const permissionRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'membership.plan.update.own',
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
    : errorResponse(403, 'PERMISSION_DENIED', 'Creator membership plan update permission required')
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

async function readBoundedBody(request: Request): Promise<unknown | Response> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > 16_384) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Plan update body is too large')
  }
  if (!request.body) return errorResponse(400, 'VALIDATION_FAILED', 'A valid JSON plan body is required')
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
        return errorResponse(400, 'VALIDATION_FAILED', 'Plan update body is too large')
      }
      chunks.push(part.value)
    }
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'A valid JSON plan body is required')
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'A valid JSON plan body is required')
  }
}

function isErrorResponse(value: unknown): value is Response {
  return value instanceof Response
}

function validUpdatedPlan(value: unknown, expectedPlanId: string, expectedCreatorId: string): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const plan = value as Record<string, unknown>
  return plan.planId === expectedPlanId &&
    plan.creatorId === expectedCreatorId &&
    Number.isSafeInteger(plan.planVersion) && Number(plan.planVersion) >= 1 &&
    (plan.status === 'DRAFT' || plan.status === 'ACTIVE' || plan.status === 'PAUSED') &&
    (plan.visibility === 'PRIVATE' || plan.visibility === 'PUBLIC') &&
    Number.isSafeInteger(plan.version) && Number(plan.version) >= 1 &&
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

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { planId } = await context.params
    if (typeof planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(planId)) {
      return errorResponse(404, 'RESOURCE_NOT_FOUND', 'Membership plan not found')
    }
    const ifMatch = request.headers.get('If-Match')
    if (!ifMatch) return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match is required to update a plan')
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
    if (!idempotencyKey) return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key is required to update a plan')
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(idempotencyKey)) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Idempotency-Key is invalid')
    }
    const match = /^"lr-plan-v([1-9]\d*)"$/.exec(ifMatch)
    const expectedVersion = match?.[1] ? Number(match[1]) : Number.NaN
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      return errorResponse(412, 'PRECONDITION_FAILED', 'Membership plan version does not match')
    }
    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal
    const denied = await authorizePlanUpdate(request, principal.userId)
    if (denied) return denied
    const creatorId = await resolveActiveCreatorId(request)
    if (creatorId instanceof Response) return creatorId
    const body = await readBoundedBody(request)
    if (isErrorResponse(body)) return body
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return errorResponse(400, 'VALIDATION_FAILED', 'A valid JSON plan body is required')
    }
    const fields = body as Record<string, unknown>
    const allowedFields = new Set(['name', 'tier', 'billingInterval', 'priceMinor', 'currency', 'benefits', 'trialDays'])
    if (
      Object.keys(fields).some((key) => !allowedFields.has(key)) ||
      !['name', 'tier', 'billingInterval', 'priceMinor', 'currency', 'benefits'].every((key) => Object.hasOwn(fields, key))
    ) return errorResponse(400, 'VALIDATION_FAILED', 'Only plan commercial terms and optional trialDays may be updated')
    if (
      typeof fields.name !== 'string' || fields.name !== fields.name.trim() || fields.name.length < 1 || fields.name.length > 120 ||
      typeof fields.tier !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(fields.tier) ||
      (fields.billingInterval !== 'MONTHLY' && fields.billingInterval !== 'YEARLY') ||
      typeof fields.priceMinor !== 'number' || !Number.isSafeInteger(fields.priceMinor) || fields.priceMinor < 0 || fields.priceMinor > 2_147_483_647 ||
      typeof fields.currency !== 'string' || !/^[A-Z]{3}$/.test(fields.currency) ||
      !Array.isArray(fields.benefits) || fields.benefits.length > 20 ||
      fields.benefits.some((item) => typeof item !== 'string' || item !== item.trim() || item.length < 1 || item.length > 180) ||
      new Set(fields.benefits).size !== fields.benefits.length ||
      JSON.stringify(fields.benefits).length > 8192 ||
      (fields.trialDays !== undefined && (!Number.isSafeInteger(fields.trialDays) || Number(fields.trialDays) < 0 || Number(fields.trialDays) > 90))
    ) return errorResponse(400, 'VALIDATION_FAILED', 'Membership plan terms are invalid')
    const terms = {
      name: fields.name,
      tier: fields.tier,
      billingInterval: fields.billingInterval as 'MONTHLY' | 'YEARLY',
      priceMinor: fields.priceMinor,
      currency: fields.currency,
      benefits: fields.benefits as string[],
      ...(fields.trialDays === undefined ? {} : { trialDays: fields.trialDays as number }),
    }

    const intentEventId = 'evt_mpl_update_requested_' + planId + '_' + idempotencyKey
    let intentResponse: Response
    try {
      intentResponse = await callW06MembershipPlanUpdateRequestAudit({
        request, principal,
        body: { eventId: intentEventId, planId, creatorId, expectedVersion, idempotencyKey, ...terms },
      })
    } catch {
      return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Membership plan update intent could not be durably recorded')
    }
    const intentValue: unknown = await intentResponse.json().catch((): null => null)
    if (
      (intentResponse.status !== 200 && intentResponse.status !== 201) ||
      !intentValue || typeof intentValue !== 'object' ||
      (intentValue as { eventId?: unknown }).eventId !== intentEventId ||
      (intentValue as { action?: unknown }).action !== 'membership.plan.update_requested' ||
      (intentValue as { targetId?: unknown }).targetId !== planId
    ) return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Membership plan update intent was not durably confirmed')

    const w07Response = await callW07Subscription({
      request, pathname: '/membership/plans/' + encodeURIComponent(planId), method: 'PUT',
      principal, verifiedCreatorId: creatorId, body,
    })
    if (!w07Response.ok) return w07Response
    const envelopeValue: unknown = await w07Response.clone().json().catch((): null => null)
    const envelope = envelopeValue && typeof envelopeValue === 'object' && !Array.isArray(envelopeValue)
      ? envelopeValue as { data?: unknown; requestId?: unknown }
      : undefined
    if (
      !envelope ||
      typeof envelope.requestId !== 'string' || envelope.requestId.trim().length < 1 || envelope.requestId.length > 256 ||
      !validUpdatedPlan(envelope.data, planId, creatorId)
    ) return errorResponse(503, 'PLAN_RESPONSE_INVALID', 'Updated membership plan result could not be verified')
    const plan = envelope.data
    if (plan.version === expectedVersion && plan.replayed === true) return w07Response
    let auditResponse: Response
    try {
      auditResponse = await callW06MembershipPlanUpdateAudit({
        request, principal,
        body: {
          eventId: 'evt_mpl_updated_' + planId + '_v' + plan.version,
          planId, creatorId, expectedVersion, planVersion: plan.planVersion as number,
          status: plan.status as 'DRAFT' | 'ACTIVE' | 'PAUSED',
          visibility: plan.visibility as 'PRIVATE' | 'PUBLIC',
          version: plan.version as number, occurredAt: plan.updatedAt as string,
          name: plan.name as string, tier: plan.tier as string,
          billingInterval: plan.billingInterval as 'MONTHLY' | 'YEARLY',
          priceMinor: plan.priceMinor as number, currency: plan.currency as string,
          benefits: plan.benefits as string[],
          trialDays: plan.trialDays as number,
        },
      })
    } catch {
      return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Membership plan update audit service unavailable')
    }
    const auditValue: unknown = await auditResponse.json().catch((): null => null)
    if (
      (auditResponse.status !== 200 && auditResponse.status !== 201) ||
      !auditValue || typeof auditValue !== 'object' ||
      (auditValue as { eventId?: unknown }).eventId !== 'evt_mpl_updated_' + planId + '_v' + plan.version ||
      (auditValue as { action?: unknown }).action !== 'membership.plan.updated' ||
      (auditValue as { targetId?: unknown }).targetId !== planId
    ) return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Membership plan update audit was not durably confirmed')
    return w07Response
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) return errorResponse(error.status, error.code, error.message)
    if (error instanceof W08CreatorClientError) return errorResponse(503, 'CREATOR_SERVICE_UNAVAILABLE', 'Creator authorization service unavailable')
    if (error instanceof W06ModerationClientError) return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Membership audit service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Membership plan update service unavailable')
  }
}
