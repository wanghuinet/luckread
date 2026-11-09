import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'

import permissions from '../../../../contracts/authz/permissions.json'
import layers from '../../../../contracts/authz/layers.json'

const COOLING_OFF_MS = 15 * 24 * 60 * 60 * 1000
const REACTIVATION_MS = 30 * 24 * 60 * 60 * 1000
const INVALIDATE_SESSION_STATES = new Set(['DELETION_PENDING', 'DELETED'])

export type AccountLifecyclePostgresErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'PRECONDITION_FAILED'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'JOURNAL_PERSISTENCE_FAILED'

export class AccountLifecyclePostgresError extends Error {
  constructor(
    readonly code: AccountLifecyclePostgresErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AccountLifecyclePostgresError'
  }
}

export type AccountLifecyclePostgresInput = {
  userId: string
  expectedVersion: number
}

export type AccountLifecycleSelfPostgresInput = AccountLifecyclePostgresInput & {
  subjectUserId: string
}

export type AccountLifecycleJobPostgresInput = AccountLifecyclePostgresInput & {
  actorId: string
}

export type AccountLifecyclePostgresResult = {
  from: string
  to: string
  accountStateVersion: number
  eventId: string
  journalId: string
}

export type AccountLifecycleServerClock = () => Date

type CurrentAccount = {
  accountState: string
  accountStateVersion: number
  deletionRequestedAt: Date | string | null
  deletedAt: Date | string | null
}

type LifecycleTimestamps = {
  deletionRequestedAt: Date | null
  deletedAt: Date | null
}

type EventActor = {
  actorId: string
  actorType: 'user' | 'job'
}

type TransitionPolicy = {
  from: readonly string[]
  to: string
  actor: EventActor
  reason: string
  resolveTimestamps: (
    client: PoolClient,
    current: CurrentAccount,
    now: Date,
  ) => Promise<LifecycleTimestamps>
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
  actor: EventActor
  before: {
    accountState: string
    accountStateVersion: number
  }
  after: {
    accountState: string
    accountStateVersion: number
  }
  reason: string
}

const permissionGrants = new Map<string, Set<string>>()
for (const role of permissions['x-role-permissions'].roles) {
  permissionGrants.set(role.role, new Set(role.permissions))
}
const permissionMinimumLayers = new Map(
  permissions['x-permissions'].map((permission) => [permission.name, permission.minLayer]),
)
const roleLayers = new Map<string, number>()
for (const layer of layers['x-layers']) {
  for (const role of layer.roles ?? []) roleLayers.set(role, Number(layer.id.slice(1)))
}

const systemClock: AccountLifecycleServerClock = () => new Date()

function assertInput(input: AccountLifecyclePostgresInput): void {
  if (
    !input ||
    typeof input.userId !== 'string' ||
    input.userId.length < 1 ||
    input.userId.length > 128
  ) {
    throw new AccountLifecyclePostgresError('INVALID_INPUT', 'userId must be 1-128 characters')
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new AccountLifecyclePostgresError('INVALID_INPUT', 'expectedVersion must be a positive integer')
  }
}

function assertSelfInput(input: AccountLifecycleSelfPostgresInput): void {
  assertInput(input)
  if (
    typeof input.subjectUserId !== 'string' ||
    input.subjectUserId.length === 0 ||
    input.subjectUserId !== input.userId
  ) {
    throw new AccountLifecyclePostgresError('FORBIDDEN', 'self-service lifecycle transition requires the authenticated subject to equal the target user')
  }
}

function assertJobInput(input: AccountLifecycleJobPostgresInput): void {
  assertInput(input)
  if (typeof input.actorId !== 'string' || input.actorId.length === 0 || input.actorId.length > 128) {
    throw new AccountLifecyclePostgresError('INVALID_INPUT', 'system actor id is required')
  }
}

function assertServerNow(clock: AccountLifecycleServerClock): Date {
  const now = clock()
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new AccountLifecyclePostgresError('PRECONDITION_FAILED', 'W02 server clock is invalid')
  }
  return now
}

function requireTrustedTimestamp(
  value: Date | string | null,
  field: string,
  now: Date,
): Date {
  let timestamp: Date
  if (value instanceof Date) {
    timestamp = value
  } else if (typeof value === 'string') {
    timestamp = new Date(value)
    if (
      !Number.isFinite(timestamp.getTime()) ||
      timestamp.toISOString() !== value
    ) {
      throw new AccountLifecyclePostgresError('PRECONDITION_FAILED', field + ' is not canonical UTC ISO-8601')
    }
  } else {
    throw new AccountLifecyclePostgresError('PRECONDITION_FAILED', field + ' is missing; lifecycle decision fails closed')
  }

  if (!Number.isFinite(timestamp.getTime())) {
    throw new AccountLifecyclePostgresError('PRECONDITION_FAILED', field + ' is malformed')
  }
  if (timestamp.getTime() > now.getTime()) {
    throw new AccountLifecyclePostgresError('PRECONDITION_FAILED', field + ' is in the future')
  }
  return timestamp
}

function requireNoDeletedTimestamp(current: CurrentAccount): void {
  if (current.deletedAt !== null) {
    throw new AccountLifecyclePostgresError('PRECONDITION_FAILED', 'deleted_at must be empty before the account reaches DELETED')
  }
}

function assertTimestampOrder(requestedAt: Date, deletedAt: Date): void {
  if (deletedAt.getTime() < requestedAt.getTime()) {
    throw new AccountLifecyclePostgresError('PRECONDITION_FAILED', 'deleted_at precedes deletion_requested_at')
  }
}

async function assertSelfReactivationPermission(
  client: PoolClient,
  userId: string,
  now: Date,
): Promise<void> {
  const minimumLayer = permissionMinimumLayers.get('user.reactivate')
  if (typeof minimumLayer !== 'string' || !/^L[0-8]$/.test(minimumLayer)) {
    throw new AccountLifecyclePostgresError('FORBIDDEN', 'user.reactivate permission authority is unavailable')
  }
  const requiredLayer = Number(minimumLayer.slice(1))
  const assignments = await client.query<{ roleId: string }>(
    'SELECT role_id AS "roleId" FROM role_assignments ' +
      "WHERE subject_id = $1 AND status = 'ACTIVE' AND scope_type = 'global' AND scope_id IS NULL " +
      'AND valid_from <= $2 AND (valid_until IS NULL OR $2 < valid_until)',
    [userId, now],
  )
  const granted = assignments.rows.some((assignment) => {
    const layer = roleLayers.get(assignment.roleId)
    return (
      typeof layer === 'number' &&
      layer >= requiredLayer &&
      (permissionGrants.get(assignment.roleId)?.has('user.reactivate') ?? false)
    )
  })
  if (!granted) {
    throw new AccountLifecyclePostgresError('FORBIDDEN', 'effective global role does not grant user.reactivate')
  }
}

function buildEvent(
  input: AccountLifecyclePostgresInput,
  policy: TransitionPolicy,
  from: string,
  nextVersion: number,
  now: Date,
): AccountStateChangedEvent {
  const eventId = randomUUID()
  return {
    eventId,
    eventType: 'identity.account_state_changed',
    schemaVersion: '1.0',
    producer: 'W02',
    resourceType: 'User',
    resourceId: input.userId,
    occurredAt: now.toISOString(),
    publishedAt: now.toISOString(),
    correlationId: eventId,
    causationId: eventId,
    idempotencyKey: 'auth013-' + input.userId + '-' + input.expectedVersion,
    attempt: 1,
    sourceVersion: nextVersion,
    actor: policy.actor,
    before: {
      accountState: from,
      accountStateVersion: input.expectedVersion,
    },
    after: {
      accountState: policy.to,
      accountStateVersion: nextVersion,
    },
    reason: policy.reason,
  }
}

async function applyTransition(
  pool: Pool,
  input: AccountLifecyclePostgresInput,
  policy: TransitionPolicy,
  clock: AccountLifecycleServerClock,
): Promise<AccountLifecyclePostgresResult> {
  const client = await pool.connect()
  let transactionStarted = false
  try {
    await client.query('BEGIN')
    transactionStarted = true

    const selected = await client.query<CurrentAccount>(
      'SELECT account_state AS "accountState", account_state_version AS "accountStateVersion", ' +
        'deletion_requested_at AS "deletionRequestedAt", deleted_at AS "deletedAt" ' +
        'FROM "user" WHERE id = $1 FOR UPDATE',
      [input.userId],
    )
    const current = selected.rows[0]
    if (!current) {
      throw new AccountLifecyclePostgresError('NOT_FOUND', 'user account not found')
    }
    if (Number(current.accountStateVersion) !== input.expectedVersion) {
      throw new AccountLifecyclePostgresError('CONFLICT', 'account state version does not match If-Match')
    }
    if (!policy.from.includes(current.accountState)) {
      throw new AccountLifecyclePostgresError(
        'INVALID_STATE',
        'transition ' + current.accountState + ' -> ' + policy.to + ' is not permitted',
      )
    }

    // Resolve time only after acquiring the account row lock so window checks
    // and the timestamp written by this transition use one W02 server instant.
    const now = assertServerNow(clock)
    const timestamps = await policy.resolveTimestamps(client, current, now)
    const nextVersion = input.expectedVersion + 1
    const event = buildEvent(input, policy, current.accountState, nextVersion, now)
    const journalId = randomUUID()

    const updated = await client.query<{ accountStateVersion: number }>(
      'UPDATE "user" SET account_state = $1, account_state_version = account_state_version + 1, ' +
        'updated_at = $2, deletion_requested_at = $3, deleted_at = $4 ' +
        'WHERE id = $5 AND account_state = $6 AND account_state_version = $7 ' +
        'RETURNING account_state_version AS "accountStateVersion"',
      [
        policy.to,
        now,
        timestamps.deletionRequestedAt,
        timestamps.deletedAt,
        input.userId,
        current.accountState,
        input.expectedVersion,
      ],
    )
    if (updated.rowCount !== 1) {
      throw new AccountLifecyclePostgresError('CONFLICT', 'account state compare-and-set did not update exactly one row')
    }

    await client.query(
      'INSERT INTO auth_013_publication_journal ' +
        '(journal_id, event_id, event_type, schema_version, resource_id, source_version, payload, status, attempt, next_attempt_at, created_at, published_at, last_error_code) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
      [
        journalId,
        event.eventId,
        event.eventType,
        event.schemaVersion,
        event.resourceId,
        event.sourceVersion,
        JSON.stringify(event),
        'PENDING',
        1,
        null,
        now,
        null,
        null,
      ],
    )

    if (INVALIDATE_SESSION_STATES.has(policy.to)) {
      await client.query('DELETE FROM "session" WHERE user_id = $1', [input.userId])
    }

    await client.query('COMMIT')
    transactionStarted = false
    return {
      from: current.accountState,
      to: policy.to,
      accountStateVersion: Number(updated.rows[0]?.accountStateVersion ?? nextVersion),
      eventId: event.eventId,
      journalId,
    }
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK')
      } catch {
        throw new AccountLifecyclePostgresError('JOURNAL_PERSISTENCE_FAILED', 'PostgreSQL transaction rollback failed')
      }
    }
    if (error instanceof AccountLifecyclePostgresError) throw error
    const pgCode = (error as { code?: string } | null)?.code
    if (pgCode === '23505' || pgCode === '40001' || pgCode === '40P01') {
      throw new AccountLifecyclePostgresError('CONFLICT', 'account lifecycle transition conflicted with a concurrent or duplicate publication')
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new AccountLifecyclePostgresError(
      'JOURNAL_PERSISTENCE_FAILED',
      'account lifecycle state and AUTH-013 publication journal transaction failed: ' + message,
    )
  } finally {
    client.release()
  }
}

/**
 * Test-only PostgreSQL adapter. It is intentionally provider-specific under
 * src/neon and is not imported by the deployed W02 Worker.
 *
 * Public request/cancel APIs, reauthentication, request idempotency, deletion
 * execution, and cross-domain data cleanup remain outside this persistence
 * slice. The caller must supply the authenticated Better Auth subject for
 * self-service operations; this module never accepts client timestamps or a
 * client-provided precondition boolean.
 */
export async function requestAccountDeletionPostgres(
  pool: Pool,
  input: AccountLifecycleSelfPostgresInput,
  clock: AccountLifecycleServerClock = systemClock,
): Promise<AccountLifecyclePostgresResult> {
  assertSelfInput(input)
  return applyTransition(pool, input, {
    from: ['ACTIVE'],
    to: 'DELETION_REQUESTED',
    actor: { actorId: input.subjectUserId, actorType: 'user' },
    reason: 'account_deletion_requested',
    resolveTimestamps: async (_client, current, now) => {
      if (current.deletionRequestedAt !== null || current.deletedAt !== null) {
        throw new AccountLifecyclePostgresError('PRECONDITION_FAILED', 'ACTIVE account must not retain deletion lifecycle timestamps')
      }
      return { deletionRequestedAt: now, deletedAt: null }
    },
  }, clock)
}

export async function cancelAccountDeletionPostgres(
  pool: Pool,
  input: AccountLifecycleSelfPostgresInput,
  clock: AccountLifecycleServerClock = systemClock,
): Promise<AccountLifecyclePostgresResult> {
  assertSelfInput(input)
  return applyTransition(pool, input, {
    from: ['DELETION_REQUESTED', 'DELETION_PENDING'],
    to: 'ACTIVE',
    actor: { actorId: input.subjectUserId, actorType: 'user' },
    reason: 'account_deletion_cancelled',
    resolveTimestamps: async (_client, current, now) => {
      const requestedAt = requireTrustedTimestamp(current.deletionRequestedAt, 'deletion_requested_at', now)
      requireNoDeletedTimestamp(current)
      if (now.getTime() >= requestedAt.getTime() + COOLING_OFF_MS) {
        throw new AccountLifecyclePostgresError('PRECONDITION_FAILED', '15-day deletion cooling-off window has elapsed')
      }
      return { deletionRequestedAt: null, deletedAt: null }
    },
  }, clock)
}

export async function advanceAccountDeletionToPendingPostgres(
  pool: Pool,
  input: AccountLifecycleJobPostgresInput,
  clock: AccountLifecycleServerClock = systemClock,
): Promise<AccountLifecyclePostgresResult> {
  assertJobInput(input)
  return applyTransition(pool, input, {
    from: ['DELETION_REQUESTED'],
    to: 'DELETION_PENDING',
    actor: { actorId: input.actorId, actorType: 'job' },
    reason: 'account_deletion_cooling_off_elapsed',
    resolveTimestamps: async (_client, current, now) => {
      const requestedAt = requireTrustedTimestamp(current.deletionRequestedAt, 'deletion_requested_at', now)
      requireNoDeletedTimestamp(current)
      if (now.getTime() < requestedAt.getTime() + COOLING_OFF_MS) {
        throw new AccountLifecyclePostgresError('PRECONDITION_FAILED', '15-day deletion cooling-off window has not elapsed')
      }
      return { deletionRequestedAt: requestedAt, deletedAt: null }
    },
  }, clock)
}

export async function completeAccountDeletionPostgres(
  pool: Pool,
  input: AccountLifecycleJobPostgresInput,
  clock: AccountLifecycleServerClock = systemClock,
): Promise<AccountLifecyclePostgresResult> {
  assertJobInput(input)
  return applyTransition(pool, input, {
    from: ['DELETION_PENDING'],
    to: 'DELETED',
    actor: { actorId: input.actorId, actorType: 'job' },
    reason: 'account_deleted',
    resolveTimestamps: async (_client, current, now) => {
      const requestedAt = requireTrustedTimestamp(current.deletionRequestedAt, 'deletion_requested_at', now)
      requireNoDeletedTimestamp(current)
      if (now.getTime() < requestedAt.getTime() + COOLING_OFF_MS) {
        throw new AccountLifecyclePostgresError('PRECONDITION_FAILED', '15-day deletion cooling-off window has not elapsed')
      }
      return { deletionRequestedAt: requestedAt, deletedAt: now }
    },
  }, clock)
}

export async function reactivateDeletedAccountPostgres(
  pool: Pool,
  input: AccountLifecycleSelfPostgresInput,
  clock: AccountLifecycleServerClock = systemClock,
): Promise<AccountLifecyclePostgresResult> {
  assertSelfInput(input)
  return applyTransition(pool, input, {
    from: ['DELETED'],
    to: 'REACTIVATED',
    actor: { actorId: input.subjectUserId, actorType: 'user' },
    reason: 'account_reactivated',
    resolveTimestamps: async (client, current, now) => {
      const requestedAt = requireTrustedTimestamp(current.deletionRequestedAt, 'deletion_requested_at', now)
      const deletedAt = requireTrustedTimestamp(current.deletedAt, 'deleted_at', now)
      assertTimestampOrder(requestedAt, deletedAt)
      if (now.getTime() >= deletedAt.getTime() + REACTIVATION_MS) {
        throw new AccountLifecyclePostgresError('PRECONDITION_FAILED', '30-day post-deletion reactivation window has elapsed')
      }
      await assertSelfReactivationPermission(client, input.userId, now)
      return { deletionRequestedAt: requestedAt, deletedAt }
    },
  }, clock)
}

export async function completeAccountReactivationPostgres(
  pool: Pool,
  input: AccountLifecycleJobPostgresInput,
  clock: AccountLifecycleServerClock = systemClock,
): Promise<AccountLifecyclePostgresResult> {
  assertJobInput(input)
  return applyTransition(pool, input, {
    from: ['REACTIVATED'],
    to: 'ACTIVE',
    actor: { actorId: input.actorId, actorType: 'job' },
    reason: 'account_reactivation_completed',
    resolveTimestamps: async (_client, current, now) => {
      const requestedAt = requireTrustedTimestamp(current.deletionRequestedAt, 'deletion_requested_at', now)
      const deletedAt = requireTrustedTimestamp(current.deletedAt, 'deleted_at', now)
      assertTimestampOrder(requestedAt, deletedAt)
      return { deletionRequestedAt: null, deletedAt: null }
    },
  }, clock)
}
