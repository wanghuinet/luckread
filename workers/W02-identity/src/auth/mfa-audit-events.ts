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
}): MfaAuditEvent {
  if (typeof input.userId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.userId)) {
    throw new TypeError('invalid MFA audit subject')
  }
  const eventId = 'evt_' + crypto.randomUUID().replaceAll('-', '')
  const occurredAt = input.occurredAt ?? new Date().toISOString()
  if (!Number.isFinite(Date.parse(occurredAt))) throw new TypeError('invalid MFA audit timestamp')
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
    publishedAt: occurredAt,
    correlationId,
    causationId,
    idempotencyKey: 'mfa-' + eventId,
    attempt: 1,
    sourceVersion: 1,
    actor: { actorId: input.userId, actorType: 'user' },
    payload,
  }
}

export function buildMfaAuditOutboxInsert(db: D1Database, event: MfaAuditEvent): D1PreparedStatement {
  return db.prepare(
    'INSERT INTO auth_007_mfa_publication_journal ' +
    '(journal_id, event_id, event_type, schema_version, resource_id, source_version, idempotency_key, payload, status, attempt, next_attempt_at, created_at, published_at, last_error_code) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
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
    event.occurredAt,
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
