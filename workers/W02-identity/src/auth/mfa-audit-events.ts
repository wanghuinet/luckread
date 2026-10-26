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

const operationByEvent: Record<MfaAuditEventName, string> = {
  'auth.mfa.enrollment_started': 'authMfaEnrollmentStart',
  'auth.mfa.enrollment_verified': 'authMfaEnrollmentConfirm',
  'auth.mfa.enrollment_failed': 'authMfaEnrollmentStart',
  'auth.mfa.challenge_succeeded': 'authMfaChallengeVerify',
  'auth.mfa.challenge_failed': 'authMfaChallengeVerify',
  'auth.mfa.factor_disabled': 'authMfaDisable',
  'auth.mfa.recovery_codes_rotated': 'authMfaRecoveryCodesRotate',
  'auth.mfa.recovery_code_consumed': 'authMfaChallengeVerify',
  'auth.mfa.locked': 'authMfaChallengeVerify',
  'auth.mfa.replay_rejected': 'authMfaChallengeVerify',
}

const safeCorrelation = (value: string | null, fallback: string): string =>
  value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : fallback

export function buildMfaAuditEvent(input: {
  eventType: MfaAuditEventName
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
  const payload: MfaAuditEvent['payload'] = {
    operationId: operationByEvent[input.eventType],
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
): Promise<boolean> {
  const event = buildMfaAuditEvent(input)
  const existing = await db.prepare(
    'SELECT event_id AS eventId, event_type AS eventType FROM auth_007_mfa_publication_journal WHERE idempotency_key = ? LIMIT 1',
  ).bind(event.idempotencyKey).first<{ eventId: string; eventType: string }>()
  if (existing) {
    if (input.eventId && existing.eventId !== input.eventId) throw new Error('MFA_AUDIT_EVENT_ID_CONFLICT')
    if (existing.eventType !== event.eventType) throw new Error('MFA_AUDIT_EVENT_TYPE_CONFLICT')
    return false
  }

  let result: D1Result
  try {
    result = await buildMfaAuditOutboxInsert(db, event).run()
  } catch {
    const raced = await db.prepare(
      'SELECT event_id AS eventId, event_type AS eventType FROM auth_007_mfa_publication_journal WHERE idempotency_key = ? LIMIT 1',
    ).bind(event.idempotencyKey).first<{ eventId: string }>()
    if (raced) {
      if (input.eventId && raced.eventId !== input.eventId) throw new Error('MFA_AUDIT_EVENT_ID_CONFLICT')
      if (raced.eventType !== event.eventType) throw new Error('MFA_AUDIT_EVENT_TYPE_CONFLICT')
      return false
    }
    throw new Error('MFA_AUDIT_OUTBOX_WRITE_FAILED')
  }

  if (result.success && result.meta?.changes === 1) return true
  const afterWrite = await db.prepare(
    'SELECT event_id AS eventId, event_type AS eventType FROM auth_007_mfa_publication_journal WHERE idempotency_key = ? LIMIT 1',
  ).bind(event.idempotencyKey).first<{ eventId: string }>()
  if (afterWrite) {
    if (input.eventId && afterWrite.eventId !== input.eventId) throw new Error('MFA_AUDIT_EVENT_ID_CONFLICT')
    if (afterWrite.eventType !== event.eventType) throw new Error('MFA_AUDIT_EVENT_TYPE_CONFLICT')
    return false
  }
  throw new Error('MFA_AUDIT_OUTBOX_WRITE_FAILED')
}
