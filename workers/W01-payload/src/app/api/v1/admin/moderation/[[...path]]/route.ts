import {
  callW06Moderation,
  W06ModerationClientError,
} from '../../../../../../moderation/w06-moderation-client.js'
import {
  callW08Creator,
  creatorServiceUnavailable,
} from '../../../../../../auth/w08-creator-client.js'
import { resolveCookieContentPrincipal } from '../../../../../../content/w03-content-client.js'

const jsonError = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

type RequiredModerationPermission = Readonly<{
  permission: 'moderation.queue.read' | 'moderation.case.read' | 'moderation.decide'
  resourceType: 'ModerationQueue' | 'ModerationCase'
}>

const resolvePath = (segments: string[] | undefined): {
  pathname: string
  needsBody: boolean
  permission: RequiredModerationPermission
} | null => {
  const parts = (segments ?? []).map((segment) => decodeURIComponent(segment))
  if (parts.length === 1 && parts[0] === 'queue') {
    return {
      pathname: '/admin/moderation/queue',
      needsBody: false,
      permission: { permission: 'moderation.queue.read', resourceType: 'ModerationQueue' },
    }
  }
  if (parts.length === 2 && parts[0] === 'cases') {
    return {
      pathname: `/admin/moderation/cases/${encodeURIComponent(parts[1])}`,
      needsBody: false,
      permission: { permission: 'moderation.case.read', resourceType: 'ModerationCase' },
    }
  }
  if (parts.length === 3 && parts[0] === 'cases' && parts[2] === 'decision') {
    return {
      pathname: `/admin/moderation/cases/${encodeURIComponent(parts[1])}/decision`,
      needsBody: true,
      permission: { permission: 'moderation.decide', resourceType: 'ModerationCase' },
    }
  }
  return null
}

type VerifiedModerationPermission = Readonly<{
  decision: 'ALLOW'
  permission: RequiredModerationPermission['permission']
  resourceType: RequiredModerationPermission['resourceType']
  policyVersion: 'casl-l0-l8-v1'
  subjectId: string
  layer: string
}>

async function authorizeModerationRequest(
  request: Request,
  principal: { userId: string; layer: string },
  required: RequiredModerationPermission,
): Promise<VerifiedModerationPermission | Response> {
  let response: Response
  try {
    const authorizationRequest = new Request(request.url, {
      method: 'POST',
      headers: new Headers(request.headers),
      body: JSON.stringify({
        action: required.permission,
        resourceType: required.resourceType,
      }),
    })
    response = await callW08Creator(
      authorizationRequest,
      '/internal/authz/check-permission',
      'POST',
    )
  } catch (error) {
    return creatorServiceUnavailable(error)
  }

  if (!response.ok) {
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'Authorization service unavailable')
  }

  const value: unknown = await response.json().catch(() => null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'Authorization service unavailable')
  }
  const result = value as Record<string, unknown>
  if (result.decision === 'DENY') {
    return jsonError(403, 'PERMISSION_DENIED', 'Permission denied')
  }
  if (
    result.decision !== 'ALLOW' ||
    result.action !== required.permission ||
    result.resourceType !== required.resourceType ||
    result.policyVersion !== 'casl-l0-l8-v1' ||
    result.layer !== principal.layer
  ) {
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'Authorization service unavailable')
  }

  return {
    decision: 'ALLOW',
    permission: required.permission,
    resourceType: required.resourceType,
    policyVersion: 'casl-l0-l8-v1',
    subjectId: principal.userId,
    layer: principal.layer,
  }
}

const run = async (request: Request, context: { params: Promise<{ path?: string[] }> }) => {
  const resolved = resolvePath((await context.params).path)
  if (!resolved) return jsonError(404, 'NOT_FOUND', 'Moderation route not found')

  const principal = await resolveCookieContentPrincipal(request)
  if (principal instanceof Response) return principal
  if (!principal.userId || !principal.layer) {
    return jsonError(401, 'UNAUTHENTICATED', 'Authentication required')
  }

  const permissionContext = await authorizeModerationRequest(request, principal, resolved.permission)
  if (permissionContext instanceof Response) return permissionContext

  let body: unknown = undefined
  if (resolved.needsBody) {
    try {
      body = await request.json()
    } catch {
      return jsonError(422, 'VALIDATION_FAILED', 'Invalid moderation request')
    }
  }

  try {
    return await callW06Moderation({
      request,
      pathname: resolved.pathname,
      method: request.method,
      principal,
      body,
      permissionContext,
    })
  } catch (error) {
    if (error instanceof W06ModerationClientError) {
      return jsonError(error.status, error.code, error.message)
    }
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'Moderation service unavailable')
  }
}

export async function GET(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  return run(request, context)
}

export async function POST(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const parts = (await context.params).path ?? []
  if (!(parts.length === 3 && parts[2] === 'decision')) {
    return jsonError(404, 'NOT_FOUND', 'Moderation route not found')
  }
  return run(request, { params: Promise.resolve({ path: parts }) })
}

export const dynamic = 'force-dynamic'
