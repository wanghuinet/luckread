import type { Pool } from 'pg'

import {
  buildMfaAuditEvent,
  deriveMfaAuditEventIdForIdempotencyKey,
  type MfaAuditEvent,
} from '../auth/mfa-audit-events.js'

type RecordMfaAuditEventOnceInput = Parameters<typeof buildMfaAuditEvent>[0] & {
  idempotencyKey: string
  eventId?: string
}

type StoredJournalRow = {
  eventId: string
  eventType: string
  resourceId: string
  status: string
  payload: string
}

const EVENT_ID_PATTERN = /^evt_[a-f0-9]{32}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function loadByIdempotencyKey(
  pool: Pool,
  idempotencyKey: string,
): Promise<StoredJournalRow | null> {
  const result = await pool.query<StoredJournalRow>(
    'SELECT event_id AS "eventId", event_type AS "eventType", resource_id AS "resourceId", ' +
      'status, payload FROM auth_007_mfa_publication_journal ' +
      'WHERE idempotency_key = $1 LIMIT 1',
    [idempotencyKey],
  )
  return result.rows[0] ?? null
}

function assertSameIntent(
  stored: StoredJournalRow,
  event: MfaAuditEvent,
  input: RecordMfaAuditEventOnceInput,
  canAdoptLegacyLockoutId: boolean,
): void {
  if (
    typeof stored.eventId !== 'string' ||
    !EVENT_ID_PATTERN.test(stored.eventId)
  ) {
    throw new Error('MFA_AUDIT_EVENT_ID_CONFLICT')
  }
  if (input.eventId && stored.eventId !== input.eventId && !canAdoptLegacyLockoutId) {
    throw new Error('MFA_AUDIT_EVENT_ID_CONFLICT')
  }
  if (stored.status === 'FAILED') {
    throw new Error('MFA_AUDIT_OUTBOX_PREVIOUSLY_FAILED')
  }
  if (!['PENDING', 'PUBLISHED'].includes(stored.status)) {
    throw new Error('MFA_AUDIT_OUTBOX_STATUS_INVALID')
  }

  let storedEvent: unknown
  try {
    storedEvent = JSON.parse(stored.payload)
  } catch {
    throw new Error('MFA_AUDIT_EVENT_INTENT_CONFLICT')
  }
  if (!isRecord(storedEvent) || !isRecord(storedEvent.payload)) {
    throw new Error('MFA_AUDIT_EVENT_INTENT_CONFLICT')
  }

  const storedPayload = storedEvent.payload
  if (
    storedEvent.eventId !== stored.eventId ||
    storedEvent.idempotencyKey !== event.idempotencyKey ||
    storedEvent.resourceId !== event.resourceId ||
    stored.eventType !== event.eventType ||
    stored.resourceId !== event.resourceId ||
    storedPayload.operationId !== event.payload.operationId
  ) {
    throw new Error('MFA_AUDIT_EVENT_ACTION_CONFLICT')
  }

  const optionalMatches = (storedValue: unknown, expected: string | undefined): boolean =>
    (storedValue ?? undefined) === expected

  if (
    storedPayload.result !== event.payload.result ||
    !optionalMatches(storedPayload.reasonCode, event.payload.reasonCode) ||
    !optionalMatches(storedPayload.factorState, event.payload.factorState) ||
    (!canAdoptLegacyLockoutId &&
      !optionalMatches(storedPayload.challengeMethod, event.payload.challengeMethod))
  ) {
    throw new Error('MFA_AUDIT_EVENT_INTENT_CONFLICT')
  }
}

/**
 * Persist one secret-free MFA audit event in the PostgreSQL W02 publication
 * journal. The unique idempotency key is the concurrency guard; a duplicate
 * is successful only after the existing row's identity, status and intent
 * have been read back and proven compatible with the request.
 *
 * Queue publication remains a separate operation on the existing
 * AUTH013_QUEUE contract. W06 remains the canonical AuditEvent authority.
 */
export async function recordMfaAuditEventOncePostgres(
  pool: Pool,
  input: RecordMfaAuditEventOnceInput,
): Promise<{ inserted: boolean; eventId: string }> {
  const event = buildMfaAuditEvent(input)
  const canAdoptLegacyLockoutId =
    event.eventType === 'auth.mfa.locked' &&
    input.idempotencyKey.startsWith('mfa-lock:') &&
    input.eventId === await deriveMfaAuditEventIdForIdempotencyKey(input.idempotencyKey)

  const journalId = crypto.randomUUID()
  try {
    const inserted = await pool.query<{ eventId: string }>(
      'INSERT INTO auth_007_mfa_publication_journal ' +
        '(journal_id, event_id, event_type, schema_version, resource_id, source_version, ' +
        'idempotency_key, payload, status, attempt, next_attempt_at, created_at, published_at, last_error_code) ' +
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', 1, NULL, $9, NULL, NULL) " +
        'ON CONFLICT (idempotency_key) DO NOTHING ' +
        'RETURNING event_id AS "eventId"',
      [
        journalId,
        event.eventId,
        event.eventType,
        event.schemaVersion,
        event.resourceId,
        event.sourceVersion,
        event.idempotencyKey,
        JSON.stringify(event),
        new Date(event.publishedAt),
      ],
    )
    if (inserted.rowCount === 1) {
      return { inserted: true, eventId: inserted.rows[0]!.eventId }
    }
  } catch (writeError) {
    // A lost response may follow a committed insert. First prove whether the
    // idempotency key is already durable before classifying the write as failed.
    let existing: StoredJournalRow | null = null
    try {
      existing = await loadByIdempotencyKey(pool, event.idempotencyKey)
    } catch {
      throw new Error('MFA_AUDIT_OUTBOX_WRITE_FAILED')
    }
    if (existing) {
      assertSameIntent(existing, event, input, canAdoptLegacyLockoutId)
      return { inserted: false, eventId: existing.eventId }
    }
    const error = writeError as { code?: unknown; constraint?: unknown }
    if (
      error?.code === '23505' &&
      error?.constraint === 'auth_007_mfa_publication_journal_event_id_uq'
    ) {
      throw new Error('MFA_AUDIT_EVENT_ID_CONFLICT')
    }
    throw new Error('MFA_AUDIT_OUTBOX_WRITE_FAILED')
  }

  let existing: StoredJournalRow | null
  try {
    existing = await loadByIdempotencyKey(pool, event.idempotencyKey)
  } catch {
    throw new Error('MFA_AUDIT_OUTBOX_WRITE_FAILED')
  }
  if (existing) {
    assertSameIntent(existing, event, input, canAdoptLegacyLockoutId)
    return { inserted: false, eventId: existing.eventId }
  }
  throw new Error('MFA_AUDIT_OUTBOX_WRITE_FAILED')
}
