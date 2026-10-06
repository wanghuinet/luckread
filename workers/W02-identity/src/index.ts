import { bindExecutionContext, createLuckReadAuth } from './auth/better-auth.js'
import { publishPendingAccountStateEvents } from './account/publication-journal-publisher.js'
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
} from './session/session-runtime.js'
import {
  listCurrentUserSessions,
  revokeCurrentUserSession,
  SessionManagementError,
} from './session/session-management.js'
import { changePasswordWithBetterAuth, PasswordChangeServiceError } from './account/password-change.js'
import { resolveBetterAuthPrincipal } from './auth/principal.js'
import {
  getAuthenticatedUserProfile,
  updateAuthenticatedUserProfile,
  getPublicUserProfileById,
  getPublicUserProfileByUsername,
} from './account/user-profile.js'

interface Env {
  D1_01: D1Database
  AUTH013_QUEUE: Queue
  AUTH013_PROJECTION_QUEUE: Queue
  AUTH003_CREDENTIAL_HASH_KEY?: string
  AUTH003_CREDENTIAL_HASH_KEY_PREVIOUS?: string
  BETTER_AUTH_SECRET: string
  EMAIL?: {
    send(message: {
      to: string
      from: string
      subject: string
      html: string
      text: string
    }): Promise<unknown>
  }
  PASSWORD_RESET_FROM_EMAIL?: string
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

const MAX_INTERNAL_JSON_BYTES = 64 * 1024

const readJsonBody = async <T>(request: Request): Promise<T | null> => {
  const contentLength = request.headers.get('content-length')
  if (contentLength) {
    const declaredLength = Number(contentLength)
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > MAX_INTERNAL_JSON_BYTES) {
      return null
    }
  }

  if (!request.body) return null

  try {
    const reader = request.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_INTERNAL_JSON_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }

    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }

    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return parsed && typeof parsed === 'object' ? parsed as T : null
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
  async fetch(request: Request, env: Env, executionContext: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    const isW01OnlyInternalRoute =
      url.pathname.startsWith('/internal/auth/') ||
      url.pathname.startsWith('/internal/account/') ||
      url.pathname.startsWith('/internal/authz/')

    if (isW01OnlyInternalRoute && request.headers.get('X-LuckRead-Caller') !== 'W01') {
      return json({ error: { code: 'FORBIDDEN', message: 'internal worker transport required' } }, 403)
    }

    if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
      if (request.headers.get('X-LuckRead-Caller') !== 'W01') {
        return json({ error: { code: 'FORBIDDEN', message: 'authentication gateway required' } }, 403)
      }

      bindExecutionContext(request, executionContext)
      return createLuckReadAuth({
        D1_01: env.D1_01,
        BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
        EMAIL: env.EMAIL,
        PASSWORD_RESET_FROM_EMAIL: env.PASSWORD_RESET_FROM_EMAIL,
      }).handler(request)
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/register') {
      const body = await readJsonBody<{
        identityType: unknown
        identity: unknown
        credential: unknown
        username: unknown
        consent: unknown
        idempotencyKey: unknown
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

    if ((request.method === 'GET' || request.method === 'PATCH') && url.pathname === '/internal/account/profile') {
      if (request.method === 'GET') {
        try {
          return await getAuthenticatedUserProfile(env.D1_01, request, env.BETTER_AUTH_SECRET)
        } catch {
          return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Profile service unavailable' } }, 503)
        }
      }

      const body = await readJsonBody<unknown>(request)
      if (!body) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid profile update' } }, 400)
      }

      return updateAuthenticatedUserProfile(
        env.D1_01,
        request,
        env.BETTER_AUTH_SECRET,
        body,
      )
    }

    if (request.method === 'GET' && url.pathname === '/internal/account/profile/by-id') {
      const userId = new URL(request.url).searchParams.get('id')?.trim() ?? ''
      if (!userId || userId.length > 128) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid user id' } }, 400)
      }
      try {
        return await getPublicUserProfileById(env.D1_01, userId)
      } catch {
        return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Profile service unavailable' } }, 503)
      }
    }

    if (request.method === 'GET' && url.pathname === '/internal/account/profile/by-username') {
      const username = new URL(request.url).searchParams.get('username')?.trim() ?? ''
      if (!username || username.length > 128) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid username' } }, 400)
      }
      try {
        return await getPublicUserProfileByUsername(env.D1_01, username)
      } catch {
        return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Profile service unavailable' } }, 503)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/password/change') {
      const body = await readJsonBody<{
        currentPassword?: unknown
        newPassword?: unknown
      }>(request)

      if (!body || typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string') {
        return json(
          { error: { code: 'VALIDATION_FAILED', message: 'invalid password change request' } },
          400,
        )
      }

      try {
        await changePasswordWithBetterAuth(
          env.D1_01,
          request,
          env.BETTER_AUTH_SECRET,
          {
            currentPassword: body.currentPassword,
            newPassword: body.newPassword,
          },
        )
        return json({ changed: true })
      } catch (error) {
        if (error instanceof PasswordChangeServiceError) {
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
          { error: { code: 'SERVICE_UNAVAILABLE', message: 'Password change service unavailable' } },
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
        const principal = await resolveBetterAuthPrincipal(env.D1_01, request, env.BETTER_AUTH_SECRET)
        if (!principal) return json({ active: false }, 401)

        return json({
          active: true,
          userId: principal.userId,
          email: principal.email,
          sessionId: principal.sessionId,
          accountState: principal.accountState,
          accountStateVersion: principal.accountStateVersion,
          layer: principal.layer,
          ...(principal.tokenVersion !== undefined ? { tokenVersion: principal.tokenVersion } : {}),
        })
      } catch {
        return json({ active: false }, 503)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/admin/authorize') {
      if (request.headers.get('X-LuckRead-Caller') !== 'W01') {
        return json({ allowed: false }, 403)
      }

      const body = await readJsonBody<{ userId?: unknown }>(request)
      if (!body || typeof body.userId !== 'string' || body.userId.length < 1 || body.userId.length > 128) {
        return json({ allowed: false }, 400)
      }

      try {
        const row = await env.D1_01
          .prepare(
            'SELECT account_state AS accountState FROM "user" WHERE CAST(id AS TEXT) = ? LIMIT 1',
          )
          .bind(body.userId)
          .first<{ accountState?: string }>()

        if (!row || (row.accountState !== 'PENDING_VERIFICATION' && row.accountState !== 'ACTIVE')) {
          return json({ allowed: false }, 200)
        }

        const layer = await resolveGlobalLayer(
          env.D1_01,
          body.userId,
          row.accountState,
        )

        return json({
          allowed: layer.decision === 'ALLOW' && (layer.layer === 'L7' || layer.layer === 'L8'),
          layer: layer.layer ?? null,
        })
      } catch {
        return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'authorization service unavailable' } }, 503)
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
          expiresIn: result.expiresIn,
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
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          tokenVersion: result.tokenVersion,
          layer: result.layer,
          nativeExpiresAt: result.nativeExpiresAt,
          expiresIn: result.expiresIn,
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
  },
}
