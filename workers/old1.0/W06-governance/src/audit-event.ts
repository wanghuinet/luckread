export type AuditActorType = 'user' | 'service' | 'admin' | 'system' | 'job'

export interface AuditActor {
  actorId: string
  actorType: AuditActorType
  layer?: `L${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
  sessionId?: string
  impersonatingActorId?: string
}

export interface AuditEvent {
  eventId: string
  requestId?: string
  traceId?: string
  actor: AuditActor
  action: string
  targetType: string
  targetId: string
  before: Record<string, unknown>
  after: Record<string, unknown>
  reason?: string
  ip?: string
  userAgent?: string
  occurredAt: string
}

export interface AccountStateChangedAuditInput {
  eventId: string
  requestId?: string
  traceId?: string
  actor: AuditActor
  userId: string
  beforeState: string
  beforeVersion: number
  afterState: string
  afterVersion: number
  occurredAt: string
  reason?: string
  ip?: string
  userAgent?: string
}

/**
 * Builds the canonical immutable AuditEvent record for an accepted
 * AUTH-013 account-state transition.
 *
 * Persistence/publication remains outside this pure constructor; the admitted
 * W06 runtime boundary invokes this constructor before D1-03 persistence.
 */
export function buildAccountStateChangedAuditEvent(
  input: AccountStateChangedAuditInput,
): AuditEvent {
  const requiredStrings: Array<[string, string]> = [
    ['eventId', input.eventId],
    ['actor.actorId', input.actor.actorId],
    ['userId', input.userId],
    ['beforeState', input.beforeState],
    ['afterState', input.afterState],
    ['occurredAt', input.occurredAt],
  ]

  for (const [name, value] of requiredStrings) {
    if (value.trim().length === 0) {
      throw new Error(`INVALID_AUDIT_EVENT: ${name} is required`)
    }
  }

  if (!Number.isInteger(input.beforeVersion) || input.beforeVersion < 1) {
    throw new Error('INVALID_AUDIT_EVENT: beforeVersion must be a positive integer')
  }

  if (!Number.isInteger(input.afterVersion) || input.afterVersion < 1) {
    throw new Error('INVALID_AUDIT_EVENT: afterVersion must be a positive integer')
  }

  if (input.afterVersion !== input.beforeVersion + 1) {
    throw new Error('INVALID_AUDIT_EVENT: account_state_version must increment exactly once')
  }

  return {
    eventId: input.eventId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.traceId ? { traceId: input.traceId } : {}),
    actor: input.actor,
    action: 'identity.account_state_changed',
    targetType: 'User',
    targetId: input.userId,
    before: {
      account_state: input.beforeState,
      account_state_version: input.beforeVersion,
    },
    after: {
      account_state: input.afterState,
      account_state_version: input.afterVersion,
    },
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.ip ? { ip: input.ip } : {}),
    ...(input.userAgent ? { userAgent: input.userAgent } : {}),
    occurredAt: input.occurredAt,
  }
}
