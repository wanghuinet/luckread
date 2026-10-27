import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../../subscription/w07-subscription-client.js'
import { callW08Creator, W08CreatorClientError } from '../../../../../auth/w08-creator-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

async function authorizePlanPermission(
  request: Request,
  principalUserId: string,
  action: 'membership.plan.create.own' | 'membership.plan.read.own',
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
  const value: unknown = await response.json().catch(() => null)
  if (!value || typeof value !== 'object' || (value as { decision?: unknown }).decision !== 'ALLOW') {
    return errorResponse(403, 'PERMISSION_DENIED', 'Creator membership plan permission required')
  }
  return null
}

async function resolveActiveCreatorId(request: Request): Promise<string | Response> {
  const response = await callW08Creator(request, '/internal/creator/self', 'GET')
  if (!response.ok) return response
  const value: unknown = await response.json().catch(() => null)
  const creatorId = value && typeof value === 'object'
    ? (value as { data?: { creatorId?: unknown } }).data?.creatorId
    : null
  if (typeof creatorId !== 'string' || !creatorId.trim() || creatorId.length > 256) {
    return errorResponse(503, 'CREATOR_IDENTITY_UNAVAILABLE', 'Creator identity unavailable')
  }
  return creatorId
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
    const declaredLength = Number(request.headers.get('content-length') ?? '0')
    if (Number.isFinite(declaredLength) && declaredLength > 16_384) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Plan request is too large')
    }
    let body: unknown
    try {
      const raw = await request.text()
      if (new TextEncoder().encode(raw).byteLength > 16_384) {
        return errorResponse(400, 'VALIDATION_FAILED', 'Plan request is too large')
      }
      body = JSON.parse(raw) as unknown
    } catch {
      return errorResponse(400, 'VALIDATION_FAILED', 'A valid JSON plan body is required')
    }
    return await callW07Subscription({
      request,
      pathname: '/membership/plans',
      method: 'POST',
      principal,
      verifiedCreatorId: creatorId,
      body,
    })
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) return errorResponse(error.status, error.code, error.message)
    if (error instanceof W08CreatorClientError) return errorResponse(error.status, 'CREATOR_SERVICE_UNAVAILABLE', 'Creator authorization service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Membership plan service unavailable')
  }
}
