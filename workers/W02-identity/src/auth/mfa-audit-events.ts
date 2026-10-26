export const MFA_AUDIT_EVENT_NAMES = [
  'auth.mfa.enrollment_started',
  'auth.mfa.enrollment_verified',
  'auth.mfa.enrollment_failed',
  'auth.mfa.challenge_succeeded',
  'auth.mfa.challenge_failed',
  'auth.mfa.factor_disabled',
  'auth.mfa.recovery_codes_rotated',
  'auth.mfa.recovery_code_consumed',
  'auth.mfa.locked',
  'auth.mfa.replay_rejected',
] as const

export type MfaAuditEventName = typeof MFA_AUDIT_EVENT_NAMES[number]
export type MfaAuditResult = 'started' | 'succeeded' | 'failed' | 'rejected'

/**
 * Derive one stable event identity for a global idempotency condition such as
 * a single user's lockout window. Distinct operation receipts can observe the
 * same condition, so a random per-receipt ID would create false conflicts.
 */
export async function deriveMfaAuditEventIdForIdempotencyKey(idempotencyKey: string): Promise<string> {
  if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,255}$/.test(idempotencyKey)) {
    throw new TypeError('invalid MFA audit idempotency key')
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(idempotencyKey))
  const hex = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  return 'evt_' + hex
}

export type MfaAuditEvent = {
  eventId: string
  eventType: MfaAuditEventName
  schemaVersion: '1.0'
  producer: 'W02'
  resourceType: 'User'
  resourceId: string
  occurredAt: string
  publishedAt: string
  correlationId: string
  causationId: string
  idempotencyKey: string
  attempt: 1
  sourceVersion: 1
  actor: { actorId: string; actorType: 'user' }
  payload: {
    operationId: string
    result: MfaAuditResult
    reasonCode?: string
    factorState?: 'PENDING_VERIFICATION' | 'ENABLED' | 'DISABLED'
    challengeMethod?: 'totp' | 'recovery_code'
  }
}

export type MfaAuditOperationId =
  | 'authMfaEnrollmentStart'
  | 'authMfaEnrollmentConfirm'
  | 'authMfaChallengeVerify'
  | 'authMfaDisable'
  | 'authMfaRecoveryCodesRotate'

/**
 * Operation IDs accepted by the event contract. The first item is the
 * default for event types that allow more than one operation source.
 */
export const MFA_AUDIT_OPERATION_IDS: Record<MfaAuditEventName, readonly MfaAuditOperationId[]> = {
  'auth.mfa.enrollment_started': ['authMfaEnrollmentStart'],
  'auth.mfa.enrollment_verified': ['authMfaEnrollmentConfirm'],
  'auth.mfa.enrollment_failed': ['authMfaEnrollmentStart', 'authMfaEnrollmentConfirm'],
  'auth.mfa.challenge_succeeded': ['authMfaChallengeVerify'],
  'auth.mfa.challenge_failed': ['authMfaChallengeVerify'],
  'auth.mfa.factor_disabled': ['authMfaDisable'],
  'auth.mfa.recovery_codes_rotated': ['authMfaRecoveryCodesRotate'],
  'auth.mfa.recovery_code_consumed': ['authMfaChallengeVerify'],
  'auth.mfa.locked': ['authMfaChallengeVerify'],
  'auth.mfa.replay_rejected': ['authMfaChallengeVerify'],
}

export function isAllowedMfaAuditOperationId(
  eventType: MfaAuditEventName,
  operationId: string,
): boolean {
  return MFA_AUDIT_OPERATION_IDS[eventType].includes(operationId as MfaAuditOperationId)
}

const safeCorrelation = (value: string | null, fallback: string): string =>
  value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : fallback

export function buildMfaAuditEvent(input: {
  eventType: MfaAuditEventName
  operationId?: string
  userId: string
  occurredAt?: string
  correlationId?: string | null
  causationId?: string | null
  result: MfaAuditResult
  reasonCode?: string
  factorState?: MfaAuditEvent['payload']['factorState']
  challengeMethod?: MfaAuditEvent['payload']['challengeMethod']
  idempotencyKey?: string
  eventId?: string
}): MfaAuditEvent {
  if (typeof input.userId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.userId)) {
    throw new TypeError('invalid MFA audit subject')
  }
  const eventId = input.eventId ?? 'evt_' + crypto.randomUUID().replaceAll('-', '')
  if (!/^evt_[a-f0-9]{32}$/.test(eventId)) throw new TypeError('invalid MFA audit event id')
  if (input.idempotencyKey !== undefined &&
      (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,255}$/.test(input.idempotencyKey))) {
    throw new TypeError('invalid MFA audit idempotency key')
  }
  const occurredAt = input.occurredAt ?? new Date().toISOString()
  if (!Number.isFinite(Date.parse(occurredAt))) throw new TypeError('invalid MFA audit timestamp')
  // publishedAt is the immutable durable-publication intent timestamp, not the
  // business occurrence time and not the later Queue delivery acknowledgement.
  // The journal's published_at column records the separate Queue-accepted time.
  const publishedAt = new Date().toISOString()
  const correlationId = safeCorrelation(input.correlationId ?? null, eventId)
  const causationId = safeCorrelation(input.causationId ?? null, correlationId)
  const allowedOperationIds = MFA_AUDIT_OPERATION_IDS[input.eventType]
  const operationId = input.operationId ?? allowedOperationIds[0]!
  if (!allowedOperationIds.includes(operationId as MfaAuditOperationId)) {
    throw new TypeError('invalid MFA audit operation id for event type')
  }
  const payload: MfaAuditEvent['payload'] = {
    operationId,
    result: input.result,
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    ...(input.factorState ? { factorState: input.factorState } : {}),
    ...(input.challengeMethod ? { challengeMethod: input.challengeMethod } : {}),
  }
  return {
    eventId,
    eventType: input.eventType,
    schemaVersion: '1.0',
    producer: 'W02',
    resourceType: 'User',
    resourceId: input.userId,
    occurredAt,
    publishedAt,
    correlationId,
    causationId,
    idempotencyKey: input.idempotencyKey ?? 'mfa-' + eventId,
    attempt: 1,
    sourceVersion: 1,
    actor: { actorId: input.userId, actorType: 'user' },
    payload,
  }
}

export function buildMfaAuditOutboxInsert(
  db: D1Database,
  event: MfaAuditEvent,
  options: { onlyWhenPreviousStatementChanged?: boolean } = {},
): D1PreparedStatement {
  const columns =
    '(journal_id, event_id, event_type, schema_version, resource_id, source_version, idempotency_key, payload, status, attempt, next_attempt_at, created_at, published_at, last_error_code)'
  const values = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  const sql = options.onlyWhenPreviousStatementChanged
    ? 'INSERT INTO auth_007_mfa_publication_journal ' + columns + ' SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1'
    : 'INSERT INTO auth_007_mfa_publication_journal ' + columns + ' VALUES ' + values
  return db.prepare(sql).bind(
    crypto.randomUUID(),
    event.eventId,
    event.eventType,
    event.schemaVersion,
    event.resourceId,
    event.sourceVersion,
    event.idempotencyKey,
    JSON.stringify(event),
    'PENDING',
    1,
    null,
    event.publishedAt,
    null,
    null,
  )
}

export async function recordMfaAuditEvent(
  db: D1Database,
  input: Parameters<typeof buildMfaAuditEvent>[0],
): Promise<MfaAuditEvent> {
  const event = buildMfaAuditEvent(input)
  const result = await buildMfaAuditOutboxInsert(db, event).run()
  if (!result.success || result.meta?.changes !== 1) throw new Error('MFA_AUDIT_OUTBOX_WRITE_FAILED')
  return event
}

/**
 * Insert an event once for a stable source condition such as one particular
 * lockout window. The D1 unique idempotency key is the concurrency guard;
 * a duplicate producer invocation is considered successful only after a
 * read-back proves that the original key is already durable.
 */
export async function recordMfaAuditEventOnce(
  db: D1Database,
  input: Parameters<typeof buildMfaAuditEvent>[0] & { idempotencyKey: string; eventId?: string },
): Promise<{ inserted: boolean; eventId: string }> {
  const event = buildMfaAuditEvent(input)
  type StoredJournalEvent = {
    eventId: string
    eventType: string
    resourceId: string
    status: string
    operationId: string | null
    result: string | null
    reasonCode: string | null
    factorState: string | null
    challengeMethod: string | null
  }
  const selectByIdempotencyKey =
    "SELECT event_id AS eventId, event_type AS eventType, resource_id AS resourceId, status, " +
    "json_extract(payload, '$.payload.operationId') AS operationId, " +
    "json_extract(payload, '$.payload.result') AS result, " +
    "json_extract(payload, '$.payload.reasonCode') AS reasonCode, " +
    "json_extract(payload, '$.payload.factorState') AS factorState, " +
    "json_extract(payload, '$.payload.challengeMethod') AS challengeMethod " +
    "FROM auth_007_mfa_publication_journal WHERE idempotency_key = ? LIMIT 1"

  const canAdoptLegacyLockoutId = event.eventType === 'auth.mfa.locked' &&
    input.idempotencyKey.startsWith('mfa-lock:') &&
    input.eventId === await deriveMfaAuditEventIdForIdempotencyKey(input.idempotencyKey)
  const assertSameIntent = (stored: StoredJournalEvent): void => {
    // A matching idempotency key is not proof of a valid journal row unless
    // its durable identity is valid, even when this producer did not assign
    // an eventId before the first insert (for example, a lockout event).
    if (typeof stored.eventId !== 'string' || !/^evt_[a-f0-9]{32}$/.test(stored.eventId)) {
      throw new Error('MFA_AUDIT_EVENT_ID_CONFLICT')
    }
    if (input.eventId && stored.eventId !== input.eventId && !canAdoptLegacyLockoutId) {
      throw new Error('MFA_AUDIT_EVENT_ID_CONFLICT')
    }
    if (stored.status === 'FAILED') throw new Error('MFA_AUDIT_OUTBOX_PREVIOUSLY_FAILED')
    if (!['PENDING', 'PUBLISHED'].includes(stored.status)) throw new Error('MFA_AUDIT_OUTBOX_STATUS_INVALID')
    if (stored.eventType !== event.eventType || stored.operationId !== event.payload.operationId) {
      throw new Error('MFA_AUDIT_EVENT_ACTION_CONFLICT')
    }
    const optionalMatches = (storedValue: string | null, expected: string | undefined): boolean =>
      (storedValue ?? undefined) === expected
    if (
      stored.resourceId !== event.resourceId ||
      stored.result !== event.payload.result ||
      !optionalMatches(stored.reasonCode, event.payload.reasonCode) ||
      !optionalMatches(stored.factorState, event.payload.factorState) ||
      (!canAdoptLegacyLockoutId && !optionalMatches(stored.challengeMethod, event.payload.challengeMethod))
    ) throw new Error('MFA_AUDIT_EVENT_INTENT_CONFLICT')
  }
  const existing = await db.prepare(selectByIdempotencyKey)
    .bind(event.idempotencyKey)
    .first<StoredJournalEvent>()
  if (existing) {
    assertSameIntent(existing)
    return { inserted: false, eventId: existing.eventId }
  }

  let result: D1Result
  try {
    result = await buildMfaAuditOutboxInsert(db, event).run()
  } catch {
    const raced = await db.prepare(selectByIdempotencyKey)
      .bind(event.idempotencyKey)
      .first<StoredJournalEvent>()
    if (raced) {
      assertSameIntent(raced)
      return { inserted: false, eventId: raced.eventId }
    }
    throw new Error('MFA_AUDIT_OUTBOX_WRITE_FAILED')
  }

  if (result.success && result.meta?.changes === 1) return { inserted: true, eventId: event.eventId }
  const afterWrite = await db.prepare(selectByIdempotencyKey)
    .bind(event.idempotencyKey)
    .first<StoredJournalEvent>()
  if (afterWrite) {
    assertSameIntent(afterWrite)
    return { inserted: false, eventId: afterWrite.eventId }
  }
  throw new Error('MFA_AUDIT_OUTBOX_WRITE_FAILED')
}
