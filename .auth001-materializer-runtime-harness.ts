// CI-only ephemeral harness; never deployed as a product Worker.
// @ts-nocheck
import { reconcileCompletedRegistrationMaterialization } from './workers/W02-content/src/account/registration-materializer.ts'

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
})

const sha256Hex = async (value) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

const scalar = async (db, sql, args) => db.prepare(sql).bind(...args).first()

export default {
  async fetch(request, env) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/probe') {
      return new Response(null, { status: 404 })
    }
    if (request.headers.get('x-auth001-probe-token') !== env.PROBE_TOKEN) {
      return json({ status: 'DENY' }, 403)
    }

    const db = env.D1_01
    const suffix = String(env.RUN_ID).replace(/[^0-9]/g, '')
    const email = 'auth001-materializer-' + suffix + '@example.invalid'
    const username = 'auth001m_' + suffix
    const envelopeId = 'auth001-envelope-' + suffix
    const idempotencyKey = 'auth001-materializer-' + suffix
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 3600000).toISOString()
    let userId = null

    const cleanup = async () => {
      if (!userId) {
        const row = await scalar(db, 'SELECT id FROM users WHERE email = ? LIMIT 1', [email])
        userId = row && row.id != null ? String(row.id) : null
      }
      if (userId) {
        await db.prepare('DELETE FROM auth_credentials WHERE identity_id IN (SELECT id FROM auth_identities WHERE user_id = ?)').bind(userId).run()
        await db.prepare('DELETE FROM auth_identities WHERE user_id = ?').bind(userId).run()
      }
      await db.prepare('DELETE FROM auth_registration_envelopes WHERE id = ?').bind(envelopeId).run()
      if (userId) {
        await db.prepare('DELETE FROM users WHERE CAST(id AS TEXT) = ?').bind(userId).run()
      }
      const left = await scalar(
        db,
        'SELECT ' +
        '(SELECT COUNT(*) FROM auth_registration_envelopes WHERE id = ?) AS e, ' +
        '(SELECT COUNT(*) FROM users WHERE email = ?) AS u, ' +
        '(SELECT COUNT(*) FROM auth_identities WHERE user_id = ?) AS i',
        [envelopeId, email, userId || ''],
      )
      if (Number(left && left.e) !== 0 || Number(left && left.u) !== 0 || Number(left && left.i) !== 0) {
        throw new Error('AUTH001_MATERIALIZER_FIXTURE_CLEANUP_FAILED')
      }
    }

    try {
      const collision = await scalar(
        db,
        'SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1',
        [email, username],
      )
      if (collision) return json({ status: 'FAIL_CLOSED', reason: 'synthetic_collision' }, 409)

      await db.prepare(
        'INSERT INTO users (email, username, salt, hash, display_name, bio, avatar, locale, timezone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        email,
        username,
        'auth001-materializer-synthetic-salt',
        'auth001-materializer-synthetic-hash',
        'AUTH-001 evidence synthetic user',
        null,
        null,
        'en-US',
        'UTC',
      ).run()

      const user = await scalar(
        db,
        'SELECT id FROM users WHERE email = ? AND username = ? LIMIT 1',
        [email, username],
      )
      if (!user || user.id == null) throw new Error('AUTH001_MATERIALIZER_SYNTHETIC_USER_MISSING')
      userId = String(user.id)

      await db.prepare(
        'INSERT INTO auth_registration_envelopes ' +
        '(id, idempotency_key, active_key, scope, endpoint, payload_hash, state, response_digest, committed_response, expires_at, consent_record_id, updated_at, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)',
      ).bind(
        envelopeId,
        idempotencyKey,
        idempotencyKey,
        'ACCOUNT_REGISTRATION',
        'authRegister',
        await sha256Hex('payload-' + suffix),
        'COMPLETED',
        await sha256Hex('response-' + suffix),
        JSON.stringify({ userId: userId, accountState: 'PENDING_VERIFICATION' }),
        expiresAt,
        now.toISOString(),
        now.toISOString(),
      ).run()

      const before = await scalar(
        db,
        'SELECT ' +
        '(SELECT COUNT(*) FROM auth_identities WHERE user_id = ?) AS i, ' +
        '(SELECT COUNT(*) FROM auth_credentials WHERE identity_id IN (SELECT id FROM auth_identities WHERE user_id = ?)) AS c',
        [userId, userId],
      )

      const missingKey = await reconcileCompletedRegistrationMaterialization(db, {}, now.toISOString())
        .then(
          () => ({ code: 'UNEXPECTED_SUCCESS' }),
          (error) => ({ code: error && error.code ? error.code : 'UNKNOWN' }),
        )

      const afterMissingKey = await scalar(
        db,
        'SELECT ' +
        '(SELECT COUNT(*) FROM auth_identities WHERE user_id = ?) AS i, ' +
        '(SELECT COUNT(*) FROM auth_credentials WHERE identity_id IN (SELECT id FROM auth_identities WHERE user_id = ?)) AS c',
        [userId, userId],
      )

      const first = await reconcileCompletedRegistrationMaterialization(
        db,
        { AUTH003_CREDENTIAL_HASH_KEY: env.AUTH003_CREDENTIAL_HASH_KEY },
        new Date().toISOString(),
      )

      const identity = await scalar(
        db,
        'SELECT id, user_id, username, username_normalized, email, email_normalized, normalization_version FROM auth_identities WHERE user_id = ? LIMIT 1',
        [userId],
      )

      const credentials = await db.prepare(
        'SELECT kind, normalized_value, active, value_hash FROM auth_credentials WHERE identity_id = ? ORDER BY kind ASC',
      ).bind(identity && identity.id ? identity.id : '').all()

      const afterFirst = await scalar(
        db,
        'SELECT ' +
        '(SELECT COUNT(*) FROM auth_identities WHERE user_id = ?) AS i, ' +
        '(SELECT COUNT(*) FROM auth_credentials WHERE identity_id IN (SELECT id FROM auth_identities WHERE user_id = ?)) AS c',
        [userId, userId],
      )

      const second = await reconcileCompletedRegistrationMaterialization(
        db,
        { AUTH003_CREDENTIAL_HASH_KEY: env.AUTH003_CREDENTIAL_HASH_KEY },
        new Date().toISOString(),
      )

      const afterSecond = await scalar(
        db,
        'SELECT ' +
        '(SELECT COUNT(*) FROM auth_identities WHERE user_id = ?) AS i, ' +
        '(SELECT COUNT(*) FROM auth_credentials WHERE identity_id IN (SELECT id FROM auth_identities WHERE user_id = ?)) AS c',
        [userId, userId],
      )

      const credentialRows = credentials.results || []
      const kinds = credentialRows.map((r) => r.kind).sort()

      const checks = {
        missingKeyFailsClosed: missingKey.code === 'MISSING_ACTIVE_KEY',
        missingKeyDoesNotMutate:
          Number(afterMissingKey && afterMissingKey.i) === Number(before && before.i) &&
          Number(afterMissingKey && afterMissingKey.c) === Number(before && before.c),
        oneIdentity: Number(afterFirst && afterFirst.i) === 1,
        twoInitialCredentials:
          Number(afterFirst && afterFirst.c) === 2 &&
          JSON.stringify(kinds) === JSON.stringify(['email', 'username']),
        identityConverges:
          identity &&
          identity.user_id === userId &&
          identity.email === email &&
          identity.username === username &&
          identity.email_normalized === email.toLowerCase() &&
          identity.username_normalized === username.toLowerCase() &&
          identity.normalization_version === 'AUTH-003-NORM-V1',
        credentialsAreActiveAndHashed:
          credentialRows.length === 2 &&
          credentialRows.every((r) => r.active === 1 && typeof r.value_hash === 'string' && /^[0-9a-f]{64}$/.test(r.value_hash)),
        rerunCreatesNothing:
          Number(afterSecond && afterSecond.i) === Number(afterFirst && afterFirst.i) &&
          Number(afterSecond && afterSecond.c) === Number(afterFirst && afterFirst.c) &&
          Number(second && second.materialized) === 0 &&
          Number(second && second.scanned) === 0,
        noRawSecretInResult:
          !JSON.stringify(identity).includes(env.AUTH003_CREDENTIAL_HASH_KEY) &&
          !JSON.stringify(credentialRows).includes(env.AUTH003_CREDENTIAL_HASH_KEY) &&
          !JSON.stringify(first).includes(env.AUTH003_CREDENTIAL_HASH_KEY) &&
          !JSON.stringify(second).includes(env.AUTH003_CREDENTIAL_HASH_KEY),
      }

      for (const name of Object.keys(checks)) {
        if (!checks[name]) throw new Error('AUTH001 materializer assertion failed: ' + name)
      }

      return json({
        status: 'PASS',
        environment: 'CONTROLLED_REMOTE_D1_AUTH001_MATERIALIZER',
        provenance: {
          workflow: 'W02 AUTH-001 Registration Materializer Remote Evidence',
          runId: env.RUN_ID,
          sourceSha: env.SOURCE_SHA,
          productionWorkerDeployed: false,
        },
        checks: checks,
        results: {
          first: first,
          second: second,
          credentialKinds: kinds,
          before: before,
          afterFirst: afterFirst,
          afterSecond: afterSecond,
        },
      })
    } catch (error) {
      return json({
        status: 'RUNTIME_EXCEPTION',
        environment: 'CONTROLLED_REMOTE_D1_AUTH001_MATERIALIZER',
        error: {
          name: String(error && error.name ? error.name : 'Error'),
          code: String(error && error.code ? error.code : 'UNKNOWN'),
        },
      }, 500)
    } finally {
      try {
        await cleanup()
      } catch (cleanupError) {
        console.error(JSON.stringify({
          event: 'auth001.materializer.cleanup_failure',
          diagnosticCode: 'AUTH001_MATERIALIZER_FIXTURE_CLEANUP_FAILED',
          errorName: cleanupError && cleanupError.name ? cleanupError.name : 'Error',
        }))
      }
    }
  },
}
