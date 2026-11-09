import type { Pool, PoolClient } from 'pg'

import {
  RegistrationRollbackStoreError,
  type RegistrationRollbackCommand,
  type RegistrationRollbackResult,
  type RegistrationRollbackStore,
} from '../auth/registration-rollback-store.js'

type RegistrationRow = {
  id: string
  email: string
  username: string | null
  accountState: string
}

function normalizeCommand(command: RegistrationRollbackCommand): RegistrationRollbackCommand {
  if (
    !command ||
    typeof command.userId !== 'string' ||
    command.userId.length < 1 ||
    command.userId.length > 128 ||
    typeof command.email !== 'string' ||
    command.email.trim().length === 0 ||
    typeof command.username !== 'string' ||
    command.username.trim().length === 0
  ) {
    throw new RegistrationRollbackStoreError('INVALID_INPUT', 'invalid registration rollback command')
  }
  return {
    userId: command.userId,
    email: command.email.trim().toLowerCase(),
    username: command.username.trim(),
  }
}

async function rollbackRegistration(
  client: PoolClient,
  command: RegistrationRollbackCommand,
): Promise<RegistrationRollbackResult> {
  const selected = await client.query<RegistrationRow>(
    'SELECT id, email, username, account_state AS "accountState" ' +
      'FROM "user" WHERE id = $1 LIMIT 1 FOR UPDATE',
    [command.userId],
  )
  const row = selected.rows[0]
  if (!row) return { rolledBack: true }

  if (
    row.email !== command.email ||
    String(row.username ?? '') !== command.username ||
    row.accountState !== 'PENDING_VERIFICATION'
  ) {
    throw new RegistrationRollbackStoreError(
      'PRECONDITION_FAILED',
      'registration rollback precondition failed',
    )
  }

  // Lock the user row above before checking sessions. The Better Auth
  // session.user_id foreign key takes a conflicting key-share lock, preventing
  // a new session from being inserted between this check and account deletion.
  const activeSession = await client.query<{ id: string }>(
    'SELECT id FROM "session" WHERE user_id = $1 LIMIT 1',
    [command.userId],
  )
  if ((activeSession.rowCount ?? activeSession.rows.length) > 0) {
    throw new RegistrationRollbackStoreError(
      'PRECONDITION_FAILED',
      'registration rollback cannot remove an active session',
    )
  }

  await client.query('DELETE FROM role_assignments WHERE subject_id = $1', [command.userId])
  await client.query('DELETE FROM "verification" WHERE identifier = $1', [command.email])
  await client.query('DELETE FROM "account" WHERE user_id = $1', [command.userId])

  const deleted = await client.query(
    'DELETE FROM "user" WHERE id = $1 AND account_state = $2',
    [command.userId, 'PENDING_VERIFICATION'],
  )
  if (deleted.rowCount !== 1) {
    throw new RegistrationRollbackStoreError(
      'PRECONDITION_FAILED',
      'registration rollback target changed before deletion',
    )
  }

  return { rolledBack: true }
}

/** PostgreSQL counterpart for disposable PG18 rehearsal; not a production binding. */
export function createPostgresRegistrationRollbackStore(pool: Pool): RegistrationRollbackStore {
  return {
    async rollback(rawCommand) {
      const command = normalizeCommand(rawCommand)
      const client = await pool.connect()
      let transactionOpen = false

      try {
        await client.query('BEGIN')
        transactionOpen = true

        const result = await rollbackRegistration(client, command)

        await client.query('COMMIT')
        transactionOpen = false
        return result
      } catch (error) {
        if (transactionOpen) {
          try {
            await client.query('ROLLBACK')
          } catch {
            throw new Error('REGISTRATION_ROLLBACK_TRANSACTION_ROLLBACK_FAILED')
          }
        }
        if (error instanceof RegistrationRollbackStoreError) throw error
        throw new Error('REGISTRATION_ROLLBACK_FAILED')
      } finally {
        client.release()
      }
    },
  }
}
