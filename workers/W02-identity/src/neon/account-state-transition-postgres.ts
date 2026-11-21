import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'

import accountStateMachine from '../../../../contracts/state-machines/account.json'
import permissions from '../../../../contracts/authz/permissions.json'
import type { AccountState } from '../account/account-state-transition.js'
import { resolveGlobalLayerPostgres } from './role-assignment-postgres.js'

export type AccountStateTransitionPostgresErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'PRECONDITION_FAILED'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'JOURNAL_PERSISTENCE_FAILED'

export class AccountStateTransitionPostgresError extends Error {
  constructor(
    readonly code: AccountStateTransitionPostgresErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AccountStateTransitionPostgresError'
  }
}

export type AccountStateTransitionPostgresInput = {
  subjectId: string
  targetUserId: string
  to: AccountState
  reason: string
  expectedVersion: number
  correlationId?: string
  causationId?: string
}

export type AccountStateTransitionPostgresResult = {
  from: AccountState
  to: AccountState
  accountStateVersion: number
  eventId: string
  journalId: string
}

export type AccountStateTransitionPostgresClock = () => Date

type TransitionActor = 'user' | 'operator' | 'admin' | 'system'
type TransitionRule = {
  from: AccountState
  to: AccountState
  actor: TransitionActor
  permission: string | null
  precondition?: string
  requiresApproval?: boolean | string
}

type LockedAccount = {
  id: string
  accountState: AccountState
  accountStateVersion: number
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
    actorType: 'user' | 'admin'
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
const tokenInvalidationStates = new Set<AccountState>(
  accountStateMachine['x-token-invalidation-states'] as AccountState[],
)
const EVENT_TYPE = 'identity.account_state_changed' as const
const EVENT_SCHEMA_VERSION = '1.0' as const
const systemClock: AccountStateTransitionPostgresClock = () => new Date()

const permissionMinimumLayers = new Map(
  permissions['x-permissions'].map((permission) => [permission.name, permission.minLayer]),
)
const rolePermissions = new Map<string, Set<string>>()
for (const role of permissions['x-role-permissions'].roles) {
  rolePermissions.set(role.role, new Set(role.permissions))
}

function assertInput(input: AccountStateTransitionPostgresInput): void {
  if (
    !input ||
    typeof input.subjectId !== 'string' ||
    input.subjectId.length < 1 ||
    input.subjectId.length > 128 ||
    typeof input.targetUserId !== 'string' ||
    input.targetUserId.length < 1 ||
    input.targetUserId.length > 128
  ) {
    throw new AccountStateTransitionPostgresError('INVALID_INPUT', 'subjectId and targetUserId must be 1-128 characters')
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new AccountStateTransitionPostgresError('INVALID_INPUT', 'expectedVersion must be a positive integer')
  }
  if (typeof input.to !== 'string' || input.to.length < 1) {
    throw new AccountStateTransitionPostgresError('INVALID_INPUT', 'target account state is required')
  }
  if (typeof input.reason !== 'string' || input.reason.trim().length === 0 || input.reason.length > 2048) {
    throw new AccountStateTransitionPostgresError('INVALID_INPUT', 'reason must be 1-2048 characters')
  }
  for (const [field, value] of [['correlationId', input.correlationId], ['causationId', input.causationId]] as const) {
    if (value !== undefined && (typeof value !== 'string' || value.length === 0 || value.length > 255)) {
      throw new AccountStateTransitionPostgresError('INVALID_INPUT', field + ' must be 1-255 characters')
    }
  }
}

function assertServerNow(clock: AccountStateTransitionPostgresClock): Date {
  const now = clock()
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new AccountStateTransitionPostgresError('PRECONDITION_FAILED', 'W02 server clock is invalid')
  }
  return now
}

function findTransition(from: AccountState, to: AccountState): TransitionRule {
  const rule = transitionRules.find((candidate) => candidate.from === from && candidate.to === to)
  if (!rule) {
    throw new AccountStateTransitionPostgresError(
      'INVALID_STATE',
      'transition ' + from + ' -> ' + to + ' is not permitted by the canonical account state machine',
    )
  }
  return rule
}

async function lockAuthorizationFacts(
  client: PoolClient,
  subjectId: string,
): Promise<void> {
  // RoleAssignment writes advance this row through a PostgreSQL trigger. A
  // share lock serializes the authorization snapshot against grant/revoke.
  await client.query(
    'SELECT role_version FROM role_authorization_versions WHERE subject_id = $1 FOR SHARE',
    [subjectId],
  )
  await client.query(
    'SELECT id FROM role_assignments WHERE subject_id = $1 ORDER BY id FOR SHARE',
    [subjectId],
  )
  // Better Auth factor updates are serialized separately from RoleAssignment.
  await client.query(
    'SELECT "userId" FROM "twoFactor" WHERE "userId" = $1 FOR SHARE',
    [subjectId],
  )
}

async function authorizeModeratorAction(
  client: PoolClient,
  subjectId: string,
  subject: LockedAccount,
  rule: TransitionRule,
  now: string,
): Promise<'operator' | 'admin'> {
  if (rule.actor !== 'operator' && rule.actor !== 'admin') {
    throw new AccountStateTransitionPostgresError(
      'FORBIDDEN',
      'this PostgreSQL adapter only admits moderator/admin transitions; self-service and system transitions use their dedicated W02 adapters',
    )
  }
  if (rule.requiresApproval) {
    throw new AccountStateTransitionPostgresError(
      'FORBIDDEN',
      'transition requires a separately verified approval; approval-required transitions fail closed',
    )
  }
  if (rule.precondition) {
    throw new AccountStateTransitionPostgresError(
      'PRECONDITION_FAILED',
      'transition precondition is not admitted by the moderator/admin adapter: ' + rule.precondition,
    )
  }
  if (subject.accountState !== 'ACTIVE') {
    throw new AccountStateTransitionPostgresError('FORBIDDEN', 'moderator/admin subject must have an ACTIVE account')
  }
  if (!rule.permission) {
    throw new AccountStateTransitionPostgresError('FORBIDDEN', 'moderation transition permission is missing')
  }

  const minimumLayer = permissionMinimumLayers.get(rule.permission)
  if (typeof minimumLayer !== 'string' || !/^L[0-8]$/.test(minimumLayer)) {
    throw new AccountStateTransitionPostgresError('FORBIDDEN', 'transition permission authority is unavailable')
  }

  await lockAuthorizationFacts(client, subjectId)
  const resolution = await resolveGlobalLayerPostgres(client, subjectId, subject.accountState, now, true)
  if (resolution.decision !== 'ALLOW' || typeof resolution.layer !== 'string') {
    throw new AccountStateTransitionPostgresError('FORBIDDEN', 'effective global layer or required MFA is unavailable')
  }

  const requiredLayer = Number(minimumLayer.slice(1))
  const subjectLayer = Number(resolution.layer.slice(1))
  if (!Number.isInteger(subjectLayer) || subjectLayer < requiredLayer) {
    throw new AccountStateTransitionPostgresError('FORBIDDEN', 'transition permission minimum layer is not satisfied')
  }

  const hasPermission = (resolution.roleAssignments ?? [])
    .filter((assignment) => assignment.scopeType === 'global' && assignment.scopeId === null)
    .some((assignment) => rolePermissions.get(assignment.roleId)?.has(rule.permission as string) ?? false)
  if (!hasPermission) {
    throw new AccountStateTransitionPostgresError('FORBIDDEN', 'no effective global role grants the required transition permission')
  }

  return rule.actor
}

function buildEvent(
  input: AccountStateTransitionPostgresInput,
  actorType: 'operator' | 'admin',
  from: AccountState,
  nextVersion: number,
  now: string,
): AccountStateChangedEvent {
  const eventId = randomUUID()
  const actor = actorType === 'operator'
    ? { actorId: input.subjectId, actorType: 'user' as const, operationalRole: 'PLATFORM_OPERATOR' as const }
    : { actorId: input.subjectId, actorType: 'admin' as const }

  return {
    eventId,
    eventType: EVENT_TYPE,
    schemaVersion: EVENT_SCHEMA_VERSION,
    producer: 'W02',
    resourceType: 'User',
    resourceId: input.targetUserId,
    occurredAt: now,
    publishedAt: now,
    correlationId: input.correlationId ?? eventId,
    causationId: input.causationId ?? eventId,
    idempotencyKey: 'auth013-' + input.targetUserId + '-' + input.expectedVersion,
    attempt: 1,
    sourceVersion: nextVersion,
    actor,
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

/**
 * PostgreSQL-native W02 moderator/admin account-state transition.
 *
 * This is a testable persistence adapter, not a production Worker binding.
 * It admits canonical operator/admin transitions that require no separate
 * approval receipt. It re-evaluates global RoleAssignment permissions and
 * MFA in the same transaction as the state CAS and AUTH-013 outbox write.
 * Registration, email activation, lifecycle windows, system jobs, and
 * approval-required transitions remain on their dedicated W02 paths.
 */
export async function applyModeratorAccountStateTransitionPostgres(
  pool: Pool,
  input: AccountStateTransitionPostgresInput,
  clock: AccountStateTransitionPostgresClock = systemClock,
): Promise<AccountStateTransitionPostgresResult> {
  assertInput(input)

  const client = await pool.connect()
  let transactionOpen = false

  try {
    await client.query('BEGIN')
    transactionOpen = true

    // Lock both identities in a stable order so opposing moderation requests
    // cannot deadlock by acquiring actor/target rows in opposite order.
    const accountIds = [...new Set([input.subjectId, input.targetUserId])].sort()
    const locked = await client.query<LockedAccount>(
      'SELECT id, account_state AS "accountState", ' +
        'account_state_version AS "accountStateVersion" ' +
        'FROM "user" WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE',
      [accountIds],
    )
    const target = locked.rows.find((row) => row.id === input.targetUserId)
    if (!target) {
      throw new AccountStateTransitionPostgresError('NOT_FOUND', 'target user account not found')
    }
    const subject = locked.rows.find((row) => row.id === input.subjectId)
    if (!subject) {
      throw new AccountStateTransitionPostgresError('FORBIDDEN', 'moderator/admin subject account not found')
    }
    if (input.subjectId === input.targetUserId) {
      throw new AccountStateTransitionPostgresError('FORBIDDEN', 'moderator/admin cannot apply account moderation to self')
    }

    const rule = findTransition(target.accountState, input.to)
    if (Number(target.accountStateVersion) !== input.expectedVersion) {
      throw new AccountStateTransitionPostgresError('CONFLICT', 'account state version does not match If-Match')
    }

    const now = assertServerNow(clock).toISOString()
    const actorType = await authorizeModeratorAction(client, input.subjectId, subject, rule, now)
    const nextVersion = input.expectedVersion + 1
    const event = buildEvent(input, actorType, target.accountState, nextVersion, now)
    const journalId = randomUUID()

    const updated = await client.query<{ accountStateVersion: number }>(
      'UPDATE "user" SET account_state = $1, account_state_version = account_state_version + 1, ' +
        'updated_at = $2 WHERE id = $3 AND account_state = $4 AND account_state_version = $5 ' +
        'RETURNING account_state_version AS "accountStateVersion"',
      [input.to, now, input.targetUserId, target.accountState, input.expectedVersion],
    )
    if (updated.rowCount !== 1) {
      throw new AccountStateTransitionPostgresError('CONFLICT', 'account state compare-and-set did not update exactly one row')
    }

    const inserted = await client.query<{ journalId: string }>(
      'INSERT INTO auth_013_publication_journal ' +
        '(journal_id, event_id, event_type, schema_version, resource_id, source_version, payload, status, attempt, next_attempt_at, created_at, published_at, last_error_code) ' +
        "VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', 1, NULL, $8, NULL, NULL) " +
        'RETURNING journal_id AS "journalId"',
      [
        journalId,
        event.eventId,
        event.eventType,
        event.schemaVersion,
        event.resourceId,
        event.sourceVersion,
        JSON.stringify(event),
        now,
      ],
    )
    if (inserted.rowCount !== 1 || !inserted.rows[0]?.journalId) {
      throw new Error('AUTH013_ACCOUNT_STATE_JOURNAL_INSERT_INCOMPLETE')
    }

    if (tokenInvalidationStates.has(input.to)) {
      await client.query('DELETE FROM "session" WHERE user_id = $1', [input.targetUserId])
    }

    await client.query('COMMIT')
    transactionOpen = false
    return {
      from: target.accountState,
      to: input.to,
      accountStateVersion: Number(updated.rows[0]?.accountStateVersion ?? nextVersion),
      eventId: event.eventId,
      journalId,
    }
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK')
      } catch {
        throw new AccountStateTransitionPostgresError(
          'JOURNAL_PERSISTENCE_FAILED',
          'account-state transaction rollback failed',
        )
      }
    }
    if (error instanceof AccountStateTransitionPostgresError) throw error

    const pgCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
    if (pgCode === '23505' || pgCode === '40001' || pgCode === '40P01') {
      throw new AccountStateTransitionPostgresError(
        'CONFLICT',
        'account state changed concurrently or duplicate publication was rejected',
      )
    }

    throw new AccountStateTransitionPostgresError(
      'JOURNAL_PERSISTENCE_FAILED',
      'account state and AUTH-013 publication journal transaction failed',
    )
  } finally {
    client.release()
  }
}
