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
  if (!(MFA_AUDIT_EVENT_NAMES as readonly string[]).includes(input.eventType)) {
    throw new TypeError('invalid MFA audit event type')
  }
  if (!['started', 'succeeded', 'failed', 'rejected'].includes(input.result)) {
    throw new TypeError('invalid MFA audit result')
  }
  if (input.reasonCode !== undefined &&
      (typeof input.reasonCode !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(input.reasonCode))) {
    throw new TypeError('invalid MFA audit reason code')
  }
  if (input.factorState !== undefined &&
      !['PENDING_VERIFICATION', 'ENABLED', 'DISABLED'].includes(input.factorState)) {
    throw new TypeError('invalid MFA audit factor state')
  }
  if (input.challengeMethod !== undefined &&
      !['totp', 'recovery_code'].includes(input.challengeMethod)) {
    throw new TypeError('invalid MFA audit challenge method')
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

/**
 * @deprecated-next-version
 * Reason: Legacy Cloudflare D1 implementation retained only for isolated unit tests or the explicit schema/test fixture.
 * Replacement: PostgreSQL MFA audit receipt/event Store and publisher in src/neon/.
 * Removal: Next release.
 * Condition: No production caller builds D1 prepared statements; tests use PostgreSQL/in-memory event Stores.
 */
