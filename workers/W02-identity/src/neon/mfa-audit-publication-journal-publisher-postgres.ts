import type { Pool } from 'pg'

import {
  MFA_AUDIT_EVENT_NAMES,
  MFA_AUDIT_OPERATION_IDS,
  type MfaAuditEvent,
} from '../auth/mfa-audit-events.js'

export type MfaAuditQueue = {
  send(message: MfaAuditEvent): Promise<unknown>
}

export type MfaAuditPublisherResult = {
  selected: number
  published: number
  failed: number
}

type PendingJournalRow = {
  journalId: string
  payload: string
  attempt: number
}

const MAX_BATCH = 10
const MAX_BACKOFF_SECONDS = 300
const validEventNames = new Set<string>(MFA_AUDIT_EVENT_NAMES)
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const EVENT_ID = /^evt_[a-f0-9]{32}$/
const TOKEN = /^[A-Za-z0-9._:-]{1,128}$/
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,255}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}

/**
 * Validate the complete secret-free AUTH-007 event envelope before transport.
 * Extra fields are rejected so factor secrets, TOTP values, and recovery codes
 * cannot be smuggled into the existing W02-to-W06 queue by a malformed row.
 */
export function assertMfaAuditQueueEvent(value: unknown): MfaAuditEvent {
  if (!isRecord(value) || !hasExactKeys(value, [
    'eventId', 'eventType', 'schemaVersion', 'producer', 'resourceType', 'resourceId',
    'occurredAt', 'publishedAt', 'correlationId', 'causationId', 'idempotencyKey',
    'attempt', 'sourceVersion', 'actor', 'payload',
  ])) {
    throw new TypeError('invalid MFA audit event envelope')
  }

  if (
    typeof value.eventId !== 'string' || !EVENT_ID.test(value.eventId) ||
    typeof value.eventType !== 'string' || !validEventNames.has(value.eventType) ||
    value.schemaVersion !== '1.0' ||
    value.producer !== 'W02' ||
    value.resourceType !== 'User' ||
    typeof value.resourceId !== 'string' || !RESOURCE_ID.test(value.resourceId) ||
    typeof value.occurredAt !== 'string' || !Number.isFinite(Date.parse(value.occurredAt)) ||
    !isCanonicalTimestamp(value.publishedAt) ||
    typeof value.correlationId !== 'string' || !TOKEN.test(value.correlationId) ||
    typeof value.causationId !== 'string' || !TOKEN.test(value.causationId) ||
    typeof value.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(value.idempotencyKey) ||
    value.attempt !== 1 ||
    value.sourceVersion !== 1
  ) {
    throw new TypeError('invalid MFA audit event envelope')
  }

  if (
    !isRecord(value.actor) ||
    !hasExactKeys(value.actor, ['actorId', 'actorType']) ||
    value.actor.actorId !== value.resourceId ||
    value.actor.actorType !== 'user'
  ) {
    throw new TypeError('invalid MFA audit event actor')
  }

  if (!isRecord(value.payload) ||
      !hasExactKeys(value.payload, ['operationId', 'result'], ['reasonCode', 'factorState', 'challengeMethod'])) {
    throw new TypeError('invalid MFA audit event payload')
  }

  const operationId = value.payload.operationId
  const result = value.payload.result
  const eventType = value.eventType as keyof typeof MFA_AUDIT_OPERATION_IDS
  if (
    typeof operationId !== 'string' ||
    !MFA_AUDIT_OPERATION_IDS[eventType].includes(operationId as never) ||
    !['started', 'succeeded', 'failed', 'rejected'].includes(String(result))
  ) {
    throw new TypeError('invalid MFA audit event operation')
  }

  if (
    Object.hasOwn(value.payload, 'reasonCode') &&
    (typeof value.payload.reasonCode !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(value.payload.reasonCode))
  ) {
    throw new TypeError('invalid MFA audit event reason')
  }
  if (
    Object.hasOwn(value.payload, 'factorState') &&
    !['PENDING_VERIFICATION', 'ENABLED', 'DISABLED'].includes(String(value.payload.factorState))
  ) {
    throw new TypeError('invalid MFA audit event factor state')
  }
  if (
    Object.hasOwn(value.payload, 'challengeMethod') &&
    !['totp', 'recovery_code'].includes(String(value.payload.challengeMethod))
  ) {
    throw new TypeError('invalid MFA audit event challenge method')
  }

  return value as unknown as MfaAuditEvent
}

function assertPublisherInput(now: string, maxBatch: number): void {
  if (
    typeof now !== 'string' ||
    !Number.isFinite(Date.parse(now)) ||
    new Date(now).toISOString() !== now
  ) {
    throw new TypeError('invalid AUTH-007 PostgreSQL publisher timestamp')
  }
  if (!Number.isInteger(maxBatch) || maxBatch < 1 || maxBatch > MAX_BATCH) {
    throw new TypeError('AUTH-007 PostgreSQL publisher batch size must be 1-10')
  }
}

function retryDelaySeconds(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error('AUTH007_POSTGRES_JOURNAL_ATTEMPT_INVALID')
  }
  return Math.min(2 ** Math.max(0, attempt - 1), MAX_BACKOFF_SECONDS)
}

/**
 * Publish the PostgreSQL AUTH-007 MFA journal through the existing AUTH013_QUEUE.
 * One row is locked with SKIP LOCKED until Queue acceptance and the terminal
 * journal update are committed. Delivery is at-least-once: if Queue accepts a
 * message but PostgreSQL cannot commit PUBLISHED, a later retry may send it
 * again; W06 consumers must deduplicate by eventId/idempotencyKey.
 *
 * This adapter is test-only and is not wired to the production Worker/Cron.
 */
export async function publishPendingMfaAuditEventsPostgres(
  pool: Pool,
  queue: MfaAuditQueue,
  now = new Date().toISOString(),
  maxBatch = MAX_BATCH,
): Promise<MfaAuditPublisherResult> {
  assertPublisherInput(now, maxBatch)

  const summary: MfaAuditPublisherResult = {
    selected: 0,
    published: 0,
    failed: 0,
  }

  while (summary.selected < maxBatch) {
    const client = await pool.connect()
    let transactionOpen = false

    try {
      await client.query('BEGIN')
      transactionOpen = true

      const selected = await client.query<PendingJournalRow>(
        'SELECT journal_id AS "journalId", payload, attempt ' +
          'FROM auth_007_mfa_publication_journal ' +
          "WHERE status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= $1) " +
          'ORDER BY created_at ASC, journal_id ASC LIMIT 1 FOR UPDATE SKIP LOCKED',
        [now],
      )
      const row = selected.rows[0]

      if (!row) {
        await client.query('COMMIT')
        transactionOpen = false
        break
      }

      summary.selected += 1

      let payload: MfaAuditEvent
      try {
        payload = assertMfaAuditQueueEvent(JSON.parse(row.payload))
      } catch {
        const quarantined = await client.query(
          'UPDATE auth_007_mfa_publication_journal ' +
            "SET status = 'FAILED', next_attempt_at = NULL, last_error_code = 'INVALID_EVENT_PAYLOAD' " +
            "WHERE journal_id = $1 AND status = 'PENDING'",
          [row.journalId],
        )
        if (quarantined.rowCount !== 1) {
          throw new Error('AUTH007_POSTGRES_PUBLISHER_QUARANTINE_INCOMPLETE')
        }
        await client.query('COMMIT')
        transactionOpen = false
        summary.failed += 1
        continue
      }

      try {
        await queue.send(payload)
      } catch {
        const delaySeconds = retryDelaySeconds(Number(row.attempt))
        const nextAttemptAt = new Date(Date.parse(now) + delaySeconds * 1000)
        const retried = await client.query(
          'UPDATE auth_007_mfa_publication_journal ' +
            "SET status = 'PENDING', attempt = attempt + 1, next_attempt_at = $1, last_error_code = 'QUEUE_DESTINATION_FAILED' " +
            "WHERE journal_id = $2 AND status = 'PENDING'",
          [nextAttemptAt, row.journalId],
        )
        if (retried.rowCount !== 1) {
          throw new Error('AUTH007_POSTGRES_PUBLISHER_RETRY_INCOMPLETE')
        }
        await client.query('COMMIT')
        transactionOpen = false
        summary.failed += 1
        continue
      }

      const published = await client.query(
        'UPDATE auth_007_mfa_publication_journal ' +
          "SET status = 'PUBLISHED', published_at = $1, next_attempt_at = NULL, last_error_code = NULL " +
          "WHERE journal_id = $2 AND status = 'PENDING'",
        [now, row.journalId],
      )
      if (published.rowCount !== 1) {
        throw new Error('AUTH007_POSTGRES_PUBLISHER_FINALIZE_INCOMPLETE')
      }

      await client.query('COMMIT')
      transactionOpen = false
      summary.published += 1
    } catch {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK')
        } catch {
          // Do not leak PostgreSQL driver details.
        }
      }
      throw new Error('AUTH007_POSTGRES_PUBLICATION_STAGE_FAILED')
    } finally {
      client.release()
    }
  }

  return summary
}
