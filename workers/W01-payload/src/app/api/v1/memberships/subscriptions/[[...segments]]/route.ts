import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../../../subscription/w07-subscription-client.js'
import { callW08Creator, W08CreatorClientError } from '../../../../../../auth/w08-creator-client.js'
import { callW06SubscriptionPlanChangeRequestAudit } from '../../../../../../moderation/w06-moderation-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` }, { status, headers: { 'cache-control': 'no-store' } })

type RouteContext = { params: Promise<{ segments?: string[] }> }

const resolveOperation = (method: string, segments: string[] | undefined): { pathname: string; body?: unknown } | Response | null => {
  const parts = segments ?? []
  if (parts.length === 0 && method === 'GET') return { pathname: '/memberships/subscriptions' }
  if (parts.length === 0 && method === 'POST') return { pathname: '/memberships/subscriptions' }
  if (parts.length === 1 && method === 'GET') return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) }
  if (parts.length === 2 && method === 'GET' && parts[1] === 'change-plan-preview') return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) + '/change-plan-preview' }
  if (parts.length === 2 && method === 'POST' && ['cancel', 'pause', 'resume'].includes(parts[1]!)) {
    return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) + '/' + parts[1]! }
  }
  if (parts.length === 2 && method === 'POST' && parts[1] === 'change-plan') return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) + '/change-plan' }
  if (parts.length === 3 && method === 'POST' && parts[1] === 'change-plan' && parts[2] === 'checkout') return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) + '/change-plan/checkout' }
  return null
}


async function readBoundedJson(request: Request): Promise<unknown | Response> {
  const contentType = request.headers.get('content-type') ?? ''
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    return errorResponse(400, 'VALIDATION_FAILED', 'A JSON request body is required')
  }
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null) {
    const hasNonDigit = Array.from(declaredLength).some((character) => character < '0' || character > '9')
    const length = Number(declaredLength)
    if (!declaredLength || hasNonDigit || !Number.isSafeInteger(length) || length > 16_384) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Request body is too large or malformed')
    }
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

const PLAN_ID_PATTERN = /^plan_[a-f0-9]{64}$/

async function authorizeSubscriptionPlanChange(
  request: Request,
  principalUserId: string,
  subscriptionId: string,
): Promise<Response | null> {
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
      resourceAttributes: { ownerId: principalUserId, subscriptionId },
    }),
  })
  const response = await callW08Creator(permissionRequest, '/internal/authz/check-permission', 'POST')
  if (!response.ok) return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Subscription authorization unavailable')
  const value: unknown = await response.json().catch((): null => null)
  const decision = value && typeof value === 'object'
    ? (value as { decision?: unknown; data?: { decision?: unknown } }).data?.decision ??
      (value as { decision?: unknown }).decision
    : undefined
  if (decision === 'ALLOW') return null
  if (decision === 'DENY') return errorResponse(403, 'PERMISSION_DENIED', 'Subscription plan change permission required')
  return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Subscription authorization response could not be verified')
}

async function subscriptionPlanUpgradeAttemptId(subscriberId: string, idempotencyKey: string): Promise<string> {
  const payload = new TextEncoder().encode(
    'membership-plan-upgrade-v1\u0000' + subscriberId + '\u0000' + idempotencyKey,
  )
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', payload))
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return 'suca_' + hex
}

async function auditSubscriptionPlanUpgradeRequest(
  request: Request,
  principal: Parameters<typeof callW06SubscriptionPlanChangeRequestAudit>[0]['principal'],
  subscriptionId: string,
  targetPlanId: string,
  expectedEtag: string,
  attemptId: string,
): Promise<Response | null> {
  let response: Response
  try {
    response = await callW06SubscriptionPlanChangeRequestAudit({
      request,
      principal,
      body: {
        eventId: 'evt_subscription_plan_upgrade_requested_' + attemptId,
        attemptId,
        subscriberId: principal.userId,
        subscriptionId,
        targetPlanId,
        expectedEtag,
        requestedAt: new Date().toISOString(),
      },
    })
  } catch {
    return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Subscription plan change request could not be durably audited')
  }
  const value: unknown = await response.json().catch((): null => null)
  if (response.status === 409) {
    return errorResponse(409, 'CONFLICT', 'Idempotency key conflicts with an existing subscription upgrade request')
  }
  const result = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { eventId?: unknown; action?: unknown; targetType?: unknown; targetId?: unknown }
    : null
  if ((response.status !== 200 && response.status !== 201) ||
      result?.eventId !== 'evt_subscription_plan_upgrade_requested_' + attemptId ||
      result.action !== 'subscription.plan_upgrade.requested' ||
      result.targetType !== 'Subscription' || result.targetId !== subscriptionId) {
    return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Subscription plan change intent was not durably confirmed')
  }
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

    const parts = params.segments ?? []
    const isPlanUpgradeCheckout = request.method === 'POST' && parts.length === 3 &&
      parts[1] === 'change-plan' && parts[2] === 'checkout'
    if (request.method === 'POST') {
      if (!isPlanUpgradeCheckout) {
        return errorResponse(
          503,
          'SERVICE_UNAVAILABLE',
          'Subscription writes are disabled until a verified payment-provider synchronization flow is available.',
        )
      }
      const body = await readBoundedJson(request)
      if (body instanceof Response) return body
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).length !== 1 || !Object.hasOwn(body, 'planId') ||
          typeof (body as Record<string, unknown>).planId !== 'string' ||
          !PLAN_ID_PATTERN.test((body as Record<string, unknown>).planId as string)) {
        return errorResponse(400, 'VALIDATION_FAILED', 'A valid target planId is required')
      }
      const idempotencyKey = request.headers.get('Idempotency-Key')
      if (!idempotencyKey) return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key is required')
      if (idempotencyKey.length > 256 || idempotencyKey.trim() !== idempotencyKey ||
          /[\u0000-\u001f\u007f]/.test(idempotencyKey)) {
        return errorResponse(400, 'VALIDATION_FAILED', 'Idempotency-Key is invalid')
      }
      const expectedEtag = request.headers.get('If-Match')
      if (!expectedEtag) return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match is required')
      if (!/^"lr-v([1-9]\d*)"$/.test(expectedEtag)) {
        return errorResponse(412, 'PRECONDITION_FAILED', 'Subscription version does not match')
      }
      const denied = await authorizeSubscriptionPlanChange(request, principal.userId, parts[0]!)
      if (denied) return denied
      const attemptId = await subscriptionPlanUpgradeAttemptId(principal.userId, idempotencyKey)
      const auditDenied = await auditSubscriptionPlanUpgradeRequest(
        request, principal, parts[0]!, (body as { planId: string }).planId, expectedEtag, attemptId,
      )
      if (auditDenied) return auditDenied
      return await callW07Subscription({
        request,
        pathname: operation.pathname,
        method: 'POST',
        principal,
        body,
      })
    }
    const isSubscriptionList = (params.segments ?? []).length === 0
    const isPlanChangePreview = (params.segments ?? []).length === 2 && params.segments?.[1] === 'change-plan-preview'
    const pathname = request.method === 'GET' && (isSubscriptionList || isPlanChangePreview)
      ? operation.pathname + new URL(request.url).search
      : operation.pathname
    return await callW07Subscription({ request, pathname, method: 'GET', principal })
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) return errorResponse(error.status, error.code, error.message)
    if (error instanceof W08CreatorClientError) return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Subscription authorization unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Subscription service unavailable')
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> { return forward(request, context) }
export async function POST(request: Request, context: RouteContext): Promise<Response> { return forward(request, context) }
