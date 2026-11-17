import { Pool, type PoolClient } from 'pg'

import {
  resolveW01PayloadDatabaseDriver,
  type W01PayloadDatabaseEnvironment,
} from '../payload-database-driver.js'

export type RegistrationEnvelope = Readonly<{
  id: string
  payloadHash: string
  state: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  committedResponse?: string | null
  expiresAt: string
}>

export type RegistrationReservation = Readonly<{
  reservationId: string
  idempotencyKey: string
  payloadHash: string
  responseDigest: string
  consentRecordId: string
  expiresAt: string
  now: string
  existing: RegistrationEnvelope | null
}>

export type RegistrationCompletion = Readonly<{
  reservationId: string
  consentRecordId: string
  userId: string
  policyVersion: string
  retentionUntil: string
  sourceAuthority: string
  committedResponse: string
  now: string
}>

export interface RegistrationPersistenceStore {
  getExistingEnvelope(idempotencyKey: string): Promise<RegistrationEnvelope | null>
  reserveEnvelope(input: RegistrationReservation): Promise<void>
  releaseReservation(reservationId: string): Promise<void>
  completeRegistration(input: RegistrationCompletion): Promise<string | null>
}

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<D1Result>
}
type D1Session = {
  prepare(query: string): D1PreparedStatement
}
type D1Binding = {
  prepare(query: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>
  withSession(consistency: 'first-primary'): D1Session
}
type D1Result = { meta?: { changes?: number }; results?: Array<Record<string, unknown>> }
type D1Statement = ReturnType<D1Binding['prepare']>

const REGISTRATION_SCOPE = 'ACCOUNT_REGISTRATION'
const REGISTRATION_ENDPOINT = 'authRegister'

const pools = new WeakMap<object, Pool>()

function validateHyperdriveConnectionString(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 4096) {
    throw new Error('W01_REGISTRATION_NEON_CONNECTION_STRING_REQUIRED')
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('W01_REGISTRATION_NEON_CONNECTION_STRING_INVALID')
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.pathname.length < 2
  ) {
    throw new Error('W01_REGISTRATION_NEON_CONNECTION_STRING_INVALID')
  }
  return value
}

function getPool(binding: object, connectionString: string): Pool {
  const cached = pools.get(binding)
  if (cached) return cached
  const pool = new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
  })
  pool.on('error', (error) => {
    console.error(JSON.stringify({
      event: 'w01.auth.registration.postgres.pool_error',
      errorType: error instanceof Error ? error.name : 'UNKNOWN',
    }))
  })
  pools.set(binding, pool)
  return pool
}

const d1ExistingEnvelope = async (
  db: D1Binding,
  idempotencyKey: string,
): Promise<RegistrationEnvelope | null> => db
  .prepare(
    `SELECT
       id,
       payload_hash AS payloadHash,
       state,
       committed_response AS committedResponse,
       expires_at AS expiresAt
     FROM auth_registration_envelopes
     WHERE idempotency_key = ?
       AND scope = ?
       AND endpoint = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  )
  .bind(idempotencyKey, REGISTRATION_SCOPE, REGISTRATION_ENDPOINT)
  .first<RegistrationEnvelope>()

function createD1RegistrationPersistenceStore(db: D1Binding): RegistrationPersistenceStore {
  return {
    getExistingEnvelope: (key) => d1ExistingEnvelope(db, key),

    async reserveEnvelope(input) {
      const statements: D1Statement[] = []
      if (input.existing && Date.parse(input.existing.expiresAt) <= Date.parse(input.now)) {
        statements.push(
          db.prepare(
            `DELETE FROM auth_registration_envelopes
             WHERE id = ? AND active_key = ? AND expires_at <= ?`,
          ).bind(input.existing.id, input.idempotencyKey, input.now),
        )
      }
      statements.push(
        db.prepare(
          `INSERT INTO auth_registration_envelopes (
            id, idempotency_key, active_key, scope, endpoint, payload_hash,
            state, response_digest, committed_response, expires_at,
            consent_record_id, updated_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?, NULL, ?, ?, ?, ?)`,
        ).bind(
          input.reservationId,
          input.idempotencyKey,
          input.idempotencyKey,
          REGISTRATION_SCOPE,
          REGISTRATION_ENDPOINT,
          input.payloadHash,
          input.responseDigest,
          input.expiresAt,
          input.consentRecordId,
          input.now,
          input.now,
        ),
      )
      const results = await db.batch(statements) as D1Result[]
      const insertIndex = statements.length - 1
      if (
        results.length !== statements.length ||
        (input.existing &&
          Date.parse(input.existing.expiresAt) <= Date.parse(input.now) &&
          results[0]?.meta?.changes !== 1) ||
        results[insertIndex]?.meta?.changes !== 1
      ) {
        throw new Error('AUTH001_IDEMPOTENCY_RESERVATION_INCOMPLETE')
      }
    },

    async releaseReservation(reservationId) {
      await db.prepare(
        `DELETE FROM auth_registration_envelopes
         WHERE id = ? AND state = 'IN_PROGRESS'`,
      ).bind(reservationId).run()
    },

    async completeRegistration(input) {
      const statements = [
        db.prepare(
          `INSERT INTO consents (
            id, actor_subject_id, owner_subject_id, resource_id, resource_type,
            purpose, state, policy_version, legal_basis, retention_class,
            retention_until, source_authority
          ) VALUES (?, ?, ?, ?, 'User', 'ACCOUNT_REGISTRATION', 'GRANTED',
            ?, 'CONSENT', 'LEGAL_AUDIT', ?, ?)`,
        ).bind(
          input.consentRecordId,
          input.userId,
          input.userId,
          input.userId,
          input.policyVersion,
          input.retentionUntil,
          input.sourceAuthority,
        ),
        db.prepare(
          `UPDATE auth_registration_envelopes
           SET state = 'COMPLETED', committed_response = ?, updated_at = ?
           WHERE id = ? AND state = 'IN_PROGRESS'`,
        ).bind(input.committedResponse, input.now, input.reservationId),
        db.prepare(
          `SELECT committed_response FROM auth_registration_envelopes
           WHERE id = ? LIMIT 1`,
        ).bind(input.reservationId),
      ]
      const results = await db.batch(statements) as D1Result[]
      if (
        results.length !== statements.length ||
        results[0]?.meta?.changes !== 1 ||
        results[1]?.meta?.changes !== 1
      ) {
        throw new Error('AUTH001_COMMIT_BATCH_INCOMPLETE')
      }
      const row = results[2]?.results?.[0] as { committed_response?: unknown } | undefined
      return typeof row?.committed_response === 'string' ? row.committed_response : null
    },
  }
}

async function inTransaction<T>(client: PoolClient, operation: () => Promise<T>): Promise<T> {
  await client.query('BEGIN')
  try {
    const result = await operation()
    await client.query('COMMIT')
    return result
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  }
}

function createPostgresRegistrationPersistenceStore(pool: Pool): RegistrationPersistenceStore {
  return {
    async getExistingEnvelope(idempotencyKey) {
      const result = await pool.query<RegistrationEnvelope & Record<string, unknown>>(
        `SELECT
           id,
           payload_hash AS "payloadHash",
           state,
           committed_response AS "committedResponse",
           to_char(expires_at AT TIME ZONE 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt"
         FROM auth_registration_envelopes
         WHERE idempotency_key = $1 AND scope = $2 AND endpoint = $3
         ORDER BY created_at DESC
         LIMIT 1`,
        [idempotencyKey, REGISTRATION_SCOPE, REGISTRATION_ENDPOINT],
      )
      return result.rows[0] ?? null
    },

    async reserveEnvelope(input) {
      const client = await pool.connect()
      try {
        await inTransaction(client, async () => {
          if (input.existing && Date.parse(input.existing.expiresAt) <= Date.parse(input.now)) {
            const deleted = await client.query(
              `DELETE FROM auth_registration_envelopes
               WHERE id = $1 AND active_key = $2 AND expires_at <= $3::timestamptz`,
              [input.existing.id, input.idempotencyKey, input.now],
            )
            if (deleted.rowCount !== 1) {
              throw new Error('AUTH001_IDEMPOTENCY_RESERVATION_INCOMPLETE')
            }
          }
          const inserted = await client.query(
            `INSERT INTO auth_registration_envelopes (
              id, idempotency_key, active_key, scope, endpoint, payload_hash,
              state, response_digest, committed_response, expires_at,
              consent_record_id, updated_at, created_at
            ) VALUES ($1, $2, $2, $3, $4, $5, 'IN_PROGRESS', $6, NULL,
              $7::timestamptz, $8, $9::timestamptz, $9::timestamptz)`,
            [
              input.reservationId,
              input.idempotencyKey,
              REGISTRATION_SCOPE,
              REGISTRATION_ENDPOINT,
              input.payloadHash,
              input.responseDigest,
              input.expiresAt,
              input.consentRecordId,
              input.now,
            ],
          )
          if (inserted.rowCount !== 1) {
            throw new Error('AUTH001_IDEMPOTENCY_RESERVATION_INCOMPLETE')
          }
        })
      } finally {
        client.release()
      }
    },

    async releaseReservation(reservationId) {
      await pool.query(
        `DELETE FROM auth_registration_envelopes
         WHERE id = $1 AND state = 'IN_PROGRESS'`,
        [reservationId],
      )
    },

    async completeRegistration(input) {
      const client = await pool.connect()
      try {
        return await inTransaction(client, async () => {
          await client.query(
            `INSERT INTO consents (
              id, actor_subject_id, owner_subject_id, resource_id, resource_type,
              purpose, state, policy_version, legal_basis, retention_class,
              retention_until, source_authority
            ) VALUES ($1, $2, $3, $4, 'User', 'ACCOUNT_REGISTRATION', 'GRANTED',
              $5, 'CONSENT', 'LEGAL_AUDIT', $6::timestamptz, $7)`,
            [
              input.consentRecordId,
              input.userId,
              input.userId,
              input.userId,
              input.policyVersion,
              input.retentionUntil,
              input.sourceAuthority,
            ],
          )
          const updated = await client.query(
            `UPDATE auth_registration_envelopes
             SET state = 'COMPLETED', committed_response = $1, updated_at = $2::timestamptz
             WHERE id = $3 AND state = 'IN_PROGRESS'`,
            [input.committedResponse, input.now, input.reservationId],
          )
          if (updated.rowCount !== 1) throw new Error('AUTH001_COMMIT_BATCH_INCOMPLETE')
          const row = await client.query<{ committed_response: string } & Record<string, unknown>>(
            'SELECT committed_response FROM auth_registration_envelopes WHERE id = $1 LIMIT 1',
            [input.reservationId],
          )
          return row.rows[0]?.committed_response ?? null
        })
      } finally {
        client.release()
      }
    },
  }
}

export function getW01RegistrationPersistenceStore(
  env: W01PayloadDatabaseEnvironment & { D1?: D1Binding },
): RegistrationPersistenceStore {
  const selection = resolveW01PayloadDatabaseDriver(env)
  if (selection.kind === 'd1') {
    if (!env.D1) throw new Error('W01_D1_BINDING_REQUIRED')
    return createD1RegistrationPersistenceStore(env.D1)
  }

  const binding = env.HYPERDRIVE
  if (!binding || typeof binding !== 'object') {
    throw new Error('W01_NEON_HYPERDRIVE_BINDING_MISSING')
  }
  return createPostgresRegistrationPersistenceStore(
    getPool(binding, validateHyperdriveConnectionString(selection.connectionString)),
  )
}

export async function closeW01RegistrationPostgresRuntimeForTest(
  binding: object,
): Promise<void> {
  const pool = pools.get(binding)
  if (!pool) return
  pools.delete(binding)
  await pool.end()
}
