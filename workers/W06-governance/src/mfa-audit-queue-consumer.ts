import { persistAuditEvent } from './audit-event-persistence'
import type { AuditActor, AuditEvent } from './audit-event'

const operationIds: Record<string, readonly string[]> = {
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

const allowedPayloadKeys = new Set(['operationId', 'result', 'reasonCode', 'factorState', 'challengeMethod'])
const allowedResults = new Set(['started', 'succeeded', 'failed', 'rejected'])
const eventIdPattern = /^evt_[a-f0-9]{32}$/
const resourceIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const correlationPattern = /^[A-Za-z0-9._:-]{1,128}$/

export type MfaAuditQueueEvent = {
  eventId: string
  eventType: keyof typeof operationIds
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
  sourceVersion: number
  actor: AuditActor
  payload: {
    operationId: string
    result: 'started' | 'succeeded' | 'failed' | 'rejected'
    reasonCode?: string
    factorState?: 'PENDING_VERIFICATION' | 'ENABLED' | 'DISABLED'
    challengeMethod?: 'totp' | 'recovery_code'
  }
}

function assertMfaAuditEvent(value: unknown): asserts value is MfaAuditQueueEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_AUTH_007_MFA_EVENT')
  const event = value as Record<string, unknown>
  const payload = event.payload
  const actor = event.actor
  if (!actor || typeof actor !== 'object' || Array.isArray(actor) ||
      !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('INVALID_AUTH_007_MFA_EVENT')
  }
  const actorValue = actor as Record<string, unknown>
  const payloadValue = payload as Record<string, unknown>
  const validEvent = typeof event.eventType === 'string' && event.eventType in operationIds
  const requiredStrings = [
    event.eventId, event.resourceId, event.occurredAt, event.publishedAt,
    event.correlationId, event.causationId, event.idempotencyKey,
  ]
  if (
    !validEvent ||
    event.schemaVersion !== '1.0' ||
    event.producer !== 'W02' ||
    event.resourceType !== 'User' ||
    requiredStrings.some((item) => typeof item !== 'string' || item.length === 0) ||
    !eventIdPattern.test(event.eventId as string) ||
    !resourceIdPattern.test(event.resourceId as string) ||
    !correlationPattern.test(event.correlationId as string) ||
    !correlationPattern.test(event.causationId as string) ||
    !Number.isInteger(event.attempt) || event.attempt !== 1 ||
    !Number.isInteger(event.sourceVersion) || Number(event.sourceVersion) < 1 ||
    Number.isNaN(Date.parse(event.occurredAt as string)) ||
    Number.isNaN(Date.parse(event.publishedAt as string)) ||
    typeof actorValue.actorId !== 'string' ||
    actorValue.actorId !== event.resourceId ||
    actorValue.actorType !== 'user' ||
    Object.keys(actorValue).some((key) => key !== 'actorId' && key !== 'actorType') ||
    Object.keys(payloadValue).some((key) => !allowedPayloadKeys.has(key)) ||
    typeof payloadValue.operationId !== 'string' ||
    !operationIds[event.eventType as keyof typeof operationIds].includes(payloadValue.operationId) ||
    typeof payloadValue.result !== 'string' || !allowedResults.has(payloadValue.result)
  ) {
    throw new Error('INVALID_AUTH_007_MFA_EVENT')
  }

  if (payloadValue.reasonCode !== undefined &&
      (typeof payloadValue.reasonCode !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(payloadValue.reasonCode))) {
    throw new Error('INVALID_AUTH_007_MFA_EVENT')
  }
  if (payloadValue.factorState !== undefined &&
      !['PENDING_VERIFICATION', 'ENABLED', 'DISABLED'].includes(String(payloadValue.factorState))) {
    throw new Error('INVALID_AUTH_007_MFA_EVENT')
  }
  if (payloadValue.challengeMethod !== undefined &&
      !['totp', 'recovery_code'].includes(String(payloadValue.challengeMethod))) {
    throw new Error('INVALID_AUTH_007_MFA_EVENT')
  }
}

type ExistingMfaAuditRow = {
  eventId: string
  requestId: string | null
  traceId: string | null
  actorJson: string
  action: string
  targetType: string
  targetId: string
  beforeJson: string
  afterJson: string
  reason: string | null
  occurredAt: string
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function sameRecord(actual: Record<string, unknown> | null, expected: Record<string, unknown>): boolean {
  if (!actual) return false
  const actualKeys = Object.keys(actual).sort()
  const expectedKeys = Object.keys(expected).sort()
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key])
}

function isSamePersistedMfaAuditEvent(
  existing: ExistingMfaAuditRow,
  event: MfaAuditQueueEvent,
): boolean {
  return existing.eventId === event.eventId &&
    existing.requestId === event.correlationId &&
    existing.traceId === event.causationId &&
    existing.action === event.eventType &&
    existing.targetType === 'User' &&
    existing.targetId === event.resourceId &&
    existing.reason === (event.payload.reasonCode ?? null) &&
    existing.occurredAt === event.occurredAt &&
    sameRecord(parseJsonObject(existing.actorJson), {
      actorId: event.resourceId,
      actorType: 'user',
    }) &&
    sameRecord(parseJsonObject(existing.beforeJson), {}) &&
    sameRecord(parseJsonObject(existing.afterJson), event.payload as unknown as Record<string, unknown>)
}

/**
 * Persists a safe MFA security event in W06's canonical immutable AuditEvent
 * store. Event IDs are the deduplication key; D1's primary key remains the
 * final concurrency guard if duplicate deliveries race.
 */
export async function consumeMfaAuditEvent(
  db: D1Database,
  raw: unknown,
): Promise<'persisted' | 'duplicate'> {
  assertMfaAuditEvent(raw)
  const event = raw

  const existing = await db.prepare(
    'SELECT event_id AS eventId, request_id AS requestId, trace_id AS traceId, ' +
    'actor_json AS actorJson, action, target_type AS targetType, target_id AS targetId, ' +
    'before_json AS beforeJson, after_json AS afterJson, reason, occurred_at AS occurredAt ' +
    'FROM audit_events WHERE event_id = ? LIMIT 1',
  ).bind(event.eventId).first<ExistingMfaAuditRow>()

  if (existing) {
    if (!isSamePersistedMfaAuditEvent(existing, event)) {
      throw new Error('MFA_AUDIT_EVENT_IDENTITY_CONFLICT')
    }
    return 'duplicate'
  }

  const auditEvent: AuditEvent = {
    eventId: event.eventId,
    requestId: event.correlationId,
    traceId: event.causationId,
    actor: { actorId: event.actor.actorId, actorType: 'user' },
    action: event.eventType,
    targetType: 'User',
    targetId: event.resourceId,
    before: {},
    after: { ...event.payload },
    ...(event.payload.reasonCode ? { reason: event.payload.reasonCode } : {}),
    occurredAt: event.occurredAt,
  }
  await persistAuditEvent(db, auditEvent)
  return 'persisted'
}
