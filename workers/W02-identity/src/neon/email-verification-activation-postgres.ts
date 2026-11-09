import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'

import {
  AccountStateTransitionError,
  type AccountState,
} from '../account/account-state-transition.js'
import { ensureVerifiedUserRolePostgres } from './role-assignment-postgres.js'

type CurrentAccount = {
  accountState: string
  accountStateVersion: number
  emailVerified: boolean
}

export type EmailVerifiedActivationPostgresResult = {
  activated: boolean
  accountState: AccountState
  accountStateVersion: number
  eventId: string | null
  journalId: string | null
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
    actorType: 'user'
  }
  before: {
    accountState: AccountState
    accountStateVersion: number
  }
  after: {
    accountState: AccountState
    accountStateVersion: number
  }
  reason: 'email_verified'
}

const SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

/**
 * PostgreSQL counterpart of W02's AUTH-013 email-verification activation.
 *
 * The account transition, verified_user L2 assignment (including its existing
 * authorization-version trigger), and AUTH-013 publication journal are one
 * PostgreSQL transaction. The Better Auth/D1 production path is unchanged.
 */
export async function activateEmailVerifiedAccountPostgres(
  pool: Pool,
  userId: string,
  now = new Date().toISOString(),
): Promise<EmailVerifiedActivationPostgresResult> {
  if (typeof userId !== 'string' || !SUBJECT_PATTERN.test(userId)) {
    throw new AccountStateTransitionError('INVALID_INPUT', 'userId is invalid')
  }

  const timestamp = new Date(now)
  if (!Number.isFinite(timestamp.getTime())) {
    throw new AccountStateTransitionError('INVALID_INPUT', 'activation timestamp is invalid')
  }
  const occurredAt = timestamp.toISOString()

  const client = await pool.connect()
  let transactionOpen = false

  try {
    await client.query('BEGIN')
    transactionOpen = true

    const selected = await client.query<CurrentAccount>(
      'SELECT account_state AS "accountState", ' +
        'account_state_version AS "accountStateVersion", ' +
        'email_verified AS "emailVerified" ' +
        'FROM "user" WHERE id = $1 FOR UPDATE',
      [userId],
    )
    const current = selected.rows[0]

    if (!current) {
      throw new AccountStateTransitionError('NOT_FOUND', 'user account not found')
    }
    if (current.emailVerified !== true) {
      throw new AccountStateTransitionError(
        'PRECONDITION_FAILED',
        'email verification must be persisted before account activation',
      )
    }
    if (!Number.isSafeInteger(Number(current.accountStateVersion)) ||
        Number(current.accountStateVersion) < 1) {
      throw new AccountStateTransitionError('PRECONDITION_FAILED', 'account state version is invalid')
    }

    const accountState = current.accountState as AccountState
    const accountStateVersion = Number(current.accountStateVersion)

    if (accountState !== 'PENDING_VERIFICATION') {
      if (accountState === 'ACTIVE') {
        // Match the D1 callback's repair behavior: an already-active verified
        // account must still have its canonical L2 assignment.
        await ensureVerifiedUserRolePostgres(client, userId, occurredAt)
      }
      await client.query('COMMIT')
      transactionOpen = false
      return {
        activated: false,
        accountState,
        accountStateVersion,
        eventId: null,
        journalId: null,
      }
    }

    const nextVersion = accountStateVersion + 1
    const update = await client.query(
      'UPDATE "user" SET account_state = $1, account_state_version = $2, updated_at = $3 ' +
        'WHERE id = $4 AND account_state = $5 AND account_state_version = $6',
      ['ACTIVE', nextVersion, occurredAt, userId, 'PENDING_VERIFICATION', accountStateVersion],
    )
    if (update.rowCount !== 1) {
      throw new AccountStateTransitionError('CONFLICT', 'account state changed concurrently')
    }

    // This checks the newly activated, email-verified user and uses the
    // existing L2 RoleAssignment schema/trigger. It runs on this transaction.
    await ensureVerifiedUserRolePostgres(client, userId, occurredAt)

    const eventId = randomUUID()
    const journalId = randomUUID()
    const event: AccountStateChangedEvent = {
      eventId,
      eventType: 'identity.account_state_changed',
      schemaVersion: '1.0',
      producer: 'W02',
      resourceType: 'User',
      resourceId: userId,
      occurredAt,
      publishedAt: occurredAt,
      correlationId: eventId,
      causationId: eventId,
      idempotencyKey: 'auth013-' + userId + '-' + accountStateVersion,
      attempt: 1,
      sourceVersion: nextVersion,
      actor: {
        actorId: userId,
        actorType: 'user',
      },
      before: {
        accountState: 'PENDING_VERIFICATION',
        accountStateVersion,
      },
      after: {
        accountState: 'ACTIVE',
        accountStateVersion: nextVersion,
      },
      reason: 'email_verified',
    }

    await client.query(
      'INSERT INTO auth_013_publication_journal (' +
        'journal_id, event_id, event_type, schema_version, resource_id, source_version, ' +
        'payload, status, attempt, next_attempt_at, created_at, published_at, last_error_code' +
      ') VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
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
        occurredAt,
        null,
        null,
      ],
    )

    await client.query('COMMIT')
    transactionOpen = false

    return {
      activated: true,
      accountState: 'ACTIVE',
      accountStateVersion: nextVersion,
      eventId,
      journalId,
    }
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Preserve the original activation failure.
      }
    }

    if (error instanceof AccountStateTransitionError) throw error

    const databaseCode =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : ''
    if (databaseCode === '23505') {
      throw new AccountStateTransitionError('CONFLICT', 'account activation or publication already exists')
    }
    if (databaseCode) {
      throw new AccountStateTransitionError(
        'JOURNAL_PERSISTENCE_FAILED',
        'account activation and publication journal transaction failed',
      )
    }
    throw error
  } finally {
    client.release()
  }
}
