import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../../../subscription/w07-subscription-client.js'
import type { ContentPrincipal } from '../../../../../../content/w03-content-client.js'
import { callW08Creator, W08CreatorClientError } from '../../../../../../auth/w08-creator-client.js'
import {
  callW06SubscriptionPlanChangeAudit,
  callW06SubscriptionPlanChangeRequestAudit,
  W06ModerationClientError,
} from '../../../../../../moderation/w06-moderation-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` }, { status, headers: { 'cache-control': 'no-store' } })

type RouteContext = { params: Promise<{ segments?: string[] }> }

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

async function readBoundedJson(request: Request): Promise<unknown | Response> {
  const declared = request.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 16_384)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Request body is too large or malformed')
  }
  if (!request.body) return errorResponse(400, 'VALIDATION_FAILED', 'A JSON request body is required')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > 16_384) {
        await reader.cancel()
        return errorResponse(400, 'VALIDATION_FAILED', 'Request body is too large')
      }
      chunks.push(part.value)
    }
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'A valid JSON request body is required')
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'A valid JSON request body is required')
  }
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
  const material = new TextEncoder().encode(
    'subscription-plan-change-request-v1\u0000' + userId + '\u0000' + subscriptionId + '\u0000' + idempotencyKey,
  )
  const digest = await crypto.subtle.digest('SHA-256', material)
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return 'evt_sub_plan_change_request_' + hex.slice(0, 26)
}

function validScheduledPlanChangeEnvelope(
  value: unknown,
  subscriptionId: string,
  targetPlanId: string,
): value is Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.data) ||
      typeof value.requestId !== 'string' || !/^req_[A-Za-z0-9_-]{1,123}$/.test(value.requestId)) return false
  const data = value.data
  return data.subscriptionId === subscriptionId &&
    typeof data.changeId === 'string' && /^spc_[A-Za-z0-9]{26}$/.test(data.changeId) &&
    typeof data.sourcePlanId === 'string' && /^plan_[a-f0-9]{64}$/.test(data.sourcePlanId) &&
    Number.isSafeInteger(data.sourcePlanVersion) && Number(data.sourcePlanVersion) >= 1 &&
    data.targetPlanId === targetPlanId &&
    Number.isSafeInteger(data.targetPlanVersion) && Number(data.targetPlanVersion) >= 1 &&
    ['DOWNGRADE', 'BILLING_INTERVAL_CHANGE', 'SAME_PRICE_CHANGE'].includes(String(data.changeType)) &&
    ['SCHEDULED', 'APPLIED', 'CANCELED'].includes(String(data.status)) &&
    typeof data.effectiveAt === 'string' && !Number.isNaN(Date.parse(data.effectiveAt)) &&
    Number.isSafeInteger(data.version) && Number(data.version) >= 1 &&
    Number.isSafeInteger(data.subscriptionVersion) && Number(data.subscriptionVersion) >= 2 &&
    data.etag === `"lr-v${String(data.subscriptionVersion)}"` &&
    typeof data.replayed === 'boolean' &&
    typeof data.createdAt === 'string' && !Number.isNaN(Date.parse(data.createdAt)) &&
    typeof data.updatedAt === 'string' && !Number.isNaN(Date.parse(data.updatedAt))
}

async function forward(request: Request, context: RouteContext): Promise<Response> {
  try {
    const params = await context.params
    const operation = resolveOperation(request.method, params.segments)
    if (!operation) return new Response(null, { status: 404 })
    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal

    const parts = params.segments ?? []
    const isPlanChangeRequest = request.method === 'POST' && parts.length === 2 && parts[1] === 'change-plan'
    if (isPlanChangeRequest) {
      const subscriptionId = parts[0] ?? ''
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
      const versionMatch = /^"lr-v([1-9]\d*)"$/.exec(ifMatch)
      const expectedVersion = versionMatch?.[1] ? Number(versionMatch[1]) : Number.NaN
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
        return errorResponse(ifMatch ? 412 : 428, ifMatch ? 'PRECONDITION_FAILED' : 'PRECONDITION_REQUIRED', 'A valid If-Match subscription version is required')
      }
      const input = await readBoundedJson(request)
      if (input instanceof Response) return input
      if (!isRecord(input) || Object.keys(input).length !== 1 ||
          typeof input.planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(input.planId)) {
        return errorResponse(400, 'VALIDATION_FAILED', 'Only a valid planId may be supplied')
      }
      const targetPlanId = input.planId
      const requestEventId = await deterministicAuditRequestId(principal.userId, subscriptionId, idempotencyKey)

      let requestAudit: Response
      try {
        requestAudit = await callW06SubscriptionPlanChangeRequestAudit({
          request,
          principal: principal as ContentPrincipal,
          body: { eventId: requestEventId, subscriptionId, targetPlanId, expectedVersion, idempotencyKey },
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
        pathname: operation.pathname,
        method: 'POST',
        principal,
        body: { planId: targetPlanId },
      })
      if (!w07Response.ok) return w07Response
      const envelopeValue: unknown = await w07Response.clone().json().catch((): null => null)
      if (!validScheduledPlanChangeEnvelope(envelopeValue, subscriptionId, targetPlanId)) {
        return errorResponse(503, 'PLAN_CHANGE_RESPONSE_INVALID', 'Scheduled plan-change result could not be verified')
      }
      const data = envelopeValue.data as Record<string, unknown>
      const finalEventId = 'evt_subscription_plan_change_scheduled_' + String(data.changeId)
      let finalAudit: Response
      try {
        finalAudit = await callW06SubscriptionPlanChangeAudit({
          request,
          principal: principal as ContentPrincipal,
          body: {
            eventId: finalEventId,
            changeId: String(data.changeId),
            subscriptionId,
            sourcePlanId: String(data.sourcePlanId),
            sourcePlanVersion: Number(data.sourcePlanVersion),
            targetPlanId,
            targetPlanVersion: Number(data.targetPlanVersion),
            changeType: data.changeType as 'DOWNGRADE' | 'BILLING_INTERVAL_CHANGE' | 'SAME_PRICE_CHANGE',
            effectiveAt: String(data.effectiveAt),
            changeVersion: 1,
            subscriptionVersion: expectedVersion + 1,
            occurredAt: String(data.createdAt),
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
    const pathname = request.method === 'GET' && parts.length === 0
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
