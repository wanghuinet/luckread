import {
  AUTHZ_POLICY_VERSION,
  evaluateCaslPermission,
  type LayerId,
} from './casl-policy.js'
import { resolvePermissionContextPostgres, type RoleAssignmentRow } from './role-layer.js'
import { getW08PostgresPool, resolveW08DatabaseDriver, type W08RuntimeEnv } from '../neon/runtime.js'
import type { Pool } from 'pg'

type ScheduledPublishPermissionEnvironment = W08RuntimeEnv
type ScheduledPublishPermissionDependencies = Readonly<{
  getPostgresPool?: (env: W08RuntimeEnv) => Pool
}>

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
  dependencies: ScheduledPublishPermissionDependencies = {},
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
    if (resolveW08DatabaseDriver(env) !== 'neon') {
      throw new Error('W08_NEON_AUTHORIZATION_DATABASE_REQUIRED')
    }
    const pool = (dependencies.getPostgresPool ?? getW08PostgresPool)(env)

    const creator = (await pool.query<{ creatorId: string; userId: string }>(
      'SELECT creator_id AS "creatorId", user_id AS "userId" FROM creators ' +
      "WHERE status = 'ACTIVE' AND (creator_id = $1 OR user_id = $2) " +
      'ORDER BY CASE WHEN creator_id = $3 THEN 0 ELSE 1 END LIMIT 1',
      [body.creatorId, body.creatorId, body.creatorId],
    )).rows[0] ?? null

    if (
      !creator ||
      !isIdentifier(creator.creatorId, 256) ||
      !isIdentifier(creator.userId) ||
      (creator.creatorId !== body.creatorId && creator.userId !== body.creatorId)
    ) {
      return deny('CREATOR_NOT_ACTIVE')
    }

    const account = (await pool.query<{ accountState: string }>(
      'SELECT account_state AS "accountState" FROM "user" WHERE id = $1 LIMIT 1',
      [creator.userId],
    )).rows[0] ?? null

    if (!account || account.accountState !== 'ACTIVE') {
      return deny('ACCOUNT_NOT_ACTIVE')
    }

    const context = await resolvePermissionContextPostgres(
      async (sql, values) => (await pool.query(sql, values as never)).rows as RoleAssignmentRow[],
      creator.userId,
    )
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
