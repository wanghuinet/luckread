import type { ContentPrincipal } from '../../../../../../content/w03-content-client.js'
import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../../../subscription/w07-subscription-client.js'
import { callW08Creator, W08CreatorClientError } from '../../../../../../auth/w08-creator-client.js'
import {
  callW06SubscriptionMutationAppliedAudit,
  callW06SubscriptionMutationRequestAudit,
  W06ModerationClientError,
} from '../../../../../../moderation/w06-moderation-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` }, { status, headers: { 'cache-control': 'no-store' } })

type RouteContext = { params: Promise<{ segments?: string[] }> }
type SubscriptionMutation = 'cancel' | 'pause' | 'resume'
type SubscriptionStatus = 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELED' | 'EXPIRED'
type SubscriptionDto = {
  subscriptionId: string
  subscriberId: string
  planId: string
  planVersion: number
  status: SubscriptionStatus
  version: number
  etag: string
  updatedAt: string
}

const resolveOperation = (method: string, segments: string[] | undefined): { pathname: string } | null => {
  const parts = segments ?? []
  if (parts.length === 0 && method === 'GET') return { pathname: '/memberships/subscriptions' }
  if (parts.length === 0 && method === 'POST') return { pathname: '/memberships/subscriptions' }
  if (parts.length === 1 && method === 'GET') return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) }
  if (parts.length === 2 && method === 'POST' && ['cancel', 'pause', 'resume', 'change-plan'].includes(parts[1]!)) {
    return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) + '/' + parts[1]! }
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSubscriptionDto(value: unknown, expectedSubscriptionId: string, expectedSubscriberId: string): SubscriptionDto | null {
  if (!isRecord(value) || !isRecord(value.data)) return null
  const data = value.data
  if (
    data.subscriptionId !== expectedSubscriptionId ||
    data.subscriberId !== expectedSubscriberId ||
    typeof data.planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(data.planId) ||
    typeof data.planVersion !== 'number' || !Number.isSafeInteger(data.planVersion) || data.planVersion < 1 ||
    !['PENDING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELED', 'EXPIRED'].includes(String(data.status)) ||
    typeof data.version !== 'number' || !Number.isSafeInteger(data.version) || data.version < 1 ||
    data.etag !== `"lr-v${String(data.version)}"` ||
    typeof data.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt)) ||
    new Date(data.updatedAt).toISOString() !== data.updatedAt
  ) return null
  return data as SubscriptionDto
}

async function authorizeSubscriptionMutation(request: Request, action: SubscriptionMutation, subscriberId: string): Promise<Response | null> {
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('content-type', 'application/json; charset=utf-8')
  const permissionRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'subscription.' + action,
      resourceType: 'Subscription',
      resourceAttributes: { ownerId: subscriberId },
    }),
  })
  const response = await callW08Creator(permissionRequest, '/internal/authz/check-permission', 'POST')
  if (!response.ok) return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Subscription authorization unavailable')
  const value: unknown = await response.json().catch((): null => null)
  const decision = isRecord(value) && isRecord(value.data) ? value.data.decision : undefined
  return decision === 'ALLOW'
    ? null
    : errorResponse(403, 'PERMISSION_DENIED', 'Subscriber-owned subscription permission required')
}

async function mutationDigest(userId: string, subscriptionId: string, idempotencyKey: string): Promise<string> {
  const material = new TextEncoder().encode(userId + '\\0' + subscriptionId + '\\0' + idempotencyKey)
  const digest = await crypto.subtle.digest('SHA-256', material)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function targetStatus(action: SubscriptionMutation): 'CANCELED' | 'PAUSED' | 'ACTIVE' {
  return action === 'cancel' ? 'CANCELED' : action === 'pause' ? 'PAUSED' : 'ACTIVE'
}

function auditAction(action: SubscriptionMutation): string {
  return action === 'cancel' ? 'membership.subscription.canceled'
    : action === 'pause' ? 'membership.subscription.paused'
      : 'membership.subscription.resumed'
}

async function mutateSubscription(request: Request, principal: ContentPrincipal,
  subscriptionId: string, action: SubscriptionMutation): Promise<Response> {
  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!idempotencyKey) return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key is required')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(idempotencyKey)) return errorResponse(400, 'VALIDATION_FAILED', 'Idempotency-Key is invalid')
  const ifMatch = request.headers.get('If-Match')?.trim() ?? ''
  const versionMatch = /^"lr-v([1-9][0-9]*)"$/.exec(ifMatch)
  const expectedVersion = versionMatch?.[1] ? Number(versionMatch[1]) : Number.NaN
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return errorResponse(ifMatch ? 412 : 428, ifMatch ? 'PRECONDITION_FAILED' : 'PRECONDITION_REQUIRED', 'A valid If-Match subscription version is required')
  }
  if (request.body !== null) {
    await request.body.cancel().catch(() => undefined)
    return errorResponse(400, 'VALIDATION_FAILED', 'Subscription lifecycle commands do not accept a request body')
  }

  const currentResponse = await callW07Subscription({
    request,
    pathname: '/memberships/subscriptions/' + encodeURIComponent(subscriptionId),
    method: 'GET',
    principal,
  })
  if (!currentResponse.ok) return currentResponse
  const currentEnvelope: unknown = await currentResponse.clone().json().catch((): null => null)
  const current = parseSubscriptionDto(currentEnvelope, subscriptionId, principal.userId)
  if (!current) return errorResponse(503, 'SUBSCRIPTION_RESPONSE_INVALID', 'Subscription ownership or state could not be verified')

  const denied = await authorizeSubscriptionMutation(request, action, principal.userId)
  if (denied) return denied

  const digest = await mutationDigest(principal.userId, subscriptionId, idempotencyKey)
  const intentEventId = 'evt_sub_mutation_requested_' + digest
  let intentResponse: Response
  try {
    intentResponse = await callW06SubscriptionMutationRequestAudit({
      request,
      principal,
      body: {
        eventId: intentEventId,
        subscriptionId,
        idempotencyKey,
        expectedVersion,
        observedVersion: current.version,
        operation: action,
        beforeStatus: current.status as 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELED',
        beforePlanId: current.planId,
        beforePlanVersion: current.planVersion,
      },
    })
  } catch {
    return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Subscription mutation intent could not be durably recorded')
  }
  const intentValue: unknown = await intentResponse.clone().json().catch((): null => null)
  if (!intentResponse.ok) {
    const internalCode = isRecord(intentValue) && typeof intentValue.error === 'string'
      ? intentValue.error
      : ''
    if (intentResponse.status === 412 || internalCode === 'PRECONDITION_FAILED') {
      return errorResponse(412, 'PRECONDITION_FAILED', 'Subscription version changed; refresh and try again')
    }
    if (intentResponse.status === 409 || internalCode === 'INVALID_STATE') {
      return errorResponse(409, 'INVALID_STATE', 'This subscription cannot perform that lifecycle transition')
    }
    if (intentResponse.status === 400 || internalCode === 'IDEMPOTENCY_KEY_MISMATCH') {
      return errorResponse(400, 'VALIDATION_FAILED', 'Subscription mutation request is invalid')
    }
    return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Subscription mutation intent could not be durably confirmed')
  }
  if (
    (intentResponse.status !== 200 && intentResponse.status !== 201) ||
    !isRecord(intentValue) || !isRecord(intentValue.data) ||
    intentValue.data.eventId !== intentEventId ||
    intentValue.data.action !== 'membership.subscription.' + action + '_requested' ||
    intentValue.data.targetId !== subscriptionId ||
    !isRecord(intentValue.data.before) || !isRecord(intentValue.data.after) ||
    intentValue.data.after.operation !== action ||
    intentValue.data.after.idempotencyKey !== idempotencyKey ||
    intentValue.data.after.expectedVersion !== expectedVersion ||
    intentValue.data.before.version !== expectedVersion ||
    typeof intentValue.data.before.planId !== 'string' ||
    typeof intentValue.data.before.planVersion !== 'number' ||
    typeof intentValue.data.before.status !== 'string'
  ) return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Subscription mutation intent was not durably confirmed')
  const before = intentValue.data.before

  const w07Response = await callW07Subscription({
    request,
    pathname: '/memberships/subscriptions/' + encodeURIComponent(subscriptionId) + '/' + action,
    method: 'POST',
    principal,
  })
  if (!w07Response.ok) return w07Response
  const updatedEnvelope: unknown = await w07Response.clone().json().catch((): null => null)
  const updated = parseSubscriptionDto(updatedEnvelope, subscriptionId, principal.userId)
  if (
    !updated ||
    updated.status !== targetStatus(action) ||
    updated.version < expectedVersion + 1 ||
    updated.planId !== before.planId ||
    updated.planVersion !== before.planVersion
  ) return errorResponse(503, 'SUBSCRIPTION_RESPONSE_INVALID', 'Subscription transition result could not be verified')

  const finalEventId = 'evt_sub_mutation_applied_' + digest
  let finalAudit: Response
  try {
    finalAudit = await callW06SubscriptionMutationAppliedAudit({
      request,
      principal,
      body: {
        eventId: finalEventId,
        intentEventId,
        subscriptionId,
        idempotencyKey,
        expectedVersion,
        operation: action,
        status: updated.status as 'ACTIVE' | 'PAUSED' | 'CANCELED',
        version: updated.version,
        planId: updated.planId,
        planVersion: updated.planVersion,
        updatedAt: updated.updatedAt,
      },
    })
  } catch {
    return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Subscription mutation was applied but its final audit could not be confirmed')
  }
  const finalValue: unknown = await finalAudit.clone().json().catch((): null => null)
  if (
    (finalAudit.status !== 200 && finalAudit.status !== 201) ||
    !isRecord(finalValue) ||
    finalValue.eventId !== finalEventId ||
    finalValue.action !== auditAction(action) ||
    finalValue.targetId !== subscriptionId
  ) return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Subscription mutation final audit was not durably confirmed')
  return w07Response
}

async function forward(request: Request, context: RouteContext): Promise<Response> {
  try {
    const params = await context.params
    const operation = resolveOperation(request.method, params.segments)
    if (!operation) return new Response(null, { status: 404 })
    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal

    if (request.method === 'POST') {
      const parts = params.segments ?? []
      if (parts.length === 2 && ['cancel', 'pause', 'resume'].includes(parts[1]!)) {
        const subscriptionId = parts[0]!
        if (!/^sub_[A-Za-z0-9_-]{1,128}$/.test(subscriptionId)) return errorResponse(404, 'RESOURCE_NOT_FOUND', 'Subscription not found')
        return await mutateSubscription(request, principal, subscriptionId, parts[1] as SubscriptionMutation)
      }
      return errorResponse(
        503,
        'SERVICE_UNAVAILABLE',
        parts[1] === 'change-plan'
          ? 'Plan changes remain unavailable until price proration and payment synchronization are implemented.'
          : 'Subscription creation must go through the paid commerce checkout flow.',
      )
    }
    const pathname = (params.segments ?? []).length === 0
      ? operation.pathname + new URL(request.url).search
      : operation.pathname
    return await callW07Subscription({ request, pathname, method: 'GET', principal })
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) return errorResponse(error.status, error.code, error.message)
    if (error instanceof W08CreatorClientError) return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Subscription authorization unavailable')
    if (error instanceof W06ModerationClientError) return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Subscription audit service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Subscription service unavailable')
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> { return forward(request, context) }
export async function POST(request: Request, context: RouteContext): Promise<Response> { return forward(request, context) }
