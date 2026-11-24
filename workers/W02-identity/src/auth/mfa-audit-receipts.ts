import {
  MFA_AUDIT_EVENT_NAMES,
  MFA_AUDIT_OPERATION_IDS,
  deriveMfaAuditEventIdForIdempotencyKey,
  isAllowedMfaAuditOperationId,
  type MfaAuditEventName,
  type MfaAuditOperationId,
  type MfaAuditResult,
} from './mfa-audit-events.js'

export type MfaAuditReceiptOperationPath =
  | '/two-factor/verify-totp'
  | '/two-factor/verify-backup-code'
  | '/two-factor/disable'
  | '/two-factor/generate-backup-codes'

export type MfaAuditReceiptEvent = {
  eventType: MfaAuditEventName
  operationId?: MfaAuditOperationId
  eventId?: string
  result: MfaAuditResult
  reasonCode?: string
  factorState?: 'PENDING_VERIFICATION' | 'ENABLED' | 'DISABLED'
  challengeMethod?: 'totp' | 'recovery_code'
  idempotencyKey?: string
  occurredAt?: string
}

type ReceiptRow = {
  receiptId: string
  resourceId: string
  operationPath: MfaAuditReceiptOperationPath
  status: 'STARTED' | 'READY' | 'EMITTED' | 'RESOLVED' | 'UNKNOWN'
  startedAt: string
  completedAt: string | null
  correlationId: string
  causationId: string
  eventPlan: string | null
  attempt: number
}

type StoredReceiptEvent = Omit<MfaAuditReceiptEvent, 'operationId'> & {
  operationId: MfaAuditOperationId
  eventId: string
  idempotencyKey: string
  occurredAt: string
}

const validPaths = new Set<MfaAuditReceiptOperationPath>([
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
])
const validEventNames = new Set<string>(MFA_AUDIT_EVENT_NAMES)
const validResults = new Set<MfaAuditResult>(['started', 'succeeded', 'failed', 'rejected'])
const subjectPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const correlationPattern = /^[A-Za-z0-9._:-]{1,128}$/
const idempotencyPattern = /^[A-Za-z0-9._:-]{1,255}$/
const staleOperationMs = 5 * 60 * 1000
const maxBatch = 10
const maxBackoffSeconds = 300

export type MfaAuditReceiptDrainSummary = {
  selected: number
  emitted: number
  failed: number
  unknown: number
}

function safeCorrelation(value: string | null | undefined, fallback: string): string {
  return value && correlationPattern.test(value) ? value : fallback
}

function validateEvent(value: unknown): StoredReceiptEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  const event = value as Record<string, unknown>
  if (typeof event.eventType !== 'string' || !validEventNames.has(event.eventType)) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  if (typeof event.result !== 'string' || !validResults.has(event.result as MfaAuditResult)) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  if (event.operationId !== undefined &&
      (typeof event.operationId !== 'string' ||
       !isAllowedMfaAuditOperationId(event.eventType as MfaAuditEventName, event.operationId))) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  if (
    event.reasonCode !== undefined &&
    (typeof event.reasonCode !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(event.reasonCode))
  ) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  if (
    event.factorState !== undefined &&
    !['PENDING_VERIFICATION', 'ENABLED', 'DISABLED'].includes(String(event.factorState))
  ) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  if (
    event.challengeMethod !== undefined &&
    !['totp', 'recovery_code'].includes(String(event.challengeMethod))
  ) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  if (typeof event.eventId !== 'string' || !/^evt_[a-f0-9]{32}$/.test(event.eventId)) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  if (typeof event.idempotencyKey !== 'string' || !idempotencyPattern.test(event.idempotencyKey)) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  if (typeof event.occurredAt !== 'string' || !Number.isFinite(Date.parse(event.occurredAt))) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }

  const operationId = typeof event.operationId === 'string'
    ? event.operationId as MfaAuditOperationId
    : MFA_AUDIT_OPERATION_IDS[event.eventType as MfaAuditEventName][0]!
  return {
    eventType: event.eventType as MfaAuditEventName,
    operationId,
    eventId: event.eventId,
    result: event.result as MfaAuditResult,
    ...(typeof event.reasonCode === 'string' ? { reasonCode: event.reasonCode } : {}),
    ...(typeof event.factorState === 'string'
      ? { factorState: event.factorState as StoredReceiptEvent['factorState'] }
      : {}),
    ...(typeof event.challengeMethod === 'string'
      ? { challengeMethod: event.challengeMethod as StoredReceiptEvent['challengeMethod'] }
      : {}),
    idempotencyKey: event.idempotencyKey,
    occurredAt: event.occurredAt,
  }
}

function parsePlan(value: string | null): StoredReceiptEvent[] {
  if (value === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  if (!Array.isArray(parsed) || parsed.length > 4) {
    throw new Error('INVALID_MFA_AUDIT_RECEIPT_PLAN')
  }
  return parsed.map(validateEvent)
}

function mergePlan(
  receiptId: string,
  existing: StoredReceiptEvent[],
  incoming: MfaAuditReceiptEvent[],
  occurredAt: string,
): StoredReceiptEvent[] {
  const byKey = new Map(existing.map((event) => [event.idempotencyKey, event]))
  for (const input of incoming) {
    const idempotencyKey = input.idempotencyKey ??
      `mfa-operation:${receiptId}:${input.eventType}`
    const candidate = validateEvent({
      ...input,
      // An explicit invalid ID must be rejected; never silently replace caller intent.
      eventId: input.eventId ?? 'evt_' + crypto.randomUUID().replaceAll('-', ''),
      idempotencyKey,
      occurredAt: input.occurredAt ?? occurredAt,
    })
    const existingEvent = byKey.get(candidate.idempotencyKey)
    if (existingEvent) {
      const explicitEventIdConflict = input.eventId !== undefined &&
        input.eventId !== existingEvent.eventId
      const explicitOccurrenceConflict = input.occurredAt !== undefined &&
        input.occurredAt !== existingEvent.occurredAt
      const eventIntentConflict =
        existingEvent.eventType !== candidate.eventType ||
        existingEvent.operationId !== candidate.operationId ||
        existingEvent.result !== candidate.result ||
        existingEvent.reasonCode !== candidate.reasonCode ||
        existingEvent.factorState !== candidate.factorState ||
        existingEvent.challengeMethod !== candidate.challengeMethod ||
        explicitEventIdConflict ||
        explicitOccurrenceConflict
      if (eventIntentConflict) throw new Error('MFA_AUDIT_EVENT_IDEMPOTENCY_CONFLICT')
      // Keep the first durable identity and occurrence timestamp on a retry.
      continue
    }
    byKey.set(candidate.idempotencyKey, candidate)
  }
  if (byKey.size > 4) throw new Error('MFA_AUDIT_RECEIPT_PLAN_LIMIT_EXCEEDED')
  return [...byKey.values()]
}

/** Shared pure receipt-plan helpers for provider-specific persistence adapters. */
export function parseMfaAuditReceiptPlan(value: string | null): StoredReceiptEvent[] {
  return parsePlan(value)
}

export function mergeMfaAuditReceiptPlan(
  receiptId: string,
  existing: StoredReceiptEvent[],
  incoming: MfaAuditReceiptEvent[],
  occurredAt: string,
): StoredReceiptEvent[] {
  return mergePlan(receiptId, existing, incoming, occurredAt)
}
