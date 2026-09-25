import accountStateMachine from '../../../../contracts/state-machines/account.json'

export type AccountState =
  | 'UNREGISTERED'
  | 'PENDING_VERIFICATION'
  | 'ACTIVE'
  | 'RESTRICTED'
  | 'FROZEN'
  | 'SUSPENDED'
  | 'BANNED'
  | 'DELETION_REQUESTED'
  | 'DELETION_PENDING'
  | 'DELETED'
  | 'RESTORED'
  | 'REACTIVATED'

export type AccountActorType = 'user' | 'operator' | 'admin' | 'system' | 'job'

export type AccountStateTransitionInput = {
  userId: string
  to: AccountState
  reason: string
  expectedVersion: number
  actor: {
    id: string
    type: AccountActorType
  }
  permission?: string | null
  approvalLevel?: string | null
  preconditionSatisfied?: boolean
  now?: string
  correlationId?: string
  causationId?: string
}

export type AccountStateTransitionResult = {
  from: AccountState
  to: AccountState
  accountStateVersion: number
  eventId: string
  journalId: string
}

export class AccountStateTransitionError extends Error {
  constructor(
    readonly code:
      | 'INVALID_INPUT'
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'PRECONDITION_FAILED'
      | 'CONFLICT'
      | 'INVALID_STATE'
      | 'JOURNAL_PERSISTENCE_FAILED',
    message: string,
  ) {
    super(message)
  }
}

type TransitionRule = {
  from: AccountState
  to: AccountState
  actor: AccountActorType
  permission: string | null
  precondition?: string
  requiresApproval?: boolean | string
}

type AccountStateChangedEvent = {
  eventId: string
  eventType: 'identity.account_state_changed'
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
  actor: {
    actorId: string
    actorType: 'user' | 'service' | 'admin' | 'system' | 'job'
    operationalRole?: 'PLATFORM_OPERATOR'
  }
  before: {
    accountState: AccountState
    accountStateVersion: number
  }
  after: {
    accountState: AccountState
    accountStateVersion: number
  }
  reason: string
}

const transitionRules = accountStateMachine['x-transitions'] as TransitionRule[]

const EVENT_TYPE = 'identity.account_state_changed' as const
const EVENT_SCHEMA_VERSION = '1.0' as const
const SESSION_INVALIDATION_STATES = new Set<AccountState>([
  'SUSPENDED',
  'BANNED',
  'DELETION_PENDING',
  'DELETED',
])

function assertInput(input: AccountStateTransitionInput): void {
  if (!input || typeof input.userId !== 'string' || input.userId.length === 0) {
    throw new AccountStateTransitionError('INVALID_INPUT', 'userId is required')
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new AccountStateTransitionError('INVALID_INPUT', 'expectedVersion must be a positive integer')
  }
  if (typeof input.reason !== 'string' || input.reason.trim().length === 0 || input.reason.length > 2048) {
    throw new AccountStateTransitionError('INVALID_INPUT', 'reason must be 1-2048 characters')
  }
  if (!input.actor || typeof input.actor.id !== 'string' || input.actor.id.length === 0) {
    throw new AccountStateTransitionError('INVALID_INPUT', 'actor id is required')
  }
  for (const [field, value] of [['correlationId', input.correlationId], ['causationId', input.causationId]] as const) {
    if (value !== undefined && (value.length === 0 || value.length > 255)) {
      throw new AccountStateTransitionError('INVALID_INPUT', field + ' must be 1-255 characters')
    }
  }
}

function findTransition(from: AccountState, to: AccountState): TransitionRule {
  const transition = transitionRules.find((rule) => rule.from === from && rule.to === to)
  if (!transition) {
    throw new AccountStateTransitionError(
      'INVALID_STATE',
      'transition ' + from + ' -> ' + to + ' is not permitted by the canonical account state machine',
    )
  }
  return transition
}

function assertActor(rule: TransitionRule, input: AccountStateTransitionInput): void {
  if (rule.actor === 'user') {
    if (input.actor.type !== 'user' || input.actor.id !== input.userId) {
      throw new AccountStateTransitionError('FORBIDDEN', 'user transition requires the target user as actor')
    }
  } else if (rule.actor === 'system') {
    if (input.actor.type !== 'system' && input.actor.type !== 'job') {
      throw new AccountStateTransitionError('FORBIDDEN', 'system transition requires a system/job actor')
    }
  } else if (input.actor.type !== rule.actor) {
    throw new AccountStateTransitionError('FORBIDDEN', 'transition requires ' + rule.actor + ' actor')
  }

  if (rule.permission !== (input.permission ?? null)) {
    throw new AccountStateTransitionError('FORBIDDEN', 'required transition permission is missing or mismatched')
  }
}

function assertRequirements(rule: TransitionRule, input: AccountStateTransitionInput): void {
  if (rule.precondition && input.preconditionSatisfied !== true) {
    throw new AccountStateTransitionError('PRECONDITION_FAILED', 'precondition failed: ' + rule.precondition)
  }

  if (rule.requiresApproval) {
    const requiredLevel = rule.requiresApproval === true ? 'L7' : rule.requiresApproval
    if (input.approvalLevel !== requiredLevel) {
      throw new AccountStateTransitionError('FORBIDDEN', 'approval level ' + requiredLevel + ' is required')
    }
  }
}

function buildActor(input: AccountStateTransitionInput): AccountStateChangedEvent['actor'] {
  if (input.actor.type === 'operator') {
    return {
      actorId: input.actor.id,
      actorType: 'user',
      operationalRole: 'PLATFORM_OPERATOR',
    }
  }
  return {
    actorId: input.actor.id,
    actorType: input.actor.type,
  }
}

function buildEvent(
  input: AccountStateTransitionInput,
  from: AccountState,
  nextVersion: number,
  now: string,
): AccountStateChangedEvent {
  const eventId = crypto.randomUUID()
  const correlationId = input.correlationId ?? eventId
  const causationId = input.causationId ?? eventId
  const idempotencyKey = 'auth013-' + input.userId + '-' + input.expectedVersion

  return {
    eventId,
    eventType: EVENT_TYPE,
    schemaVersion: EVENT_SCHEMA_VERSION,
    producer: 'W02',
    resourceType: 'User',
    resourceId: input.userId,
    occurredAt: now,
    publishedAt: now,
    correlationId,
    causationId,
    idempotencyKey,
    attempt: 1,
    sourceVersion: nextVersion,
    actor: buildActor(input),
    before: {
      accountState: from,
      accountStateVersion: input.expectedVersion,
    },
    after: {
      accountState: input.to,
      accountStateVersion: nextVersion,
    },
    reason: input.reason,
  }
}

export async function applyAccountStateTransition(
  db: D1Database,
  input: AccountStateTransitionInput,
): Promise<AccountStateTransitionResult> {
  assertInput(input)

  const current = await db
    .prepare(
      'SELECT account_state AS accountState, account_state_version AS accountStateVersion FROM users WHERE id = ? LIMIT 1',
    )
    .bind(input.userId)
    .first<{ accountState: AccountState; accountStateVersion: number }>()

  if (!current) {
    throw new AccountStateTransitionError('NOT_FOUND', 'user account not found')
  }

  const from = current.accountState
  const rule = findTransition(from, input.to)

  if (current.accountStateVersion !== input.expectedVersion) {
    throw new AccountStateTransitionError('CONFLICT', 'account state version does not match If-Match')
  }

  assertActor(rule, input)
  assertRequirements(rule, input)

  const now = input.now ?? new Date().toISOString()
  const nextVersion = input.expectedVersion + 1
  const event = buildEvent(input, from, nextVersion, now)
  const journalId = crypto.randomUUID()
  const payload = JSON.stringify(event)

  const updateStatement = db
    .prepare(
      'UPDATE users SET account_state = ?, account_state_version = account_state_version + 1, updated_at = ? WHERE id = ? AND account_state = ? AND account_state_version = ?',
    )
    .bind(input.to, now, input.userId, from, input.expectedVersion)

  const journalStatement = db
    .prepare(
      'INSERT INTO auth_013_publication_journal (journal_id, event_id, event_type, schema_version, resource_id, source_version, payload, status, attempt, next_attempt_at, created_at, published_at, last_error_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      journalId,
      event.eventId,
      event.eventType,
      event.schemaVersion,
      event.resourceId,
      event.sourceVersion,
      payload,
      'PENDING',
      1,
      null,
      now,
      null,
      null,
    )

  const statements = [updateStatement, journalStatement]
  if (SESSION_INVALIDATION_STATES.has(input.to)) {
    statements.push(
      db
        .prepare(
          'UPDATE auth_session_state SET revoked_at = COALESCE(revoked_at, ?), last_seen_at = ? WHERE user_id = ? AND revoked_at IS NULL',
        )
        .bind(now, now, input.userId),
    )
  }

  let batchResult: D1Result[]
  try {
    batchResult = await db.batch(statements)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('UNIQUE constraint failed')) {
      throw new AccountStateTransitionError(
        'CONFLICT',
        'account state changed concurrently; durable publication journal prevented duplicate publication',
      )
    }
    throw new AccountStateTransitionError(
      'JOURNAL_PERSISTENCE_FAILED',
      'account state and durable publication journal transaction failed: ' + message,
    )
  }

  if (
    batchResult.length !== statements.length ||
    batchResult[0]?.meta?.changes !== 1 ||
    batchResult[1]?.meta?.changes !== 1
  ) {
    throw new AccountStateTransitionError(
      'CONFLICT',
      'account state transition did not commit the required state, journal, and security side-effect statements',
    )
  }

  return {
    from,
    to: input.to,
    accountStateVersion: nextVersion,
    eventId: event.eventId,
    journalId,
  }
}
