import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../../../subscription/w07-subscription-client.js'
import { callW08Creator, W08CreatorClientError } from '../../../../../../auth/w08-creator-client.js'
import {
  callW06SubscriptionPlanChangeAudit,
  callW06SubscriptionPlanChangeRequestAudit,
  W06ModerationClientError,
} from '../../../../../../moderation/w06-moderation-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` }, { status, headers: { 'cache-control': 'no-store' } })

type RouteContext = { params: Promise<{ segments?: string[] }> }

type SubscriptionDto = Readonly<{
  subscriptionId: string
  subscriberId: string
  planId: string
  planVersion: number
  creatorId: string | null
  status: string
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelAt: string | null
  version: number
  etag: string
}>

type PlanDto = Readonly<{
  planId: string
  creatorId: string
  planVersion: number
  billingInterval: 'MONTHLY' | 'YEARLY'
  priceMinor: number
  currency: string
}>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseSubscription(value: unknown, subscriptionId: string, subscriberId: string): SubscriptionDto | null {
  if (!isRecord(value)) return null
  const data = value.data
  if (!isRecord(data) || data.subscriptionId !== subscriptionId || data.subscriberId !== subscriberId ||
      typeof data.planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(data.planId) ||
      !Number.isSafeInteger(data.planVersion) || Number(data.planVersion) < 1 ||
      !(data.creatorId === null || (typeof data.creatorId === 'string' && data.creatorId.length > 0)) ||
      typeof data.status !== 'string' ||
      typeof data.currentPeriodStart !== 'string' || Number.isNaN(Date.parse(data.currentPeriodStart)) ||
      typeof data.currentPeriodEnd !== 'string' || Number.isNaN(Date.parse(data.currentPeriodEnd)) ||
      !(data.cancelAt === null || (typeof data.cancelAt === 'string' && !Number.isNaN(Date.parse(data.cancelAt)))) ||
      !Number.isSafeInteger(data.version) || Number(data.version) < 1 ||
      data.etag !== `"lr-v${String(data.version)}"`) return null
  return data as SubscriptionDto
}

function parsePlanList(value: unknown): { docs: PlanDto[]; nextCursor: string | null } | null {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.docs)) return null
  const docs: PlanDto[] = []
  for (const item of value.data.docs) {
    if (!isRecord(item) || typeof item.planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(item.planId) ||
        typeof item.creatorId !== 'string' || !item.creatorId ||
        !Number.isSafeInteger(item.planVersion) || Number(item.planVersion) < 1 ||
        (item.billingInterval !== 'MONTHLY' && item.billingInterval !== 'YEARLY') ||
        !Number.isSafeInteger(item.priceMinor) || Number(item.priceMinor) < 0 ||
        typeof item.currency !== 'string' || !/^[A-Z]{3}$/.test(item.currency)) return null
    docs.push(item as PlanDto)
  }
  const nextCursor = value.data.nextCursor
  if (!(nextCursor === null || typeof nextCursor === 'string')) return null
  return { docs, nextCursor }
}

async function authorizeSubscriptionPlanChange(request: Request, userId: string): Promise<Response | null> {
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('content-type', 'application/json; charset=utf-8')
  const permissionRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'subscription.change_plan',
      resourceType: 'Subscription',
      resourceAttributes: { ownerId: userId },
    }),
  })
  const response = await callW08Creator(permissionRequest, '/internal/authz/check-permission', 'POST')
  if (!response.ok) return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Subscription authorization unavailable')
  const value: unknown = await response.json().catch((): null => null)
  const decision = value && typeof value === 'object'
    ? (value as { data?: { decision?: unknown } }).data?.decision
    : undefined
  if (decision === 'ALLOW') return null
  if (decision === 'DENY') return errorResponse(403, 'PERMISSION_DENIED', 'Subscription plan-change permission required')
  return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Subscription authorization response could not be verified')
}

async function deterministicAuditRequestId(userId: string, subscriptionId: string, idempotencyKey: string): Promise<string> {
  const material = new TextEncoder().encode('subscription-plan-change-request-v1\\u0000' + userId + '\\u0000' + subscriptionId + '\\u0000' + idempotencyKey)
  const digest = await crypto.subtle.digest('SHA-256', material)
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return 'evt_sub_plan_change_request_' + hex.slice(0, 26)
}

async function findPublicTargetPlan(
  request: Request,
  principal: Awaited<ReturnType<typeof resolveCookieSubscriptionPrincipal>> extends infer P ? Exclude<P, Response> : never,
  targetPlanId: string,
): Promise<PlanDto | Response | null> {
  let cursor: string | null = null
  for (let page = 0; page < 20; page += 1) {
    const pathname = '/plans?limit=50' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')
    const response = await callW07Subscription({ request, pathname, method: 'GET', principal })
    if (!response.ok) return response
    const value: unknown = await response.json().catch((): null => null)
    const parsed = parsePlanList(value)
    if (!parsed) return errorResponse(503, 'PLAN_RESPONSE_INVALID', 'Membership plan catalog response could not be verified')
    const match = parsed.docs.find((plan) => plan.planId === targetPlanId)
    if (match) return match
    if (!parsed.nextCursor) return null
    cursor = parsed.nextCursor
  }
  return errorResponse(503, 'PLAN_CATALOG_LIMIT', 'Membership plan could not be resolved within the bounded catalog scan')
}

const resolveOperation = (method: string, segments: string[] | undefined): { pathname: string; body?: unknown } | Response | null => {
  const parts = segments ?? []
  if (parts.length === 0 && method === 'GET') return { pathname: '/memberships/subscriptions' }
  if (parts.length === 0 && method === 'POST') return { pathname: '/memberships/subscriptions' }
  if (parts.length === 1 && method === 'GET') return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) }
  if (parts.length === 2 && method === 'POST' && ['cancel', 'pause', 'resume'].includes(parts[1]!)) {
    return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) + '/' + parts[1]! }
  }
  if (parts.length === 2 && method === 'POST' && parts[1] === 'change-plan') return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) + '/change-plan' }
  return null
}


async function forward(request: Request, context: RouteContext): Promise<Response> {
  try {
    const params = await context.params
    const operation = resolveOperation(request.method, params.segments)
    if (!operation) return new Response(null, { status: 404 })
    if (operation instanceof Response) return operation
    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal

    if (request.method === 'POST' && (params.segments ?? []).length === 2 && params.segments?.[1] === 'change-plan') {
      const subscriptionId = params.segments?.[0] ?? ''
      if (!/^sub_[A-Za-z0-9_-]{1,128}$/.test(subscriptionId)) {
        return errorResponse(404, 'RESOURCE_NOT_FOUND', 'Subscription not found')
      }
      const denied = await authorizeSubscriptionPlanChange(request, principal.userId)
      if (denied) return denied

      const idempotencyKey = request.headers.get('Idempotency-Key') ?? ''
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(idempotencyKey)) {
        return errorResponse(428, 'PRECONDITION_REQUIRED', 'A valid Idempotency-Key is required')
      }
      const ifMatch = request.headers.get('If-Match') ?? ''
      const versionMatch = /^"lr-v([1-9]\\d*)"$/.exec(ifMatch)
      const expectedVersion = versionMatch?.[1] ? Number(versionMatch[1]) : Number.NaN
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
        return errorResponse(ifMatch ? 412 : 428, ifMatch ? 'PRECONDITION_FAILED' : 'PRECONDITION_REQUIRED', 'A valid If-Match subscription version is required')
      }

      let inputValue: unknown
      try { inputValue = await request.json() as unknown } catch { return errorResponse(400, 'VALIDATION_FAILED', 'A valid JSON body is required') }
      if (!isRecord(inputValue) || Object.keys(inputValue).length !== 1 ||
          typeof inputValue.planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(inputValue.planId)) {
        return errorResponse(400, 'VALIDATION_FAILED', 'Only a valid planId may be supplied')
      }
      const targetPlanId = inputValue.planId

      const currentResponse = await callW07Subscription({
        request, pathname: '/memberships/subscriptions/' + encodeURIComponent(subscriptionId),
        method: 'GET', principal,
      })
      if (!currentResponse.ok) return currentResponse
      const currentEnvelope: unknown = await currentResponse.json().catch((): null => null)
      const current = parseSubscription(currentEnvelope, subscriptionId, principal.userId)
      if (!current) return errorResponse(503, 'SUBSCRIPTION_RESPONSE_INVALID', 'Subscription response could not be verified')
      if (current.version !== expectedVersion) return errorResponse(412, 'PRECONDITION_FAILED', 'Subscription version does not match')
      if (current.status !== 'ACTIVE' || current.cancelAt !== null || Date.parse(current.currentPeriodEnd) <= Date.now()) {
        return errorResponse(409, 'INVALID_STATE', 'Only an active, uncanceled subscription can schedule a plan change')
      }
      if (!current.creatorId) return errorResponse(409, 'INVALID_STATE', 'Platform subscriptions cannot change creator plans')

      const targetResult = await findPublicTargetPlan(request, principal, targetPlanId)
      if (targetResult instanceof Response) return targetResult
      if (!targetResult || targetResult.creatorId !== current.creatorId) {
        return errorResponse(409, 'PLAN_NOT_ACTIVE', 'Target plan is unavailable for this subscription')
      }
      if (targetResult.currency !== 'USD' && targetResult.currency !== 'CAD' && targetResult.currency !== currentPlanCurrency(currentEnvelope)) {
        return errorResponse(409, 'CONFLICT', 'Target plan currency does not match the current subscription')
      }

      const currentPlanResult = await findPublicTargetPlan(request, principal, current.planId)
      if (currentPlanResult instanceof Response) return currentPlanResult
      if (!currentPlanResult || currentPlanResult.creatorId !== current.creatorId ||
          currentPlanResult.planVersion !== current.planVersion) {
        return errorResponse(503, 'SUBSCRIPTION_PLAN_SNAPSHOT_INVALID', 'Current subscription plan snapshot could not be verified')
      }
      if (targetResult.currency !== currentPlanResult.currency) {
        return errorResponse(409, 'CONFLICT', 'Target plan currency does not match the current subscription')
      }
      if (targetResult.planId === currentPlanResult.planId && targetResult.planVersion === currentPlanResult.planVersion) {
        return errorResponse(409, 'INVALID_STATE', 'Subscription already uses this plan version')
      }
      let changeType: 'DOWNGRADE' | 'BILLING_INTERVAL_CHANGE' | 'SAME_PRICE_CHANGE'
      if (targetResult.billingInterval !== currentPlanResult.billingInterval) {
        changeType = 'BILLING_INTERVAL_CHANGE'
      } else if (targetResult.priceMinor < currentPlanResult.priceMinor) {
        changeType = 'DOWNGRADE'
      } else if (targetResult.priceMinor === currentPlanResult.priceMinor) {
        changeType = 'SAME_PRICE_CHANGE'
      } else {
        return errorResponse(409, 'PAYMENT_REQUIRED', 'Plan upgrades require the immediate proration payment flow')
      }

      const requestEventId = await deterministicAuditRequestId(principal.userId, subscriptionId, idempotencyKey)
      let requestAudit: Response
      try {
        requestAudit = await callW06SubscriptionPlanChangeRequestAudit({
          request, principal,
          body: {
            eventId: requestEventId,
            subscriptionId,
            sourcePlanId: current.planId,
            sourcePlanVersion: current.planVersion,
            targetPlanId: targetResult.planId,
            targetPlanVersion: targetResult.planVersion,
            changeType,
            effectiveAt: current.currentPeriodEnd,
            expectedVersion,
            idempotencyKey,
          },
        })
      } catch {
        return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Subscription plan-change intent could not be durably recorded')
      }
      const requestAuditValue: unknown = await requestAudit.json().catch((): null => null)
      if ((requestAudit.status !== 200 && requestAudit.status !== 201) ||
          !isRecord(requestAuditValue) ||
          requestAuditValue.eventId !== requestEventId ||
          requestAuditValue.action !== 'membership.subscription.plan_change_requested' ||
          requestAuditValue.targetId !== subscriptionId) {
        return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Subscription plan-change intent was not durably confirmed')
      }

      const w07Response = await callW07Subscription({
        request,
        pathname: '/memberships/subscriptions/' + encodeURIComponent(subscriptionId) + '/change-plan',
        method: 'POST',
        principal,
        body: { planId: targetPlanId },
      })
      if (!w07Response.ok) return w07Response
      const envelopeValue: unknown = await w07Response.clone().json().catch((): null => null)
      if (!isRecord(envelopeValue) || typeof envelopeValue.requestId !== 'string' ||
          !isRecord(envelopeValue.data)) {
        return errorResponse(503, 'PLAN_CHANGE_RESPONSE_INVALID', 'Scheduled plan-change result could not be verified')
      }
      const data = envelopeValue.data
      if (data.subscriptionId !== subscriptionId ||
          data.sourcePlanId !== current.planId || data.sourcePlanVersion !== current.planVersion ||
          data.targetPlanId !== targetResult.planId || data.targetPlanVersion !== targetResult.planVersion ||
          data.changeType !== changeType || data.status !== 'SCHEDULED' ||
          typeof data.changeId !== 'string' || !/^spc_[A-Za-z0-9]{26}$/.test(data.changeId) ||
          data.effectiveAt !== current.currentPeriodEnd ||
          !Number.isSafeInteger(data.version) || Number(data.version) < 1 ||
          !Number.isSafeInteger(data.subscriptionVersion) || Number(data.subscriptionVersion) !== expectedVersion + 1 ||
          data.etag !== `"lr-v${String(data.subscriptionVersion)}"` ||
          typeof data.replayed !== 'boolean' ||
          typeof data.createdAt !== 'string' || Number.isNaN(Date.parse(data.createdAt)) ||
          typeof data.updatedAt !== 'string' || Number.isNaN(Date.parse(data.updatedAt))) {
        return errorResponse(503, 'PLAN_CHANGE_RESPONSE_INVALID', 'Scheduled plan-change result could not be verified')
      }
      const finalEventId = 'evt_subscription_plan_change_scheduled_' + data.changeId
      let finalAudit: Response
      try {
        finalAudit = await callW06SubscriptionPlanChangeAudit({
          request, principal,
          body: {
            eventId: finalEventId,
            changeId: data.changeId,
            subscriptionId,
            sourcePlanId: current.planId,
            sourcePlanVersion: current.planVersion,
            targetPlanId: targetResult.planId,
            targetPlanVersion: targetResult.planVersion,
            changeType,
            effectiveAt: current.currentPeriodEnd,
            changeVersion: Number(data.version),
            subscriptionVersion: Number(data.subscriptionVersion),
            occurredAt: data.updatedAt,
          },
        })
      } catch {
        return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Scheduled plan-change audit service unavailable')
      }
      const finalAuditValue: unknown = await finalAudit.json().catch((): null => null)
      if ((finalAudit.status !== 200 && finalAudit.status !== 201) ||
          !isRecord(finalAuditValue) ||
          finalAuditValue.eventId !== finalEventId ||
          finalAuditValue.action !== 'membership.subscription.plan_change_scheduled' ||
          finalAuditValue.targetId !== subscriptionId) {
        return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Scheduled plan-change audit was not durably confirmed')
      }
      return w07Response
    }
    if (request.method === 'POST') {
      return errorResponse(
        503,
        'SERVICE_UNAVAILABLE',
        'Subscription writes are disabled until a verified payment-provider synchronization flow is available.',
      )
    }
    const pathname = request.method === 'GET' && (params.segments ?? []).length === 0
      ? operation.pathname + new URL(request.url).search
      : operation.pathname
    return await callW07Subscription({ request, pathname, method: 'GET', principal })
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Subscription service unavailable')
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> { return forward(request, context) }
export async function POST(request: Request, context: RouteContext): Promise<Response> { return forward(request, context) }
