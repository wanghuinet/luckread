import { createLuckReadAuth } from './auth/better-auth.js'
import { publishPendingAccountStateEvents } from './account/publication-journal-publisher.js'
import { resolveGlobalLayer } from './authz/role-assignment.js'
import {
  AUTHZ_POLICY_VERSION,
  evaluateCaslPermission,
  SUPPORTED_AUTHZ_SUBJECTS,
  type LayerId,
  type ScopedRoleAssignment,
} from './authz/casl-policy.js'
import {
  AccountStateTransitionError,
  applyAccountStateTransition,
  authorizeAccountStateTransition,
  type AccountState,
} from './account/account-state-transition.js'
import { resolveBetterAuthPrincipal } from './auth/principal.js'

interface Env {
  D1_01: D1Database
  RESEND_API_KEY?: string
  AUTH_EMAIL_FROM?: string
  AUTH013_QUEUE: Queue
  AUTH013_PROJECTION_QUEUE: Queue
}

type ResolveLayerRequest = {
  subjectId: string
  accountState: string
  now?: string
}

const readJsonBody = async <T>(request: Request): Promise<T | null> => {
  try {
    const body = await request.json<T>()
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
})

const isSafeResourceAttributes = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > 32) return false
  return entries.every(([key, item]) =>
    key.length > 0 &&
    key.length <= 64 &&
    !key.startsWith('
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
      return createLuckReadAuth(env).handler(request)
    }

    if (request.method === 'POST' && url.pathname === '/internal/account/transition') {
      const body = await readJsonBody<{
        subjectId?: unknown
        targetUserId?: unknown
        to?: unknown
        reason?: unknown
        expectedVersion?: unknown
      }>(request)

      if (
        !body ||
        typeof body.subjectId !== 'string' ||
        typeof body.targetUserId !== 'string' ||
        typeof body.to !== 'string' ||
        typeof body.reason !== 'string' ||
        typeof body.expectedVersion !== 'number' ||
        !Number.isSafeInteger(body.expectedVersion) ||
        body.expectedVersion < 1
      ) {
        return json(
          { error: { code: 'VALIDATION_FAILED', message: 'invalid account-state transition request' } },
          400,
        )
      }

      try {
        const authorization = await authorizeAccountStateTransition(env.D1_01, {
          subjectId: body.subjectId,
          targetUserId: body.targetUserId,
          to: body.to as AccountState,
        })

        const result = await applyAccountStateTransition(env.D1_01, {
          userId: body.targetUserId,
          to: body.to as AccountState,
          reason: body.reason,
          expectedVersion: body.expectedVersion as number,
          actor: authorization.actor,
          permission: authorization.permission,
          approvalLevel: authorization.approvalLevel,
        })

        return json({
          from: result.from,
          to: result.to,
          auditEventId: result.eventId,
        })
      } catch (error) {
        const code = error instanceof AccountStateTransitionError
          ? error.code
          : 'JOURNAL_PERSISTENCE_FAILED'
        const status =
          code === 'FORBIDDEN' ? 403 :
          code === 'NOT_FOUND' ? 404 :
          code === 'CONFLICT' ? 412 :
          code === 'INVALID_STATE' ? 409 :
          code === 'PRECONDITION_FAILED' ? 412 :
          code === 'INVALID_INPUT' ? 400 :
          503

        return json({
          error: {
            code:
              status === 403 ? 'PERMISSION_DENIED' :
              status === 404 ? 'NOT_FOUND' :
              status === 409 ? 'INVALID_STATE' :
              status === 412 ? 'PRECONDITION_FAILED' :
              status === 400 ? 'VALIDATION_FAILED' :
              'SERVICE_UNAVAILABLE',
            message:
              status === 403 ? 'permission denied' :
              status === 404 ? 'user account not found' :
              status === 409 ? 'invalid account-state transition' :
              status === 412 ? 'account-state precondition failed' :
              status === 400 ? 'invalid account-state request' :
              'account-state service unavailable',
          },
        }, status)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/principal') {
      try {
        const principal = await resolveBetterAuthPrincipal(env, request)
        if (!principal) return json({ active: false }, 401)

        return json({
          active: true,
          userId: principal.userId,
          email: principal.email,
          sessionId: principal.sessionId,
          accountState: principal.accountState,
          accountStateVersion: principal.accountStateVersion,
          layer: principal.layer,
        })
      } catch {
        return json({ active: false }, 503)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/registration/rollback') {
      const body = await readJsonBody<{ userId?: unknown; email?: unknown; username?: unknown }>(request)
      if (!body || typeof body.userId !== 'string' || body.userId.length === 0 || body.userId.length > 128 ||
          typeof body.email !== 'string' || body.email.length === 0 || typeof body.username !== 'string' || body.username.length === 0) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid registration rollback request' } }, 400)
      }

      try {
        const row = await env.D1_01
          .prepare('SELECT id, email, username, account_state AS accountState FROM "user" WHERE id = ? LIMIT 1')
          .bind(body.userId)
          .first<{ id: string; email: string; username: string | null; accountState: string }>()

        if (!row) return json({ rolledBack: true })
        if (row.email !== body.email.trim().toLowerCase() || String(row.username ?? '') !== body.username.trim() || row.accountState !== 'PENDING_VERIFICATION') {
          return json({ error: { code: 'PRECONDITION_FAILED', message: 'registration rollback precondition failed' } }, 412)
        }

        const activeSession = await env.D1_01
          .prepare('SELECT 1 AS present FROM "session" WHERE user_id = ? LIMIT 1')
          .bind(body.userId)
          .first<{ present: number }>()
        if (activeSession) return json({ error: { code: 'PRECONDITION_FAILED', message: 'registration rollback cannot remove an active session' } }, 412)

        await env.D1_01.batch([
          env.D1_01.prepare('DELETE FROM role_assignments WHERE subject_id = ?').bind(body.userId),
          env.D1_01.prepare('DELETE FROM "verification" WHERE identifier = ?').bind(body.email.trim().toLowerCase()),
          env.D1_01.prepare('DELETE FROM "account" WHERE user_id = ?').bind(body.userId),
          env.D1_01.prepare('DELETE FROM "user" WHERE id = ? AND account_state = ?').bind(body.userId, 'PENDING_VERIFICATION'),
        ])

        return json({ rolledBack: true })
      } catch {
        return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'registration rollback unavailable' } }, 503)
      }
    }
    if (request.method === 'POST' && url.pathname === '/internal/auth/session/revoke-by-id') {
      const body = await readJsonBody<{ sessionId?: unknown }>(request)
      if (!body || typeof body.sessionId !== 'string' || body.sessionId.length === 0 || body.sessionId.length > 128) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid session revocation request' } }, 400)
      }

      try {
        const auth = createLuckReadAuth(env)
        const current = await auth.api.getSession({ headers: request.headers, query: {} })
        if (!current?.user?.id) {
          return json({ error: { code: 'UNAUTHENTICATED', message: 'authentication required' } }, 401)
        }

        const target = await env.D1_01
          .prepare('SELECT id, token, user_id AS userId FROM "session" WHERE id = ? LIMIT 1')
          .bind(body.sessionId)
          .first<{ id: string; token: string; userId: string }>()

        if (!target || String(target.userId) !== String(current.user.id)) {
          return json({ revoked: true })
        }

        await auth.api.revokeSession({
          headers: request.headers,
          body: { token: target.token },
        })

        return json({ revoked: true })
      } catch {
        return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'session service unavailable' } }, 503)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/authz/check-permission') {
      const body = await readJsonBody<{
        subjectId?: unknown
        action?: unknown
        resourceType?: unknown
        resourceAttributes?: unknown
      }>(request)

      if (
        !body ||
        typeof body.subjectId !== 'string' ||
        body.subjectId.length === 0 ||
        body.subjectId.length > 128 ||
        typeof body.action !== 'string' ||
        body.action.trim().length === 0 ||
        body.action.length > 128 ||
        typeof body.resourceType !== 'string' ||
        !(SUPPORTED_AUTHZ_SUBJECTS as readonly string[]).includes(body.resourceType) ||
        (body.resourceAttributes !== undefined && !isSafeResourceAttributes(body.resourceAttributes))
      ) {
        return json({
          decision: 'DENY',
          reasonCode: 'INVALID_AUTHORIZATION_REQUEST',
          policyVersion: AUTHZ_POLICY_VERSION,
        }, 400)
      }

      const now = new Date().toISOString()
      try {
        const account = await env.D1_01
          .prepare('SELECT account_state AS accountState FROM "user" WHERE id = ? LIMIT 1')
          .bind(body.subjectId)
          .first<{ accountState: string }>()

        if (!account) {
          return json({
            decision: 'DENY',
            reasonCode: 'SUBJECT_NOT_FOUND',
            policyVersion: AUTHZ_POLICY_VERSION,
          })
        }

        let layer: LayerId
        let scopedRoleAssignments: ScopedRoleAssignment[] = []
        if (account.accountState === 'RESTRICTED' || account.accountState === 'FROZEN') {
          // These states are forced into the non-privileged policy set. The
          // policy evaluator then permits only the documented safe-read subset.
          layer = 'L1'
        } else if (account.accountState === 'ACTIVE' || account.accountState === 'PENDING_VERIFICATION') {
          const resolved = await resolveGlobalLayer(
            env.D1_01,
            body.subjectId,
            account.accountState,
            now,
          )
          if (resolved.decision !== 'ALLOW' || !resolved.layer) {
            return json({
              decision: 'DENY',
              reasonCode: 'LAYER_RESOLUTION_DENIED',
              policyVersion: AUTHZ_POLICY_VERSION,
            })
          }
          layer = resolved.layer as LayerId

          if (account.accountState === 'ACTIVE') {
            const scopedRows = await env.D1_01
              .prepare(
                "SELECT role_id AS roleId, scope_type AS scopeType, scope_id AS scopeId " +
                "FROM role_assignments " +
                "WHERE subject_id = ? AND status = 'ACTIVE' " +
                "AND valid_from <= ? AND (valid_until IS NULL OR ? < valid_until) " +
                "AND scope_type IN ('organization', 'ip') " +
                "AND role_id IN ('ip_principal', 'mcn_admin', 'mcn_editor')",
              )
              .bind(body.subjectId, now, now)
              .all<{ roleId: string; scopeType: string; scopeId: string | null }>()

            scopedRoleAssignments = scopedRows.results
              .filter((row) =>
                typeof row.scopeId === 'string' &&
                ((row.roleId === 'ip_principal' && row.scopeType === 'ip') ||
                  ((row.roleId === 'mcn_admin' || row.roleId === 'mcn_editor') &&
                    row.scopeType === 'organization')),
              )
              .map((row) => ({
                roleId: row.roleId,
                scopeType: row.scopeType as 'organization' | 'ip',
                scopeId: row.scopeId as string,
              }))
          }
        } else {
          return json({
            decision: 'DENY',
            reasonCode: 'ACCOUNT_STATE_DENY',
            policyVersion: AUTHZ_POLICY_VERSION,
          })
        }

        return json(evaluateCaslPermission({
          layer,
          subjectId: body.subjectId,
          accountState: account.accountState,
          action: body.action,
          resourceType: body.resourceType,
          resourceAttributes: (body.resourceAttributes ?? {}) as Record<string, unknown>,
          scopedRoleAssignments,
        }))
      } catch {
        return json({
          decision: 'DENY',
          reasonCode: 'AUTHORIZATION_INPUT_UNAVAILABLE',
          policyVersion: AUTHZ_POLICY_VERSION,
        }, 503)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/authz/resolve-layer') {
      const body = await readJsonBody<ResolveLayerRequest>(request)
      if (!body || typeof body.subjectId !== 'string' || typeof body.accountState !== 'string') {
        return json({ decision: 'DENY' }, 400)
      }

      try {
        const result = await resolveGlobalLayer(env.D1_01, body.subjectId, body.accountState, body.now)
        return json(result)
      } catch {
        return json({ decision: 'DENY' }, 503)
      }
    }

    return new Response(null, { status: 404 })
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await publishPendingAccountStateEvents(env)
  },
}
) &&
    !['__proto__', 'prototype', 'constructor'].includes(key) &&
    (item === null ||
      typeof item === 'string' ||
      typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item))),
  )
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
      return createLuckReadAuth(env).handler(request)
    }

    if (request.method === 'POST' && url.pathname === '/internal/account/transition') {
      const body = await readJsonBody<{
        subjectId?: unknown
        targetUserId?: unknown
        to?: unknown
        reason?: unknown
        expectedVersion?: unknown
      }>(request)

      if (
        !body ||
        typeof body.subjectId !== 'string' ||
        typeof body.targetUserId !== 'string' ||
        typeof body.to !== 'string' ||
        typeof body.reason !== 'string' ||
        typeof body.expectedVersion !== 'number' ||
        !Number.isSafeInteger(body.expectedVersion) ||
        body.expectedVersion < 1
      ) {
        return json(
          { error: { code: 'VALIDATION_FAILED', message: 'invalid account-state transition request' } },
          400,
        )
      }

      try {
        const authorization = await authorizeAccountStateTransition(env.D1_01, {
          subjectId: body.subjectId,
          targetUserId: body.targetUserId,
          to: body.to as AccountState,
        })

        const result = await applyAccountStateTransition(env.D1_01, {
          userId: body.targetUserId,
          to: body.to as AccountState,
          reason: body.reason,
          expectedVersion: body.expectedVersion as number,
          actor: authorization.actor,
          permission: authorization.permission,
          approvalLevel: authorization.approvalLevel,
        })

        return json({
          from: result.from,
          to: result.to,
          auditEventId: result.eventId,
        })
      } catch (error) {
        const code = error instanceof AccountStateTransitionError
          ? error.code
          : 'JOURNAL_PERSISTENCE_FAILED'
        const status =
          code === 'FORBIDDEN' ? 403 :
          code === 'NOT_FOUND' ? 404 :
          code === 'CONFLICT' ? 412 :
          code === 'INVALID_STATE' ? 409 :
          code === 'PRECONDITION_FAILED' ? 412 :
          code === 'INVALID_INPUT' ? 400 :
          503

        return json({
          error: {
            code:
              status === 403 ? 'PERMISSION_DENIED' :
              status === 404 ? 'NOT_FOUND' :
              status === 409 ? 'INVALID_STATE' :
              status === 412 ? 'PRECONDITION_FAILED' :
              status === 400 ? 'VALIDATION_FAILED' :
              'SERVICE_UNAVAILABLE',
            message:
              status === 403 ? 'permission denied' :
              status === 404 ? 'user account not found' :
              status === 409 ? 'invalid account-state transition' :
              status === 412 ? 'account-state precondition failed' :
              status === 400 ? 'invalid account-state request' :
              'account-state service unavailable',
          },
        }, status)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/principal') {
      try {
        const principal = await resolveBetterAuthPrincipal(env, request)
        if (!principal) return json({ active: false }, 401)

        return json({
          active: true,
          userId: principal.userId,
          email: principal.email,
          sessionId: principal.sessionId,
          accountState: principal.accountState,
          accountStateVersion: principal.accountStateVersion,
          layer: principal.layer,
        })
      } catch {
        return json({ active: false }, 503)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/registration/rollback') {
      const body = await readJsonBody<{ userId?: unknown; email?: unknown; username?: unknown }>(request)
      if (!body || typeof body.userId !== 'string' || body.userId.length === 0 || body.userId.length > 128 ||
          typeof body.email !== 'string' || body.email.length === 0 || typeof body.username !== 'string' || body.username.length === 0) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid registration rollback request' } }, 400)
      }

      try {
        const row = await env.D1_01
          .prepare('SELECT id, email, username, account_state AS accountState FROM "user" WHERE id = ? LIMIT 1')
          .bind(body.userId)
          .first<{ id: string; email: string; username: string | null; accountState: string }>()

        if (!row) return json({ rolledBack: true })
        if (row.email !== body.email.trim().toLowerCase() || String(row.username ?? '') !== body.username.trim() || row.accountState !== 'PENDING_VERIFICATION') {
          return json({ error: { code: 'PRECONDITION_FAILED', message: 'registration rollback precondition failed' } }, 412)
        }

        const activeSession = await env.D1_01
          .prepare('SELECT 1 AS present FROM "session" WHERE user_id = ? LIMIT 1')
          .bind(body.userId)
          .first<{ present: number }>()
        if (activeSession) return json({ error: { code: 'PRECONDITION_FAILED', message: 'registration rollback cannot remove an active session' } }, 412)

        await env.D1_01.batch([
          env.D1_01.prepare('DELETE FROM role_assignments WHERE subject_id = ?').bind(body.userId),
          env.D1_01.prepare('DELETE FROM "verification" WHERE identifier = ?').bind(body.email.trim().toLowerCase()),
          env.D1_01.prepare('DELETE FROM "account" WHERE user_id = ?').bind(body.userId),
          env.D1_01.prepare('DELETE FROM "user" WHERE id = ? AND account_state = ?').bind(body.userId, 'PENDING_VERIFICATION'),
        ])

        return json({ rolledBack: true })
      } catch {
        return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'registration rollback unavailable' } }, 503)
      }
    }
    if (request.method === 'POST' && url.pathname === '/internal/auth/session/revoke-by-id') {
      const body = await readJsonBody<{ sessionId?: unknown }>(request)
      if (!body || typeof body.sessionId !== 'string' || body.sessionId.length === 0 || body.sessionId.length > 128) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid session revocation request' } }, 400)
      }

      try {
        const auth = createLuckReadAuth(env)
        const current = await auth.api.getSession({ headers: request.headers, query: {} })
        if (!current?.user?.id) {
          return json({ error: { code: 'UNAUTHENTICATED', message: 'authentication required' } }, 401)
        }

        const target = await env.D1_01
          .prepare('SELECT id, token, user_id AS userId FROM "session" WHERE id = ? LIMIT 1')
          .bind(body.sessionId)
          .first<{ id: string; token: string; userId: string }>()

        if (!target || String(target.userId) !== String(current.user.id)) {
          return json({ revoked: true })
        }

        await auth.api.revokeSession({
          headers: request.headers,
          body: { token: target.token },
        })

        return json({ revoked: true })
      } catch {
        return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'session service unavailable' } }, 503)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/authz/resolve-layer') {
      const body = await readJsonBody<ResolveLayerRequest>(request)
      if (!body || typeof body.subjectId !== 'string' || typeof body.accountState !== 'string') {
        return json({ decision: 'DENY' }, 400)
      }

      try {
        const result = await resolveGlobalLayer(env.D1_01, body.subjectId, body.accountState, body.now)
        return json(result)
      } catch {
        return json({ decision: 'DENY' }, 503)
      }
    }

    return new Response(null, { status: 404 })
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await publishPendingAccountStateEvents(env)
  },
}
