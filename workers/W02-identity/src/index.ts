import { createLuckReadAuth } from './auth/better-auth.js'
import { publishPendingAccountStateEvents } from './account/publication-journal-publisher.js'
import { reconcileCompletedRegistrationMaterialization } from './account/registration-materializer.js'
import { registerWithBetterAuth, RegistrationServiceError } from './account/registration-service.js'
import { resolveGlobalLayer } from './authz/role-assignment.js'
import {
  AccountStateTransitionError,
  applyAccountStateTransition,
  authorizeAccountStateTransition,
  type AccountState,
} from './account/account-state-transition.js'
import {
  establishSessionFromAuthoritativeD1,
  refreshSessionFromAuthoritativeD1,
  revokeSessionExtension,
  validateAuthoritativeSession,
  resolveAuthenticatedPrincipal,
} from './session/session-runtime.js'
import {
  listCurrentUserSessions,
  revokeCurrentUserSession,
  SessionManagementError,
} from './session/session-management.js'
import { resolveBetterAuthPrincipal } from './auth/principal.js'

interface Env {
  D1_01: D1Database
  AUTH013_QUEUE: Queue
  AUTH013_PROJECTION_QUEUE: Queue
  AUTH003_CREDENTIAL_HASH_KEY?: string
  AUTH003_CREDENTIAL_HASH_KEY_PREVIOUS?: string
}

type ResolveLayerRequest = {
  subjectId: string
  accountState: string
  now?: string
}

type EstablishSessionRequest = {
  sessionId: string
  userId: string
  deviceId: string
  now?: string
}

type RefreshSessionRequest = {
  refreshToken: string
  deviceId: string
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
      return createLuckReadAuth({ D1_01: env.D1_01 }).handler(request)
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/register') {
      const body = await readJsonBody<{
        identityType?: unknown
        identity?: unknown
        credential?: unknown
        username?: unknown
        consent?: unknown
        idempotencyKey?: unknown
      }>(request)

      if (
        !body ||
        typeof body.identityType !== 'string' ||
        typeof body.identity !== 'string' ||
        typeof body.credential !== 'string' ||
        typeof body.username !== 'string' ||
        typeof body.idempotencyKey !== 'string'
      ) {
        return json(
          { error: { code: 'VALIDATION_FAILED', message: 'invalid registration request' } },
          400,
        )
      }

      try {
        const result = await registerWithBetterAuth(
          env,
          body,
          body.idempotencyKey,
        )
        return json(result, 201)
      } catch (error) {
        if (error instanceof RegistrationServiceError) {
          return json(
            {
              error: {
                code: error.code,
                message: error.message,
              },
            },
            error.status,
          )
        }

        return json(
          {
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'Registration service unavailable',
            },
          },
          503,
        )
      }
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
        const principal = await resolveBetterAuthPrincipal(env.D1_01, request)
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

    if (request.method === 'POST' && url.pathname === '/internal/auth/session/establish') {
      const body = await readJsonBody<EstablishSessionRequest>(request)
      if (
        !body ||
        typeof body.sessionId !== 'string' ||
        typeof body.userId !== 'string' ||
        typeof body.deviceId !== 'string'
      ) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid session establishment request' } }, 400)
      }

      try {
        const result = await establishSessionFromAuthoritativeD1(env.D1_01, body)
        return json({
          sessionId: result.sessionId,
          refreshToken: result.refreshToken,
          tokenVersion: result.tokenVersion,
          layer: result.layer,
          nativeExpiresAt: result.nativeExpiresAt,
        })
      } catch (error) {
        const code = error instanceof Error && 'code' in error
          ? String((error as { code?: unknown }).code)
          : 'UNAVAILABLE'
        const status = code === 'UNAUTHENTICATED' ? 401 : code === 'INVALID_INPUT' ? 400 : 503
        return json({
          error: {
            code: status === 401 ? 'UNAUTHENTICATED' : status === 400 ? 'VALIDATION_FAILED' : 'SERVICE_UNAVAILABLE',
            message: status === 401 ? 'authentication denied' : status === 400 ? 'invalid session request' : 'authentication service unavailable',
          },
        }, status)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/session/refresh') {
      const body = await readJsonBody<RefreshSessionRequest>(request)
      if (
        !body ||
        typeof body.refreshToken !== 'string' ||
        typeof body.deviceId !== 'string'
      ) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid session refresh request' } }, 400)
      }

      try {
        const result = await refreshSessionFromAuthoritativeD1(env.D1_01, body)
        return json({
          sessionId: result.sessionId,
          userId: result.userId,
          refreshToken: result.refreshToken,
          tokenVersion: result.tokenVersion,
          layer: result.layer,
          nativeExpiresAt: result.nativeExpiresAt,
          email: result.email,
        })
      } catch (error) {
        const code = error instanceof Error && 'code' in error
          ? String((error as { code?: unknown }).code)
          : 'UNAVAILABLE'
        const status = code === 'UNAUTHENTICATED' ? 401 : code === 'INVALID_INPUT' ? 400 : 503
        return json({
          error: {
            code: status === 401 ? 'UNAUTHENTICATED' : status === 400 ? 'VALIDATION_FAILED' : 'SERVICE_UNAVAILABLE',
            message: status === 401 ? 'authentication denied' : status === 400 ? 'invalid session request' : 'authentication service unavailable',
          },
        }, status)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/session/principal') {
      const body = await readJsonBody<{ sessionId?: unknown; userId?: unknown; tokenVersion?: unknown }>(request)
      if (
        !body ||
        typeof body.sessionId !== 'string' ||
        body.sessionId.length === 0 ||
        typeof body.userId !== 'string' ||
        body.userId.length === 0 ||
        typeof body.tokenVersion !== 'number' ||
        !Number.isSafeInteger(body.tokenVersion) ||
        body.tokenVersion < 0
      ) {
        return json({ active: false }, 400)
      }

      try {
        const result = await resolveAuthenticatedPrincipal(env.D1_01, {
          sessionId: body.sessionId,
          userId: body.userId,
          tokenVersion: body.tokenVersion,
        })
        return json(result, result.active ? 200 : 401)
      } catch {
        return json({ active: false }, 503)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/session/validate') {
      const body = await readJsonBody<{ sessionId?: unknown; userId?: unknown; tokenVersion?: unknown }>(request)
      if (
        !body ||
        typeof body.sessionId !== 'string' ||
        body.sessionId.length === 0 ||
        typeof body.userId !== 'string' ||
        body.userId.length === 0 ||
        typeof body.tokenVersion !== 'number' ||
        !Number.isSafeInteger(body.tokenVersion) ||
        body.tokenVersion < 0
      ) {
        return json({ active: false }, 400)
      }

      try {
        const result = await validateAuthoritativeSession(env.D1_01, {
          sessionId: body.sessionId,
          userId: body.userId,
          tokenVersion: body.tokenVersion,
        })
        return json(result)
      } catch {
        return json({ active: false }, 503)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/session/revoke') {
      const body = await readJsonBody<{ sessionId?: unknown }>(request)
      if (!body || typeof body.sessionId !== 'string' || body.sessionId.length === 0) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid session revocation request' } }, 400)
      }

      try {
        const result = await revokeSessionExtension(env.D1_01, body.sessionId, new Date().toISOString())
        return json(result)
      } catch {
        return json({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'authentication service unavailable',
          },
        }, 503)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/session/list') {
      const body = await readJsonBody<{
        userId?: unknown
        currentSessionId?: unknown
        tokenVersion?: unknown
        cursor?: unknown
        limit?: unknown
      }>(request)

      if (
        !body ||
        typeof body.userId !== 'string' ||
        typeof body.currentSessionId !== 'string' ||
        typeof body.tokenVersion !== 'number' ||
        (body.cursor !== undefined && typeof body.cursor !== 'string') ||
        (body.limit !== undefined && typeof body.limit !== 'number')
      ) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid session list request' } }, 400)
      }

      try {
        const result = await listCurrentUserSessions(env.D1_01, {
          userId: body.userId,
          currentSessionId: body.currentSessionId,
          tokenVersion: body.tokenVersion,
          cursor: body.cursor,
          limit: body.limit,
        })
        return json(result)
      } catch (error) {
        if (error instanceof SessionManagementError) {
          const status =
            error.code === 'UNAUTHENTICATED' ? 401 :
            error.code === 'PERMISSION_DENIED' ? 403 :
            error.code === 'INVALID_CURSOR' ? 400 :
            error.code === 'INVALID_INPUT' ? 400 :
            503
          return json({
            error: {
              code:
                status === 401 ? 'UNAUTHENTICATED' :
                status === 403 ? 'PERMISSION_DENIED' :
                status === 400 ? (error.code === 'INVALID_CURSOR' ? 'INVALID_CURSOR' : 'VALIDATION_FAILED') :
                'SERVICE_UNAVAILABLE',
              message:
                status === 401 ? 'authentication denied' :
                status === 403 ? 'permission denied' :
                status === 400 ? 'invalid session list request' :
                'session service unavailable',
            },
          }, status)
        }
        return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'session service unavailable' } }, 503)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/session/revoke-owned') {
      const body = await readJsonBody<{
        userId?: unknown
        currentSessionId?: unknown
        tokenVersion?: unknown
        targetSessionId?: unknown
      }>(request)

      if (
        !body ||
        typeof body.userId !== 'string' ||
        typeof body.currentSessionId !== 'string' ||
        typeof body.tokenVersion !== 'number' ||
        typeof body.targetSessionId !== 'string'
      ) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid session revoke request' } }, 400)
      }

      try {
        const result = await revokeCurrentUserSession(env.D1_01, {
          userId: body.userId,
          currentSessionId: body.currentSessionId,
          tokenVersion: body.tokenVersion,
          targetSessionId: body.targetSessionId,
        })
        return json(result)
      } catch (error) {
        if (error instanceof SessionManagementError) {
          const status =
            error.code === 'UNAUTHENTICATED' ? 401 :
            error.code === 'PERMISSION_DENIED' ? 403 :
            error.code === 'INVALID_INPUT' ? 400 :
            503
          return json({
            error: {
              code:
                status === 401 ? 'UNAUTHENTICATED' :
                status === 403 ? 'PERMISSION_DENIED' :
                status === 400 ? 'VALIDATION_FAILED' :
                'SERVICE_UNAVAILABLE',
              message:
                status === 401 ? 'authentication denied' :
                status === 403 ? 'permission denied' :
                status === 400 ? 'invalid session revoke request' :
                'session service unavailable',
            },
          }, status)
        }
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

    try {
      const report = await reconcileCompletedRegistrationMaterialization(env.D1_01, env)
      if (report.failed.length > 0) {
        console.error(JSON.stringify({
          event: 'auth.register.materialization_partial_failure',
          diagnosticCode: 'AUTH001_MATERIALIZATION_PARTIAL_FAILURE',
          scanned: report.scanned,
          materialized: report.materialized,
          alreadyConverged: report.alreadyConverged,
          failedCount: report.failed.length,
          failureCodes: report.failed.map((entry) => entry.code),
        }))
      }
    } catch (error) {
      console.error(JSON.stringify({
        event: 'auth.register.materialization_unavailable',
        diagnosticCode: 'AUTH001_MATERIALIZATION_UNAVAILABLE',
        errorName: error instanceof Error ? error.name : typeof error,
      }))
    }
  },
}
