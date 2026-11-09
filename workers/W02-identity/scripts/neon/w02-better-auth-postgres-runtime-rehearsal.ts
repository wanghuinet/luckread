import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { AccountStateTransitionError } from '../../src/account/account-state-transition.js'
import { handleMfaStatusRequest } from '../../src/auth/mfa-status.js'
import { handleCurrentUserSessionList } from '../../src/auth/session-list.js'
import { handleCurrentUserSessionRevoke } from '../../src/auth/session-revoke.js'
import {
  auth,
  postgresLifecycleAdapters,
  postgresPool,
} from '../../src/auth/neon-postgres-runtime-test.config.js'
import { createPostgresMfaStatusStore } from '../../src/neon/mfa-factor-state-postgres.js'
import { createPostgresSessionListStore } from '../../src/neon/session-list-postgres.js'
import { createPostgresSessionRevocationStore } from '../../src/neon/session-revocation-postgres-store.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workerRoot = path.resolve(scriptDir, '../..')
const reportPath = path.join(workerRoot, 'artifacts/neon/w02-better-auth-postgres-runtime-rehearsal.json')

const withTimeout = async <T>(label: string, action: () => Promise<T>, timeoutMs = 20_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  console.info(JSON.stringify({ event: 'w02.pg.runtime.step.started', step: label }))
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('W02_RUNTIME_STEP_TIMEOUT:' + label)), timeoutMs)
    })
    const result = await Promise.race([action(), timeout])
    console.info(JSON.stringify({ event: 'w02.pg.runtime.step.passed', step: label }))
    return result
  } catch (error) {
    console.error(JSON.stringify({
      event: 'w02.pg.runtime.step.failed',
      step: label,
      errorType: error instanceof Error ? error.name : 'UNKNOWN',
    }))
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const nonce = randomUUID().replaceAll('-', '').slice(0, 18).toLowerCase()
const email = 'w02-pg-' + nonce + '@example.test'
const username = 'w02pg' + nonce
const password = 'W02-Pg-Rehearsal-' + randomUUID().replaceAll('-', '').slice(0, 20)
let userId: string | undefined
const syntheticSessionIds: string[] = []
let signedIn = false
let signedOut = false
let revocationTargetSessionId: string | undefined
let primaryError: unknown
let report: Record<string, unknown> | undefined
let cleanupVerified = false

try {
  const signUp = await withTimeout('sign-up-email', () => auth.api.signUpEmail({
    body: {
      name: 'W02 PostgreSQL Runtime Rehearsal',
      email,
      password,
      username,
    },
    returnHeaders: true,
  }))

  const user = signUp.response.user
  assert.ok(user?.id, 'Better Auth registration must return a persisted user')
  userId = String(user.id)
  assert.equal(user.email, email)
  assert.equal(user.username, username)

  // Better Auth's user-create hook must materialize the canonical L1 role
  // through the PostgreSQL adapter before registration is considered ready.
  const baseRole = await postgresPool.query(
    'SELECT id, role_id AS "roleId", scope_type AS "scopeType", scope_id AS "scopeId", status ' +
      'FROM role_assignments WHERE subject_id = $1 AND id = $2',
    [userId, 'base-user-' + userId],
  )
  assert.equal(baseRole.rowCount, 1, 'registration hook must persist the deterministic L1 role assignment')
  assert.deepEqual(baseRole.rows[0], {
    id: 'base-user-' + userId,
    roleId: 'user',
    scopeType: 'global',
    scopeId: null,
    status: 'ACTIVE',
  })

  const baseRoleVersion = await postgresPool.query<{ roleVersion: number }>(
    'SELECT role_version AS "roleVersion" FROM role_authorization_versions WHERE subject_id = $1',
    [userId],
  )
  assert.equal(baseRoleVersion.rowCount, 1, 'L1 role creation must advance the authorization version')
  assert.equal(Number(baseRoleVersion.rows[0]?.roleVersion), 1)

  const credential = await postgresPool.query(
    'SELECT provider_id, password FROM "account" WHERE user_id = $1 AND provider_id = $2',
    [userId, 'credential'],
  )
  assert.equal(credential.rowCount, 1, 'registration must persist one credential account')
  assert.equal(typeof credential.rows[0]?.password, 'string')
  assert.ok(credential.rows[0].password.length > 20, 'credential hash must be persisted, not a plaintext password')

  // Model the existing W02 registration baseline without bypassing the
  // PostgreSQL activation adapter: this disposable subject starts pending
  // verification and has no L2 assignment or AUTH-013 activation journal.
  const pending = await postgresPool.query(
    'UPDATE "user" SET email_verified = FALSE, account_state = $1, account_state_version = 1 WHERE id = $2',
    ['PENDING_VERIFICATION', userId],
  )
  assert.equal(pending.rowCount, 1, 'test subject must enter the pending-verification baseline')

  await assert.rejects(
    postgresLifecycleAdapters.afterEmailVerified(userId),
    (error: unknown) =>
      error instanceof AccountStateTransitionError && error.code === 'PRECONDITION_FAILED',
    'activation must fail closed before Better Auth email verification is persisted',
  )

  const rejectedActivation = await postgresPool.query(
    'SELECT account_state AS "accountState", account_state_version AS "accountStateVersion" ' +
      'FROM "user" WHERE id = $1',
    [userId],
  )
  assert.equal(rejectedActivation.rows[0]?.accountState, 'PENDING_VERIFICATION')
  assert.equal(Number(rejectedActivation.rows[0]?.accountStateVersion), 1)

  const verificationAt = new Date().toISOString()
  const verified = await postgresPool.query(
    'UPDATE "user" SET email_verified = TRUE WHERE id = $1',
    [userId],
  )
  assert.equal(verified.rowCount, 1, 'verified flag must be persisted before lifecycle activation')

  // Exercise the same injected callback used as Better Auth's
  // afterEmailVerification hook. Two concurrent deliveries must converge on
  // one account-state transition, one verified_user role and one AUTH-013 journal event.
  const activations = await withTimeout('email-verification-activation-concurrency', () =>
    Promise.all([
      postgresLifecycleAdapters.afterEmailVerified(userId!, verificationAt),
      postgresLifecycleAdapters.afterEmailVerified(userId!, verificationAt),
    ]),
  )
  assert.equal(activations.filter((result) => result.activated).length, 1)
  assert.equal(activations.filter((result) => !result.activated).length, 1)
  assert.ok(activations.every((result) => result.accountState === 'ACTIVE'))
  assert.ok(activations.every((result) => result.accountStateVersion === 2))

  const activationReplay = await withTimeout('email-verification-activation-replay', () =>
    postgresLifecycleAdapters.afterEmailVerified(userId!, verificationAt),
  )
  assert.equal(activationReplay.activated, false)
  assert.equal(activationReplay.accountState, 'ACTIVE')
  assert.equal(activationReplay.accountStateVersion, 2)

  const account = await postgresPool.query(
    'SELECT account_state AS "accountState", account_state_version AS "accountStateVersion", email_verified AS "emailVerified" ' +
      'FROM "user" WHERE id = $1',
    [userId],
  )
  assert.equal(account.rows[0]?.accountState, 'ACTIVE')
  assert.equal(Number(account.rows[0]?.accountStateVersion), 2)
  assert.equal(account.rows[0]?.emailVerified, true)

  const role = await postgresPool.query(
    'SELECT id, role_id AS "roleId", scope_type AS "scopeType", scope_id AS "scopeId", status ' +
      'FROM role_assignments WHERE subject_id = $1 AND id = $2',
    [userId, 'verified-user-' + userId],
  )
  assert.equal(role.rowCount, 1, 'activation must persist the deterministic L2 role assignment')
  assert.deepEqual(role.rows[0], {
    id: 'verified-user-' + userId,
    roleId: 'verified_user',
    scopeType: 'global',
    scopeId: null,
    status: 'ACTIVE',
  })

  const roleVersion = await postgresPool.query<{ roleVersion: number }>(
    'SELECT role_version AS "roleVersion" FROM role_authorization_versions WHERE subject_id = $1',
    [userId],
  )
  assert.equal(roleVersion.rowCount, 1, 'existing authorization-version trigger must observe the L2 grant')
  assert.equal(
    Number(roleVersion.rows[0]?.roleVersion),
    2,
    'the L1 registration hook and L2 verification hook must each advance the canonical role version once',
  )

  const journal = await postgresPool.query<{ eventId: string; sourceVersion: number; status: string; payload: string }>(
    'SELECT event_id AS "eventId", source_version AS "sourceVersion", status, payload ' +
      'FROM auth_013_publication_journal WHERE resource_id = $1 AND event_type = $2',
    [userId, 'identity.account_state_changed'],
  )
  assert.equal(journal.rowCount, 1, 'concurrent activation must create exactly one AUTH-013 journal row')
  assert.equal(journal.rows[0]?.sourceVersion, 2)
  assert.equal(journal.rows[0]?.status, 'PENDING')
  const event = JSON.parse(journal.rows[0]?.payload ?? '{}')
  assert.deepEqual(event, {
    eventId: journal.rows[0]?.eventId,
    eventType: 'identity.account_state_changed',
    schemaVersion: '1.0',
    producer: 'W02',
    resourceType: 'User',
    resourceId: userId,
    occurredAt: verificationAt,
    publishedAt: verificationAt,
    correlationId: journal.rows[0]?.eventId,
    causationId: journal.rows[0]?.eventId,
    idempotencyKey: 'auth013-' + userId + '-1',
    attempt: 1,
    sourceVersion: 2,
    actor: { actorId: userId, actorType: 'user' },
    before: { accountState: 'PENDING_VERIFICATION', accountStateVersion: 1 },
    after: { accountState: 'ACTIVE', accountStateVersion: 2 },
    reason: 'email_verified',
  })

  const signIn = await withTimeout('sign-in-email', () => auth.api.signInEmail({
    body: { email, password, rememberMe: true },
    returnHeaders: true,
  }))
  assert.equal(signIn.response.user.id, userId)
  assert.equal(typeof signIn.response.token, 'string')
  assert.ok(signIn.response.token.length > 20)
  signedIn = true

  const headerSource = signIn.headers as Headers & { getSetCookie?: () => string[] }
  const setCookies = headerSource.getSetCookie?.() ?? [signIn.headers.get('set-cookie') ?? '']
  const cookieHeader = setCookies
    .map((value) => value.split(';', 1)[0])
    .filter((value) => value.includes('='))
    .join('; ')
  assert.ok(cookieHeader.length > 0, 'sign-in must issue a session cookie')

  const sessionHeaders = new Headers({ cookie: cookieHeader })
  const session = await withTimeout('get-session', () => auth.api.getSession({ headers: sessionHeaders }))
  assert.equal(session?.user.id, userId, 'Better Auth must read the PostgreSQL-backed session')
  if (!session?.session || typeof session.session.id !== 'string') {
    throw new Error('W02_PG_RUNTIME_SESSION_ID_MISSING')
  }
  const currentSessionId = session.session.id

  const sessionRows = await postgresPool.query(
    'SELECT COUNT(*)::integer AS count FROM "session" WHERE user_id = $1',
    [userId],
  )
  assert.equal(Number(sessionRows.rows[0]?.count), 1, 'sign-in must persist exactly one session')

  // Exercise the private W01 -> W02 MFA status handler with a PostgreSQL
  // read store and a real Better Auth PostgreSQL session. The response is
  // restricted to the public status DTO and does not touch D1.
  const mfaStatusEnv = {
    D1_01: undefined as unknown as D1Database,
  } as Parameters<typeof handleMfaStatusRequest>[0]
  const mfaStatusRequest = new Request(
    'https://luckread-w02.internal/internal/auth/mfa/status',
    {
      method: 'POST',
      headers: {
        cookie: cookieHeader,
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
      },
    },
  )
  const mfaStatusStore = createPostgresMfaStatusStore(postgresPool)
  const mfaStatusResponse = await withTimeout('auth007-postgres-mfa-status-handler', () =>
    handleMfaStatusRequest(mfaStatusEnv, mfaStatusRequest, {
      store: mfaStatusStore,
      resolvePrincipal: async (_env, request) => {
        const activeSession = await auth.api.getSession({ headers: request.headers, query: {} })
        if (!activeSession?.user?.id) return null
        return {
          userId: String(activeSession.user.id),
          accountState: String(activeSession.user.accountState ?? 'PENDING_VERIFICATION'),
        }
      },
    }),
  )
  assert.equal(mfaStatusResponse.status, 200, 'PostgreSQL MFA status handler must succeed')
  const mfaStatusPayload = await mfaStatusResponse.json() as {
    data: { enabled: boolean; verified: boolean; enrolledAt: string | null }
  }
  assert.deepEqual(mfaStatusPayload, {
    data: { enabled: false, verified: false, enrolledAt: null },
  })
  assert.deepEqual(Object.keys(mfaStatusPayload.data).sort(), ['enabled', 'enrolledAt', 'verified'])
  assert.ok(!JSON.stringify(mfaStatusPayload).match(/secret|backup|recovery|lockedUntil|lastAccepted/i))

  // Add two disposable native Better Auth session rows with deterministic
  // timestamps so the PostgreSQL-backed endpoint can prove keyset paging.
  const sessionListNow = new Date().toISOString()
  const fixtureBase = Date.parse(sessionListNow) + 2_000
  for (const [index, offset] of [2_000, 1_000].entries()) {
    const fixtureId = 'session-list-' + nonce + '-' + index
    syntheticSessionIds.push(fixtureId)
    const createdAt = new Date(fixtureBase - (2_000 - offset)).toISOString().slice(0, 19) +
      (index === 0 ? '.654321Z' : '.123456Z')
    const expiresAt = new Date(Date.parse(sessionListNow) + 24 * 60 * 60 * 1000).toISOString()
    await postgresPool.query(
      'INSERT INTO "session" (id, expires_at, token, created_at, updated_at, user_id) ' +
        'VALUES ($1, $2, $3, $4, $4, $5)',
      [fixtureId, expiresAt, 'session-list-token-' + nonce + '-' + index, createdAt, userId],
    )
  }

  const expiredSessionId = 'session-list-expired-' + nonce
  syntheticSessionIds.push(expiredSessionId)
  const expiredCreatedAt = new Date(Date.parse(sessionListNow) - 120_000).toISOString()
  const expiredAt = new Date(Date.parse(sessionListNow) - 60_000).toISOString()
  await postgresPool.query(
    'INSERT INTO "session" (id, expires_at, token, created_at, updated_at, user_id) ' +
      'VALUES ($1, $2, $3, $4, $4, $5)',
    [
      expiredSessionId,
      expiredAt,
      'session-list-token-expired-' + nonce,
      expiredCreatedAt,
      userId,
    ],
  )

  const sessionListEnv = {
    D1_01: undefined as unknown as D1Database,
    AUTH_SESSION_READ_LIMITER: {
      limit: async (_input: { key: string }) => ({ success: true }),
    },
  }
  const sessionListStore = createPostgresSessionListStore(postgresPool)
  const sessionListRequest = (body: unknown) => new Request(
    'https://luckread-w02.internal/internal/auth/session/list',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieHeader },
      body: JSON.stringify(body),
    },
  )
  const firstPageResponse = await withTimeout('auth010-postgres-session-list-first-page', () =>
    handleCurrentUserSessionList(sessionListEnv, sessionListRequest({ limit: 2 }), {
      store: sessionListStore,
      getSession: (headers) => auth.api.getSession({ headers, query: {} }) as Promise<{
        user?: { id?: unknown }
        session?: { id?: unknown }
      } | null>,
    }),
  )
  const firstPage = await firstPageResponse.json() as {
    items: Array<{ sessionId: string; createdAt: string; expiresAt: string; lastSeenAt: null }>
    currentSessionId: string
    nextCursor: string | null
  }
  assert.equal(firstPageResponse.status, 200, 'PostgreSQL session list first page must succeed')
  assert.deepEqual(firstPage.items.map((item) => item.sessionId), syntheticSessionIds.slice(0, 2))
  assert.ok(!firstPage.items.some((item) => item.sessionId === expiredSessionId))
  assert.ok(firstPage.items[0]?.createdAt.endsWith('.654321Z'))
  assert.ok(firstPage.items[1]?.createdAt.endsWith('.123456Z'))
  assert.equal(firstPage.currentSessionId, currentSessionId)
  assert.ok(firstPage.nextCursor?.startsWith('s1.'), 'first page must return a keyset cursor')
  assert.ok(firstPage.items.every((item) =>
    !Object.hasOwn(item, 'token') && !Object.hasOwn(item, 'userId'),
  ), 'session list must not project credentials or account ownership fields')
  assert.ok(!JSON.stringify(firstPage).includes('session-list-token-' + nonce))

  const secondPageResponse = await withTimeout('auth010-postgres-session-list-next-page', () =>
    handleCurrentUserSessionList(sessionListEnv, sessionListRequest({
      limit: 2,
      cursor: firstPage.nextCursor,
    }), {
      store: sessionListStore,
      getSession: (headers) => auth.api.getSession({ headers, query: {} }) as Promise<{
        user?: { id?: unknown }
        session?: { id?: unknown }
      } | null>,
    }),
  )
  const secondPage = await secondPageResponse.json() as {
    items: Array<{ sessionId: string }>
    currentSessionId: string
    nextCursor: string | null
  }
  assert.equal(secondPageResponse.status, 200)
  assert.deepEqual(secondPage.items.map((item) => item.sessionId), [currentSessionId])
  assert.equal(secondPage.currentSessionId, currentSessionId)
  assert.equal(secondPage.nextCursor, null)

  const missingAccount = await sessionListStore.list({
    userId: 'missing-session-owner-' + nonce,
    now: sessionListNow,
    limit: 2,
    cursor: null,
  })
  assert.equal(missingAccount.permissionGranted, false)
  assert.deepEqual(missingAccount.rows, [])

  await postgresPool.query('DELETE FROM "session" WHERE id = ANY($1::text[])', [syntheticSessionIds])
  syntheticSessionIds.length = 0

  // Exercise the full revoke HTTP handler through the injected PostgreSQL
  // command store. The caller's native Better Auth session must remain valid,
  // while the target session and durable AUTH-010 journal change atomically.
  revocationTargetSessionId = 'session-revoke-target-' + nonce
  syntheticSessionIds.push(revocationTargetSessionId)
  const revokeCreatedAt = new Date().toISOString()
  const revokeExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  await postgresPool.query(
    'INSERT INTO "session" (id, expires_at, token, created_at, updated_at, user_id) ' +
      'VALUES ($1, $2, $3, $4, $4, $5)',
    [
      revocationTargetSessionId,
      revokeExpiresAt,
      'session-revoke-token-' + nonce,
      revokeCreatedAt,
      userId,
    ],
  )

  const sessionRevokeEnv = {
    D1_01: undefined as unknown as D1Database,
    AUTH_SESSION_WRITE_LIMITER: {
      limit: async (_input: { key: string }) => ({ success: true }),
    },
  }
  const sessionRevokeStore = createPostgresSessionRevocationStore(postgresPool)
  const sessionRevokeRequest = () => new Request(
    'https://luckread-w02.internal/internal/auth/session/revoke-by-id',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookieHeader,
        'X-LuckRead-Request-Id': 'req_auth010_revoke_' + nonce,
        'X-LuckRead-Correlation-Id': 'auth010-revoke-trace-' + nonce,
      },
      body: JSON.stringify({ sessionId: revocationTargetSessionId }),
    },
  )
  const sessionRevokeDependencies = {
    store: sessionRevokeStore,
    getSession: (headers: Headers) => auth.api.getSession({ headers, query: {} }) as Promise<{
      user?: { id?: unknown }
      session?: { id?: unknown }
    } | null>,
  }
  const revokeResponse = await withTimeout('auth010-postgres-session-revoke-handler', () =>
    handleCurrentUserSessionRevoke(sessionRevokeEnv, sessionRevokeRequest(), sessionRevokeDependencies),
  )
  assert.equal(revokeResponse.status, 200, 'PostgreSQL session revocation handler must succeed')
  assert.deepEqual(await revokeResponse.json(), { revoked: true })

  const revokedTarget = await postgresPool.query(
    'SELECT COUNT(*)::integer AS count FROM "session" WHERE id = $1 AND user_id = $2',
    [revocationTargetSessionId, userId],
  )
  assert.equal(Number(revokedTarget.rows[0]?.count), 0, 'target session must be deleted by the command transaction')

  const revokeJournal = await postgresPool.query<{ payload: string }>(
    'SELECT payload FROM auth_010_session_revocation_journal ' +
      'WHERE resource_id = $1 AND event_type = $2',
    [revocationTargetSessionId, 'user.session.revoked'],
  )
  assert.equal(revokeJournal.rowCount, 1, 'session delete must commit exactly one AUTH-010 audit row')
  const revokeEvent = JSON.parse(revokeJournal.rows[0]?.payload ?? '{}')
  assert.equal(revokeEvent.actor.actorId, userId)
  assert.equal(revokeEvent.resourceId, revocationTargetSessionId)
  assert.equal(revokeEvent.payload.operationId, 'authSessionRevoke')
  assert.equal(revokeEvent.payload.reasonCode, 'USER_INITIATED')
  assert.equal(revokeEvent.correlationId, 'req_auth010_revoke_' + nonce)
  assert.ok(!JSON.stringify(revokeEvent).includes('session-revoke-token-' + nonce))

  const revokeReplayResponse = await withTimeout('auth010-postgres-session-revoke-replay', () =>
    handleCurrentUserSessionRevoke(sessionRevokeEnv, sessionRevokeRequest(), sessionRevokeDependencies),
  )
  assert.equal(revokeReplayResponse.status, 200)
  assert.deepEqual(await revokeReplayResponse.json(), { revoked: true })
  const revokeReplayJournal = await postgresPool.query(
    'SELECT COUNT(*)::integer AS count FROM auth_010_session_revocation_journal ' +
      'WHERE resource_id = $1 AND event_type = $2',
    [revocationTargetSessionId, 'user.session.revoked'],
  )
  assert.equal(Number(revokeReplayJournal.rows[0]?.count), 1, 'retry must not create a second logical event')

  const currentSessionAfterRevoke = await auth.api.getSession({ headers: sessionHeaders })
  assert.equal(currentSessionAfterRevoke?.session.id, currentSessionId, 'revoking another session must preserve the caller session')

  await withTimeout('sign-out', () => auth.api.signOut({ headers: sessionHeaders }))
  signedOut = true
  const revokedSession = await withTimeout(
    'verify-session-revoked',
    () => auth.api.getSession({ headers: sessionHeaders }),
  )
  assert.equal(revokedSession, null, 'sign-out must revoke the PostgreSQL-backed session')

  const afterSignOut = await postgresPool.query(
    'SELECT COUNT(*)::integer AS count FROM "session" WHERE user_id = $1',
    [userId],
  )
  assert.equal(Number(afterSignOut.rows[0]?.count), 0)

  report = {
    reportVersion: 4,
    status: 'W02_BETTER_AUTH_POSTGRES_RUNTIME_REHEARSAL_PASS',
    scope: 'Better Auth core PostgreSQL runtime, L1/L2 role materialization, AUTH-013 email-verification activation and journal, AUTH-007 MFA status read handler, and AUTH-010 PostgreSQL session-list and session-revocation HTTP adapters; D1 production remains authoritative.',
    betterAuthVersion: '1.7.8',
    adapter: 'Better Auth native PostgreSQL dialect via pg.Pool plus W02 PostgreSQL identity lifecycle, AUTH-007 MFA status, AUTH-010 session-list and atomic session-revocation adapters',
    operationsVerified: [
      'SIGN_UP_EMAIL',
      'BASE_USER_L1_ROLE_PERSISTED',
      'AUTHZ_ROLE_VERSION_ADVANCED_ON_REGISTRATION',
      'CREDENTIAL_ACCOUNT_PERSISTED',
      'EMAIL_VERIFICATION_REQUIRED',
      'EMAIL_VERIFICATION_ACTIVATION_PRECONDITION',
      'EMAIL_VERIFICATION_ACTIVATION',
      'VERIFIED_USER_L2_ROLE_PERSISTED',
      'AUTH013_PUBLICATION_JOURNAL_PERSISTED',
      'CONCURRENT_ACTIVATION_IDEMPOTENCY',
      'SIGN_IN_EMAIL',
      'SESSION_PERSISTED',
      'GET_SESSION',
      'AUTH007_MFA_STATUS_HTTP_HANDLER',
      'AUTH007_MFA_STATUS_SECRET_FREE_PROJECTION',
      'AUTH010_SESSION_LIST_FIRST_PAGE',
      'AUTH010_SESSION_LIST_KEYSET_PAGINATION',
      'AUTH010_SESSION_LIST_NO_SECRET_PROJECTION',
      'AUTH010_SESSION_LIST_UNAUTHORIZED_SUBJECT',
      'AUTH010_SESSION_REVOKE_HTTP_HANDLER',
      'AUTH010_SESSION_REVOKE_ATOMIC_AUDIT',
      'AUTH010_SESSION_REVOKE_IDEMPOTENT_REPLAY',
      'SIGN_OUT',
      'SESSION_REVOKED',
    ],
    signedUp: true,
    activationConcurrencyWinners: activations.filter((result) => result.activated).length,
    activationReplaySafe: !activationReplay.activated,
    signedIn,
    signedOut,
    testUserRowsRemaining: 0,
    productionAuthorityChanged: false,
    neonConnectionAttempted: false,
    cloudflareD1Touched: false,
    workerBindingsChanged: false,
    businessDataImported: false,
  }

} catch (error) {
  primaryError = error
} finally {
  let cleanupUserId = userId
  try {
    if (!cleanupUserId) {
      const byEmail = await postgresPool.query(
        'SELECT id FROM "user" WHERE email = $1 LIMIT 1',
        [email],
      )
      if (typeof byEmail.rows[0]?.id === 'string') cleanupUserId = byEmail.rows[0].id
    }

    await postgresPool.query('DELETE FROM "verification" WHERE identifier = $1', [email])
    if (syntheticSessionIds.length > 0) {
      await postgresPool.query(
        'DELETE FROM auth_010_session_revocation_journal WHERE resource_id = ANY($1::text[])',
        [syntheticSessionIds],
      )
      await postgresPool.query('DELETE FROM "session" WHERE id = ANY($1::text[])', [syntheticSessionIds])
      syntheticSessionIds.length = 0
    }
    if (cleanupUserId) {
      await postgresPool.query(
        'DELETE FROM auth_013_publication_journal WHERE resource_id = $1',
        [cleanupUserId],
      )
      await postgresPool.query('DELETE FROM "session" WHERE user_id = $1', [cleanupUserId])
      await postgresPool.query('DELETE FROM "account" WHERE user_id = $1', [cleanupUserId])
      await postgresPool.query('DELETE FROM role_assignments WHERE subject_id = $1', [cleanupUserId])
      await postgresPool.query('DELETE FROM role_authorization_versions WHERE subject_id = $1', [cleanupUserId])
      await postgresPool.query('DELETE FROM "user" WHERE id = $1', [cleanupUserId])
    }

    const remaining = await postgresPool.query(
      `SELECT
        (SELECT COUNT(*) FROM "user" WHERE email = $1) AS users,
        (SELECT COUNT(*) FROM "account" WHERE user_id = COALESCE($2, '')) AS accounts,
        (SELECT COUNT(*) FROM "session" WHERE user_id = COALESCE($2, '')) AS sessions,
        (SELECT COUNT(*) FROM "verification" WHERE identifier = $1) AS verifications,
        (SELECT COUNT(*) FROM auth_013_publication_journal WHERE resource_id = COALESCE($2, '')) AS journals,
        (SELECT COUNT(*) FROM role_assignments WHERE subject_id = COALESCE($2, '')) AS role_assignments,
        (SELECT COUNT(*) FROM role_authorization_versions WHERE subject_id = COALESCE($2, '')) AS role_versions,
        (SELECT COUNT(*) FROM auth_010_session_revocation_journal WHERE resource_id = COALESCE($3, '')) AS session_revocation_journals`,
      [email, cleanupUserId ?? null, revocationTargetSessionId ?? null],
    )
    if (Object.values(remaining.rows[0] ?? {}).some((value) => Number(value) !== 0)) {
      throw new Error('W02_RUNTIME_SYNTHETIC_CLEANUP_FAILED')
    }
    cleanupVerified = true
  } catch (cleanupError) {
    if (!primaryError) primaryError = cleanupError
  }

  try {
    await postgresPool.end()
  } catch (poolError) {
    if (!primaryError) primaryError = poolError
  }
}

if (primaryError) throw primaryError
if (!report) throw new Error('W02_RUNTIME_REHEARSAL_REPORT_NOT_CREATED')
if (!cleanupVerified) throw new Error('W02_RUNTIME_REHEARSAL_CLEANUP_NOT_VERIFIED')

mkdirSync(path.dirname(reportPath), { recursive: true })
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
process.stdout.write(JSON.stringify(report, null, 2) + '\n')
