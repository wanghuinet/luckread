import { createLuckReadAuth } from './auth/better-auth.js'
import { resolveBetterAuthPrincipal } from './auth/principal.js'
import { publishPendingAccountStateEvents } from './account/publication-journal-publisher.js'
import { reconcileCompletedRegistrationMaterialization } from './account/registration-materializer.js'
import { resolveGlobalLayer } from './authz/role-assignment.js'
import {
  AccountStateTransitionError,
  applyAccountStateTransition,
  authorizeAccountStateTransition,
  type AccountState,
} from './account/account-state-transition.js'

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
          username: principal.username,
          sessionId: principal.sessionId,
          accountState: principal.accountState,
          accountStateVersion: principal.accountStateVersion,
          layer: principal.layer,
        })
      } catch {
        return json({ active: false }, 503)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/session/list') {
      try {
        const auth = createLuckReadAuth({ D1_01: env.D1_01 })
        const principal = await resolveBetterAuthPrincipal(env.D1_01, request)
        if (!principal) return json({ error: { code: 'UNAUTHENTICATED', message: 'authentication required' } }, 401)

        const raw = await auth.api.listSessions({ headers: request.headers }) as unknown
        const sessions = Array.isArray(raw)
          ? raw
          : raw && typeof raw === 'object' && 'sessions' in raw && Array.isArray((raw as { sessions?: unknown }).sessions)
            ? (raw as { sessions: unknown[] }).sessions
            : []

        const rows = sessions
          .map((value) => {
            if (!value || typeof value !== 'object') return null
            const row = value as Record<string, unknown>
            const sessionId = typeof row.id === 'string' ? row.id : typeof row.token === 'string' ? row.token : null
            if (!sessionId || typeof row.expiresAt !== 'string' || typeof row.createdAt !== 'string') return null
            return {
              sessionId,
              deviceId: typeof row.userAgent === 'string' ? row.userAgent.slice(0, 128) : null,
              createdAt: row.createdAt,
              expiresAt: row.expiresAt,
              lastSeenAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
            }
          })
          .filter((value): value is {
            sessionId: string
            deviceId: string | null
            createdAt: string
            expiresAt: string
            lastSeenAt: string | null
          } => value !== null)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.sessionId.localeCompare(a.sessionId))

        const cursor = (() => {
          const value = new URL(request.url).searchParams.get('cursor')
          if (!value) return null
          try {
            const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
            const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
            const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)))) as {
              createdAt?: unknown
              sessionId?: unknown
            }
            if (typeof parsed.createdAt !== 'string' || typeof parsed.sessionId !== 'string') return null
            return { createdAt: parsed.createdAt, sessionId: parsed.sessionId }
          } catch {
            return null
          }
        })()

        const limitRaw = new URL(request.url).searchParams.get('limit')
        const limit = limitRaw === null ? 50 : Number(limitRaw)
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
          return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid session list request' } }, 400)
        }

        const filtered = cursor
          ? rows.filter((row) => row.createdAt < cursor.createdAt || (row.createdAt === cursor.createdAt && row.sessionId < cursor.sessionId))
          : rows
        const page = filtered.slice(0, Math.min(limit, 50))
        const last = page.at(-1)
        const hasMore = filtered.length > page.length
        const nextCursor = hasMore && last
          ? (() => {
              const bytes = new TextEncoder().encode(JSON.stringify({ createdAt: last.createdAt, sessionId: last.sessionId }))
              let binary = ''
              for (const byte of bytes) binary += String.fromCharCode(byte)
              return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
            })()
          : null

        return json({
          items: page,
          nextCursor,
          currentSessionId: principal.sessionId,
        })
      } catch {
        return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'session service unavailable' } }, 503)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/session/revoke-owned') {
      const body = await readJsonBody<{ targetSessionId?: unknown }>(request)
      if (!body || typeof body.targetSessionId !== 'string' || body.targetSessionId.length < 1 || body.targetSessionId.length > 256) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid session revoke request' } }, 400)
      }

      try {
        const principal = await resolveBetterAuthPrincipal(env.D1_01, request)
        if (!principal) return json({ error: { code: 'UNAUTHENTICATED', message: 'authentication required' } }, 401)

        const target = await env.D1_01.prepare(
          `SELECT token FROM "session" WHERE id = ? AND user_id = ? AND expires_at > ? LIMIT 1`,
        ).bind(body.targetSessionId, principal.userId, new Date().toISOString()).first<{ token?: unknown }>()

        if (!target || typeof target.token !== 'string' || !target.token) {
          return json({ error: { code: 'NOT_FOUND', message: 'session not found' } }, 404)
        }

        const auth = createLuckReadAuth({ D1_01: env.D1_01 })
        await auth.api.revokeSession({
          headers: request.headers,
          body: { token: target.token },
        })

        return json({ revoked: true })
      } catch (error) {
        if (error instanceof Error && /unauthenticated|session/i.test(error.message)) {
          return json({ error: { code: 'UNAUTHENTICATED', message: 'authentication required' } }, 401)
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
