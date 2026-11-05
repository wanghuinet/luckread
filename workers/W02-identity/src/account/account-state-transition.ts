import accountStateMachine from '../../../../contracts/state-machines/account.json'
import permissions from '../../../../contracts/authz/permissions.json'
import layers from '../../../../contracts/authz/layers.json'

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

const COOLING_OFF_WINDOW_MS = 15 * 24 * 60 * 60 * 1000
const REACTIVATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

const TIMED_LIFECYCLE_PRECONDITIONS = new Set([
  'within_cooling_off',
  'cooling_off_elapsed',
  'within_reactivation_window',
])

type LifecycleWindowSnapshot = {
  deletionRequestedAt: string | null
  deletedAt: string | null
}

function assertTimestampWindow(
  timestamp: string | null,
  now: string,
  windowMs: number,
  expected: 'within' | 'elapsed',
  precondition: string,
): void {
  const timestampMs = Date.parse(timestamp ?? '')
  const nowMs = Date.parse(now)
  const isCanonicalUtc = Number.isFinite(timestampMs) &&
    new Date(timestampMs).toISOString() === timestamp
  if (!isCanonicalUtc || !Number.isFinite(nowMs) || timestampMs > nowMs) {
    throw new AccountStateTransitionError('PRECONDITION_FAILED', 'trusted lifecycle timestamp is missing or invalid')
  }

  const elapsedMs = nowMs - timestampMs
  const satisfied = expected === 'within' ? elapsedMs < windowMs : elapsedMs >= windowMs
  if (!satisfied) {
    throw new AccountStateTransitionError('PRECONDITION_FAILED', 'precondition failed: ' + precondition)
  }
}

function assertRequirements(
  rule: TransitionRule,
  input: AccountStateTransitionInput,
  now: string,
  lifecycleWindow: LifecycleWindowSnapshot | null,
  trustedPreconditions: ReadonlySet<string>,
): void {
  if (rule.precondition) {
    if (TIMED_LIFECYCLE_PRECONDITIONS.has(rule.precondition)) {
      if (!lifecycleWindow) {
        throw new AccountStateTransitionError('PRECONDITION_FAILED', 'trusted lifecycle timestamp is unavailable')
      }
      if (rule.precondition === 'within_cooling_off') {
        assertTimestampWindow(
          lifecycleWindow.deletionRequestedAt,
          now,
          COOLING_OFF_WINDOW_MS,
          'within',
          rule.precondition,
        )
      } else if (rule.precondition === 'cooling_off_elapsed') {
        assertTimestampWindow(
          lifecycleWindow.deletionRequestedAt,
          now,
          COOLING_OFF_WINDOW_MS,
          'elapsed',
          rule.precondition,
        )
      } else {
        assertTimestampWindow(
          lifecycleWindow.deletedAt,
          now,
          REACTIVATION_WINDOW_MS,
          'within',
          rule.precondition,
        )
      }
    } else if (!trustedPreconditions.has(rule.precondition)) {
      // Unknown/provider-owned preconditions remain fail-closed. They can only
      // be satisfied by a dedicated W02 service after proving its authority.
      throw new AccountStateTransitionError('PRECONDITION_FAILED', 'precondition failed: ' + rule.precondition)
    }
  }

  if (rule.requiresApproval) {
    const requiredLevel = rule.requiresApproval === true ? 'L7' : rule.requiresApproval
    if (input.approvalLevel !== requiredLevel) {
      throw new AccountStateTransitionError('FORBIDDEN', 'approval level ' + requiredLevel + ' is required')
    }
  }
}

function lifecycleTimestampAssignments(
  from: AccountState,
  to: AccountState,
  now: string,
): { assignments: string[]; bindings: string[] } {
  if (from === 'ACTIVE' && to === 'DELETION_REQUESTED') {
    return {
      assignments: ['deletion_requested_at = ?', 'deleted_at = NULL'],
      bindings: [now],
    }
  }

  if (
    ((from === 'DELETION_REQUESTED' || from === 'DELETION_PENDING') && to === 'ACTIVE') ||
    (from === 'REACTIVATED' && to === 'ACTIVE')
  ) {
    return {
      assignments: ['deletion_requested_at = NULL', 'deleted_at = NULL'],
      bindings: [],
    }
  }

  if (from === 'DELETION_PENDING' && to === 'DELETED') {
    return {
      assignments: ['deleted_at = ?'],
      bindings: [now],
    }
  }

  return { assignments: [], bindings: [] }
}

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
  if (input.now !== undefined && !Number.isFinite(Date.parse(input.now))) {
    throw new AccountStateTransitionError('INVALID_INPUT', 'now must be a valid ISO timestamp')
  }
  for (const [field, value] of [['correlationId', input.correlationId], ['causationId', input.causationId]] as const) {
    if (value !== undefined && (value.length === 0 || value.length > 255)) {
      throw new AccountStateTransitionError('INVALID_INPUT', field + ' must be 1-255 characters')
    }
  }
}

type AccountAuthorizationResult = {
  actor: AccountStateTransitionInput['actor']
  permission: string | null
  approvalLevel: string | null
}

const permissionMinLayer = new Map(
  permissions['x-permissions'].map((permission) => [permission.name, permission.minLayer]),
)

const roleToLayer = new Map<string, number>()
for (const layer of layers['x-layers']) {
  for (const role of layer.roles ?? []) roleToLayer.set(role, Number(layer.id.slice(1)))
}

// The canonical transition budget allows 64 D1 rows across three reads:
// target User during authorization (1), effective role assignments (62),
// and target User during the compare-and-set transition (1).
const MAX_AUTHORIZATION_ROLE_ASSIGNMENT_ROWS = 62

const roleLayerPriority = [...roleToLayer.entries()].sort(([roleA, layerA], [roleB, layerB]) =>
  layerB - layerA || (roleA < roleB ? -1 : roleA > roleB ? 1 : 0),
)

const rolePermissions = new Map<string, Set<string>>()
for (const role of permissions['x-role-permissions'].roles) {
  rolePermissions.set(role.role, new Set(role.permissions))
}

type SubjectAuthorization = {
  layer: number
  grantedPermissions: Set<string>
}

async function resolveSubjectAuthorization(
  db: D1Database,
  subjectId: string,
  now: string,
): Promise<SubjectAuthorization> {
  const layerCase = roleLayerPriority.map(() => 'WHEN ? THEN ?').join(' ')
  const roleLayerBindings = roleLayerPriority.flatMap(([roleId, layer]) => [roleId, layer])
  const rows = await db.prepare(
    `SELECT DISTINCT role_id AS roleId, scope_type AS scopeType
     FROM role_assignments
     WHERE subject_id = ? AND status = 'ACTIVE' AND valid_from <= ?
       AND (valid_until IS NULL OR ? < valid_until)
       AND scope_type = 'global' AND scope_id IS NULL
     ORDER BY CASE role_id ${layerCase} ELSE -1 END DESC, role_id ASC
     LIMIT ${MAX_AUTHORIZATION_ROLE_ASSIGNMENT_ROWS}`,
  ).bind(subjectId, now, now, ...roleLayerBindings).all<{ roleId: string; scopeType: string }>()

  let maxLayer = 0
  const grantedPermissions = new Set<string>()
  for (const row of rows.results) {
    if (row.scopeType !== 'global') continue
    const layer = roleToLayer.get(row.roleId)
    if (layer && layer > maxLayer) maxLayer = layer
    for (const permission of rolePermissions.get(row.roleId) ?? []) {
      grantedPermissions.add(permission)
    }
  }
  return { layer: maxLayer, grantedPermissions }
}

export async function authorizeAccountStateTransition(
  db: D1Database,
  input: { subjectId: string; targetUserId: string; to: AccountState; now?: string },
): Promise<AccountAuthorizationResult> {
  const now = input.now ?? new Date().toISOString()
  if (!input.subjectId || !input.targetUserId) {
    throw new AccountStateTransitionError('FORBIDDEN', 'authenticated subject is required')
  }

  const current = await db
    .prepare(
      'SELECT account_state AS accountState FROM "user" WHERE id = ? LIMIT 1',
    )
    .bind(input.targetUserId)
    .first<{ accountState: AccountState }>()

  if (!current) throw new AccountStateTransitionError('NOT_FOUND', 'user account not found')
  const rule = findTransition(current.accountState, input.to)

  if (rule.actor === 'user') {
    if (input.subjectId !== input.targetUserId) {
      throw new AccountStateTransitionError('FORBIDDEN', 'user transition requires the target user as actor')
    }
    if (!rule.permission) {
      return { actor: { id: input.subjectId, type: 'user' }, permission: null, approvalLevel: null }
    }
  }

  if (!rule.permission) {
    throw new AccountStateTransitionError('FORBIDDEN', 'transition authorization is missing')
  }

  const minimumLayer = permissionMinLayer.get(rule.permission)
  if (typeof minimumLayer !== 'string' || !/^L[0-8]$/.test(minimumLayer)) {
    throw new AccountStateTransitionError('FORBIDDEN', 'transition permission authority is unavailable')
  }

  const requiredLayer = Number(minimumLayer.slice(1))
  const subjectAuthorization = await resolveSubjectAuthorization(db, input.subjectId, now)
  if (subjectAuthorization.layer < requiredLayer) {
    throw new AccountStateTransitionError('FORBIDDEN', 'transition permission denied')
  }

  if (rule.actor === 'user') {
    // Self-owned permissionful transitions still require an effective role
    // that explicitly grants the permission; layer membership alone is not
    // an authorization grant.
    if (!subjectAuthorization.grantedPermissions.has(rule.permission)) {
      throw new AccountStateTransitionError('FORBIDDEN', 'transition permission is not granted by an effective role')
    }
    return {
      actor: { id: input.subjectId, type: 'user' },
      permission: rule.permission,
      approvalLevel: null,
    }
  }

  const actorType = rule.actor
  if (actorType !== 'operator' && actorType !== 'admin') {
    throw new AccountStateTransitionError('FORBIDDEN', 'transition actor authority is unavailable')
  }

  return {
    actor: { id: input.subjectId, type: actorType },
    permission: rule.permission,
    approvalLevel: rule.requiresApproval ? (rule.requiresApproval === true ? 'L7' : rule.requiresApproval) : null,
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

async function applyAccountStateTransitionInternal(
  db: D1Database,
  input: AccountStateTransitionInput,
  additionalStatements: D1PreparedStatement[] = [],
  trustedPreconditions: ReadonlySet<string> = new Set(),
): Promise<AccountStateTransitionResult> {
  assertInput(input)
  const now = input.now ?? new Date().toISOString()

  const current = await db
    .prepare(
      'SELECT account_state AS accountState, account_state_version AS accountStateVersion FROM "user" WHERE id = ? LIMIT 1',
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

  let lifecycleWindow: LifecycleWindowSnapshot | null = null
  if (rule.precondition && TIMED_LIFECYCLE_PRECONDITIONS.has(rule.precondition)) {
    const timestamps = await db
      .prepare(
        'SELECT deletion_requested_at AS deletionRequestedAt, deleted_at AS deletedAt FROM "user" WHERE id = ? LIMIT 1',
      )
      .bind(input.userId)
      .first<LifecycleWindowSnapshot>()
    if (!timestamps) {
      throw new AccountStateTransitionError('NOT_FOUND', 'user lifecycle timestamps not found')
    }
    lifecycleWindow = timestamps
  }
  assertRequirements(rule, input, now, lifecycleWindow, trustedPreconditions)

  const nextVersion = input.expectedVersion + 1
  const event = buildEvent(input, from, nextVersion, now)
  const journalId = crypto.randomUUID()
  const payload = JSON.stringify(event)

  const lifecycleAssignments = lifecycleTimestampAssignments(from, input.to, now)
  const lifecycleSetSql = lifecycleAssignments.assignments.length > 0
    ? ', ' + lifecycleAssignments.assignments.join(', ')
    : ''
  const updateStatement = db
    .prepare(
      'UPDATE "user" SET account_state = ?, account_state_version = account_state_version + 1, updated_at = ?' +
      lifecycleSetSql +
      ' WHERE id = ? AND account_state = ? AND account_state_version = ?',
    )
    .bind(input.to, now, ...lifecycleAssignments.bindings, input.userId, from, input.expectedVersion)

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
          'DELETE FROM "session" WHERE user_id = ?',
        )
        .bind(input.userId),
    )
  }
  const additionalStartIndex = statements.length
  statements.push(...additionalStatements)

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
    batchResult[1]?.meta?.changes !== 1 ||
    batchResult.slice(additionalStartIndex).some((result) =>
      typeof result?.meta?.changes !== 'number' || result.meta.changes < 1
    )
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

export async function applyAccountStateTransition(
  db: D1Database,
  input: AccountStateTransitionInput,
): Promise<AccountStateTransitionResult> {
  return applyAccountStateTransitionInternal(db, input)
}

export type EmailVerifiedActivationResult = {
  activated: boolean
  accountState: AccountState
  accountStateVersion: number
}

/**
 * Called only after Better Auth proves the email-verification token or returns
 * an authenticated session whose emailVerified flag is true. Account activation
 * and the L2 role grant share the same D1 batch with the account-state journal.
 */
export async function activateEmailVerifiedAccount(
  db: D1Database,
  userId: string,
  now = new Date().toISOString(),
): Promise<EmailVerifiedActivationResult> {
  if (typeof userId !== 'string' || userId.length === 0 || userId.length > 128) {
    throw new AccountStateTransitionError('INVALID_INPUT', 'userId is invalid')
  }
  if (!Number.isFinite(Date.parse(now))) {
    throw new AccountStateTransitionError('INVALID_INPUT', 'activation timestamp is invalid')
  }

  const current = await db
    .prepare(
      'SELECT account_state AS accountState, account_state_version AS accountStateVersion FROM "user" WHERE id = ? LIMIT 1',
    )
    .bind(userId)
    .first<{ accountState: AccountState; accountStateVersion: number }>()

  if (!current) {
    throw new AccountStateTransitionError('NOT_FOUND', 'user account not found')
  }

  if (current.accountState !== 'PENDING_VERIFICATION') {
    return {
      activated: false,
      accountState: current.accountState,
      accountStateVersion: current.accountStateVersion,
    }
  }

  const roleAssignmentStatement = db
    .prepare(
      "INSERT INTO role_assignments (id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at) VALUES (?, ?, 'verified_user', 'global', NULL, 'ACTIVE', ?, NULL, ?, ?)",
    )
    .bind('verified-user-' + userId, userId, now, now, now)

  try {
    const result = await applyAccountStateTransitionInternal(
      db,
      {
        userId,
        to: 'ACTIVE',
        reason: 'email_verified',
        expectedVersion: current.accountStateVersion,
        actor: { id: userId, type: 'user' },
        permission: null,
        now,
      },
      [roleAssignmentStatement],
      new Set(['phone_or_email_verified']),
    )

    return {
      activated: true,
      accountState: result.to,
      accountStateVersion: result.accountStateVersion,
    }
  } catch (error) {
    // A concurrent verification may win the optimistic state/version check.
    // Treat that race as successful only if the winning atomic batch left both
    // ACTIVE state and an effective verified_user assignment behind.
    if (error instanceof AccountStateTransitionError && error.code === 'CONFLICT') {
      const settled = await db
        .prepare(
          'SELECT account_state AS accountState, account_state_version AS accountStateVersion FROM "user" WHERE id = ? LIMIT 1',
        )
        .bind(userId)
        .first<{ accountState: AccountState; accountStateVersion: number }>()
      if (settled?.accountState === 'ACTIVE') {
        const assignment = await db
          .prepare(
            "SELECT 1 AS present FROM role_assignments WHERE subject_id = ? AND role_id = 'verified_user' AND scope_type = 'global' AND status = 'ACTIVE' AND valid_from <= ? AND (valid_until IS NULL OR ? < valid_until) LIMIT 1",
          )
          .bind(userId, now, now)
          .first<{ present: number }>()
        if (assignment) {
          return {
            activated: false,
            accountState: settled.accountState,
            accountStateVersion: settled.accountStateVersion,
          }
        }
      }
    }
    throw error
  }
}
