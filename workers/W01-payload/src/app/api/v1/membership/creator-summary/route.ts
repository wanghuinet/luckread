import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../../subscription/w07-subscription-client.js'
import { callW08Creator, W08CreatorClientError } from '../../../../../auth/w08-creator-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

async function authorizeMembershipAnalytics(request: Request, principalUserId: string): Promise<Response | null> {
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('content-type', 'application/json; charset=utf-8')
  const permissionRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'membership.analytics.read.own',
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
    return errorResponse(403, 'PERMISSION_DENIED', 'Creator membership analytics permission required')
  }
  return null
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

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isSummary(value: unknown): value is {
  plans: { total: number; draft: number; active: number; paused: number; retired: number }
  subscriptions: {
    total: number; pending: number; active: number; pastDue: number; paused: number
    canceled: number; expired: number; activeSubscribers: number
  }
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const summary = value as Record<string, unknown>
  const plans = summary.plans
  const subscriptions = summary.subscriptions
  if (!plans || typeof plans !== 'object' || Array.isArray(plans) ||
      !subscriptions || typeof subscriptions !== 'object' || Array.isArray(subscriptions)) return false
  const p = plans as Record<string, unknown>
  const s = subscriptions as Record<string, unknown>
  return ['total', 'draft', 'active', 'paused', 'retired'].every((key) => isCount(p[key])) &&
    ['total', 'pending', 'active', 'pastDue', 'paused', 'canceled', 'expired', 'activeSubscribers']
      .every((key) => isCount(s[key])) &&
    p.total === Number(p.draft) + Number(p.active) + Number(p.paused) + Number(p.retired) &&
    s.total === Number(s.pending) + Number(s.active) + Number(s.pastDue) +
      Number(s.paused) + Number(s.canceled) + Number(s.expired)
}

async function getCreatorMembershipSummary(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal
    const denied = await authorizeMembershipAnalytics(request, principal.userId)
    if (denied) return denied
    const creatorId = await resolveActiveCreatorId(request)
    if (creatorId instanceof Response) return creatorId

    const response = await callW07Subscription({
      request,
      pathname: '/membership/creator-summary',
      method: 'GET',
      principal,
      verifiedCreatorId: creatorId,
    })
    if (!response.ok) return response

    const envelope: unknown = await response.clone().json().catch((): null => null)
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      return errorResponse(503, 'INVALID_SUMMARY_RESPONSE', 'Membership summary response is invalid')
    }
    const candidate = envelope as { data?: unknown; requestId?: unknown }
    if (!isSummary(candidate.data) || typeof candidate.requestId !== 'string' ||
        candidate.requestId.trim().length < 1 || candidate.requestId.length > 256) {
      return errorResponse(503, 'INVALID_SUMMARY_RESPONSE', 'Membership summary response is invalid')
    }
    return Response.json(
      { data: candidate.data, requestId: candidate.requestId },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) return errorResponse(error.status, error.code, error.message)
    if (error instanceof W08CreatorClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Membership summary service unavailable')
  }
}

export async function GET(request: Request): Promise<Response> {
  return getCreatorMembershipSummary(request)
}
