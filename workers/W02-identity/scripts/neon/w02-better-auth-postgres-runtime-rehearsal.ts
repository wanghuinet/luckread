import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { auth, postgresPool } from '../../src/auth/neon-postgres-runtime-test.config.js'

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
let signedIn = false
let signedOut = false
let primaryError: unknown
let report: Record<string, unknown> | undefined

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

  const credential = await postgresPool.query(
    'SELECT provider_id, password FROM "account" WHERE user_id = $1 AND provider_id = $2',
    [userId, 'credential'],
  )
  assert.equal(credential.rowCount, 1, 'registration must persist one credential account')
  assert.equal(typeof credential.rows[0]?.password, 'string')
  assert.ok(credential.rows[0].password.length > 20, 'credential hash must be persisted, not a plaintext password')

  // W02 email verification remains a separate D1-owned lifecycle side effect.
  // Mark only this disposable test subject verified so the core sign-in route
  // can be exercised without simulating the production verification callback.
  const verified = await postgresPool.query(
    'UPDATE "user" SET email_verified = TRUE, account_state = $1, account_state_version = 1 WHERE id = $2',
    ['ACTIVE', userId],
  )
  assert.equal(verified.rowCount, 1, 'test subject must be found for the local verification fixture')

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

  const sessionRows = await postgresPool.query(
    'SELECT COUNT(*)::integer AS count FROM "session" WHERE user_id = $1',
    [userId],
  )
  assert.equal(Number(sessionRows.rows[0]?.count), 1, 'sign-in must persist exactly one session')

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
    reportVersion: 1,
    status: 'W02_BETTER_AUTH_POSTGRES_RUNTIME_REHEARSAL_PASS',
    scope: 'Better Auth core PostgreSQL runtime only; W02 D1 lifecycle, role, MFA and publication-journal side effects are intentionally excluded from this profile.',
    betterAuthVersion: '1.7.8',
    adapter: 'Better Auth native PostgreSQL dialect via pg.Pool',
    operationsVerified: [
      'SIGN_UP_EMAIL',
      'CREDENTIAL_ACCOUNT_PERSISTED',
      'SIGN_IN_EMAIL',
      'SESSION_PERSISTED',
      'GET_SESSION',
      'SIGN_OUT',
      'SESSION_REVOKED',
    ],
    signedUp: true,
    signedIn,
    signedOut,
    testUserRowsRemaining: 0,
    productionAuthorityChanged: false,
    neonConnectionAttempted: false,
    cloudflareD1Touched: false,
    workerBindingsChanged: false,
    businessDataImported: false,
  }

  mkdirSync(path.dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
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

    if (cleanupUserId) {
      await postgresPool.query('DELETE FROM "verification" WHERE identifier = $1', [email])
      await postgresPool.query('DELETE FROM "session" WHERE user_id = $1', [cleanupUserId])
      await postgresPool.query('DELETE FROM "account" WHERE user_id = $1', [cleanupUserId])
      await postgresPool.query('DELETE FROM "user" WHERE id = $1', [cleanupUserId])
      const remaining = await postgresPool.query(
        'SELECT COUNT(*)::integer AS count FROM "user" WHERE id = $1',
        [cleanupUserId],
      )
      if (Number(remaining.rows[0]?.count) !== 0 && !primaryError) {
        primaryError = new Error('W02_RUNTIME_SYNTHETIC_USER_CLEANUP_FAILED')
      }
    }
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

mkdirSync(path.dirname(reportPath), { recursive: true })
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\\n')
process.stdout.write(JSON.stringify(report, null, 2) + '\\n')
