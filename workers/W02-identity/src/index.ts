import { createLuckReadAuth, type RateLimitBinding } from './auth/better-auth.js'
import { publishPendingAccountStateEvents } from './account/publication-journal-publisher.js'
import { resolveGlobalLayer } from './authz/role-assignment.js'
import { grantCreatorBusinessRole, RoleAssignmentCommandError } from './authz/role-assignment-command.js'
import { mayApproveRoleGrant } from './authz/role-grant-approval-policy.js'
import {
  AccountStateTransitionError,
  applyAccountStateTransition,
  authorizeAccountStateTransition,
  type AccountState,
} from './account/account-state-transition.js'
import { resolveBetterAuthPrincipal } from './auth/principal.js'
import { isPrivilegedMfaEnrollmentEligible } from './auth/privileged-mfa-gate.js'
import { handleCurrentUserSessionList } from './auth/session-list.js'
import { handleCurrentUserSessionRevoke } from './auth/session-revoke.js'

interface Env {
  D1_01: D1Database
  AUTH_SESSION_READ_LIMITER: RateLimitBinding
  AUTH_SESSION_WRITE_LIMITER: RateLimitBinding
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
          roleAssignments: principal.roleAssignments,
        })
      } catch {
        return json({ active: false }, 503)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/mfa/enrollment-eligibility') {
      // The identity comes only from the authenticated Better Auth session.
      // Body-supplied subject IDs, layers, and role names are intentionally ignored.
      try {
        const principal = await resolveBetterAuthPrincipal(env, request)
        if (!principal) return json({ eligible: false }, 401)
        if (principal.accountState !== 'ACTIVE') return json({ eligible: false }, 403)

        const eligible = await isPrivilegedMfaEnrollmentEligible(env.D1_01, principal.userId)
        if (!eligible) return json({ eligible: false }, 403)

        return json({ eligible: true })
      } catch {
        return json({ eligible: false, error: { code: 'SERVICE_UNAVAILABLE' } }, 503)
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
    if (request.method === 'POST' && url.pathname === '/internal/auth/session/list') {
      return handleCurrentUserSessionList(env, request)
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/session/revoke-by-id') {
      return handleCurrentUserSessionRevoke(env, request)
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

    if (request.method === 'POST' && url.pathname === '/internal/authz/role-assignment') {
      // W08 owns the creator application/scope appointment. W02 independently
      // authenticates the approving administrator and remains the sole writer
      // of RoleAssignment. This path is private to the W08 service binding.
      if (
        request.headers.get('X-LuckRead-Caller') !== 'W08' ||
        request.headers.get('X-LuckRead-Transport-Version') !== '1.0'
      ) {
        return json({ error: { code: 'FORBIDDEN', message: 'authorized internal caller required' } }, 403)
      }

      const actor = await resolveBetterAuthPrincipal(env, request).catch(() => null)
      if (!actor) return json({ error: { code: 'UNAUTHENTICATED', message: 'authenticated approver required' } }, 401)
      if (actor.accountState !== 'ACTIVE') {
        return json({ error: { code: 'PERMISSION_DENIED', message: 'an active approver is required' } }, 403)
      }

      const body = await readJsonBody<{
        subjectId?: unknown
        roleId?: unknown
        scopeType?: unknown
        scopeId?: unknown
        approvalRef?: unknown
      }>(request)
      if (
        !body ||
        typeof body.subjectId !== 'string' ||
        typeof body.roleId !== 'string' ||
        typeof body.scopeType !== 'string' ||
        !(body.scopeId === null || typeof body.scopeId === 'string') ||
        typeof body.approvalRef !== 'string'
      ) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid role assignment command' } }, 400)
      }

      if (body.roleId !== 'creator' || body.scopeType !== 'global' || body.scopeId !== null) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'only global L3 creator grants are admitted by this endpoint' } }, 400)
      }
      if (!mayApproveRoleGrant(actor.layer)) {
        return json({ error: { code: 'PERMISSION_DENIED', message: 'L7/L8 approval is required' } }, 403)
      }

      try {
        const result = await grantCreatorBusinessRole(env.D1_01, {
          subjectId: body.subjectId,
          roleId: body.roleId as 'creator',
          scopeType: body.scopeType as 'global',
          scopeId: body.scopeId,
          approvalRef: body.approvalRef,
        })
        return json({ ...result, approvedBy: actor.userId })
      } catch (error) {
        const code = error instanceof RoleAssignmentCommandError ? error.code : 'ROLE_ASSIGNMENT_WRITE_FAILED'
        const status =
          code === 'VALIDATION_FAILED' ? 400 :
          code === 'ROLE_MAPPING_INVALID' ? 409 :
          code === 'TARGET_NOT_ELIGIBLE' || code === 'VERIFIED_ROLE_REQUIRED' ? 403 :
          code === 'ROLE_ASSIGNMENT_CONFLICT' || code === 'ROLE_ASSIGNMENT_ALREADY_ACTIVE' ? 409 : 503
        return json({
          error: {
            code,
            message:
              status === 400 ? 'invalid role assignment command' :
              status === 403 ? 'target account is not eligible for this role' :
              status === 409 ? 'role assignment conflicts with current authorization state' :
              'role assignment service unavailable',
          },
        }, status)
      }
    }

    return new Response(null, { status: 404 })
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await publishPendingAccountStateEvents(env)
  },
}
