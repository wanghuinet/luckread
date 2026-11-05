import {
  AUTHZ_POLICY_VERSION,
  evaluateCaslPermission,
  type LayerId,
} from './casl-policy.js'
import { resolvePermissionContext } from './role-layer.js'

type ScheduledPublishPermissionEnvironment = {
  D1_01: D1Database
}

type ScheduledPublishRequest = {
  creatorId?: unknown
}

const response = (
  body: unknown,
  status = 200,
): Response => Response.json(body, {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
})

const deny = (reasonCode: string, status = 200): Response => response({
  decision: 'DENY',
  reasonCode,
  policyVersion: AUTHZ_POLICY_VERSION,
  action: 'content.publish.own',
  resourceType: 'Content',
}, status)

const isIdentifier = (value: unknown, maxLength = 128): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= maxLength &&
  /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)

/**
 * Background scheduled-publication authorization.
 *
 * This endpoint is intentionally separate from the session-bound CASL endpoint:
 * W01 calls it only through the existing private W08_CREATOR Service Binding.
 * The caller supplies only a W03-derived creator identity hint: either the
 * canonical creatorId or a legacy ownerUserId placeholder. W08 resolves that
 * hint to the ACTIVE Creator -> User mapping and always returns the canonical
 * creatorId; no layer, account state, role or permission result is accepted.
 */
export async function handleScheduledPublishPermission(
  request: Request,
  env: ScheduledPublishPermissionEnvironment,
): Promise<Response> {
  const url = new URL(request.url)
  if (request.method !== 'POST' || url.pathname !== '/internal/authz/check-scheduled-publish') {
    return response({ error: 'NOT_FOUND' }, 404)
  }

  if (
    request.headers.get('X-LuckRead-Caller') !== 'W01' ||
    request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
    !(request.headers.get('X-LuckRead-Correlation-Id')?.trim()) ||
    (request.headers.get('X-LuckRead-Correlation-Id')?.trim().length ?? 0) > 128 ||
    request.headers.has('Cookie') ||
    request.headers.has('Authorization')
  ) {
    return deny('INVALID_SERVICE_CALLER', 403)
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    return deny('INVALID_AUTHORIZATION_REQUEST', 400)
  }

  let body: ScheduledPublishRequest
  try {
    const value: unknown = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return deny('INVALID_AUTHORIZATION_REQUEST', 400)
    }
    body = value as ScheduledPublishRequest
  } catch {
    return deny('INVALID_AUTHORIZATION_REQUEST', 400)
  }

  if (
    Object.keys(body).some((key) => key !== 'creatorId') ||
    !isIdentifier(body.creatorId, 256)
  ) {
    return deny('CALLER_SUPPLIED_AUTHORIZATION_CONTEXT', 400)
  }

  try {
    const creator = await env.D1_01.prepare(
      "SELECT creator_id AS creatorId, user_id AS userId FROM creators " +
      "WHERE status = 'ACTIVE' AND (creator_id = ? OR user_id = ?) " +
      "ORDER BY CASE WHEN creator_id = ? THEN 0 ELSE 1 END LIMIT 1",
    ).bind(body.creatorId, body.creatorId, body.creatorId)
      .first<{ creatorId: string; userId: string }>()

    if (!creator || creator.creatorId !== body.creatorId || !isIdentifier(creator.userId)) {
      return deny('CREATOR_NOT_ACTIVE')
    }

    const account = await env.D1_01.prepare(
      'SELECT account_state AS accountState FROM "user" WHERE id = ? LIMIT 1',
    ).bind(creator.userId).first<{ accountState: string }>()

    if (!account || account.accountState !== 'ACTIVE') {
      return deny('ACCOUNT_NOT_ACTIVE')
    }

    const context = await resolvePermissionContext(env.D1_01, creator.userId)
    if (!context) return deny('LAYER_RESOLUTION_DENIED')
    if (context.layer !== 'L3' && context.layer !== 'L4') {
      return deny('CREATOR_LAYER_REQUIRED')
    }

    const decision = evaluateCaslPermission({
      layer: context.layer as LayerId,
      subjectId: creator.userId,
      accountState: account.accountState,
      action: 'content.publish.own',
      resourceType: 'Content',
      resourceAttributes: { ownerId: creator.userId },
      scopedRoleAssignments: context.scopedRoleAssignments,
    })

    if (decision.decision !== 'ALLOW') {
      return deny(decision.reasonCode ?? 'PERMISSION_DENIED')
    }

    return response({
      decision: 'ALLOW',
      policyVersion: AUTHZ_POLICY_VERSION,
      layer: context.layer,
      action: 'content.publish.own',
      resourceType: 'Content',
      ownerUserId: creator.userId,
      creatorId: creator.creatorId,
    })
  } catch {
    return deny('AUTHORIZATION_INPUT_UNAVAILABLE', 503)
  }
}
