import type { Pool, PoolClient } from 'pg'
import type {
  UsernameChangeContext,
  UsernameChangeState,
  UsernameChangeStore,
  UsernameChangeCommand,
  UsernameChangeWriteResult,
} from '../auth/username-change-store.js'

type PgConnection = Pool | PoolClient

type ContextRow = {
  username: string | null
  accountState: string
  usernameVersion: number | string
  lastChangedAt: Date | string | null
  replayKeyHash: string | null
  replayUsername: string | null
  replayFingerprint: string | null
  replayChangedAt: Date | string | null
  replayExpiresAt: Date | string | null
}

type StateRow = Pick<ContextRow, 'username' | 'accountState' | 'usernameVersion' | 'lastChangedAt'>

function isoOrNull(value: Date | string | null): string | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('USERNAME_CHANGE_TIMESTAMP_INVALID')
  return date.toISOString()
}

function mapContext(row: ContextRow | undefined): UsernameChangeContext | null {
  if (!row) return null
  const usernameVersion = Number(row.usernameVersion)
  if (!Number.isSafeInteger(usernameVersion) || usernameVersion < 0 || typeof row.accountState !== 'string') {
    throw new Error('USERNAME_CONTEXT_INVALID')
  }
  return {
    username: row.username,
    accountState: row.accountState,
    usernameVersion,
    lastChangedAt: isoOrNull(row.lastChangedAt),
    replayKeyHash: row.replayKeyHash,
    replayUsername: row.replayUsername,
    replayFingerprint: row.replayFingerprint,
    replayChangedAt: isoOrNull(row.replayChangedAt),
    replayExpiresAt: isoOrNull(row.replayExpiresAt),
  }
}

/**
 * PostgreSQL implementation of the W02 username state port.
 *
 * A row lock plus optimistic version/current-handle predicates protect the
 * same logical transition as the production D1 batch. The user update and
 * compact reservation/idempotency state commit in one PostgreSQL transaction.
 */
export function createPostgresUsernameChangeStore(pool: Pool): UsernameChangeStore {
  return {
    async loadContext(userId, idempotencyKeyHash, nowIso) {
      const result = await pool.query<ContextRow>(
        'SELECT u.username AS username, u.account_state AS "accountState", ' +
          'COALESCE(s.username_version, 0) AS "usernameVersion", s.last_changed_at AS "lastChangedAt", ' +
          'CASE WHEN s.idempotency_key_hash = $2 AND s.idempotency_expires_at > $3 THEN s.idempotency_key_hash END AS "replayKeyHash", ' +
          'CASE WHEN s.idempotency_key_hash = $2 AND s.idempotency_expires_at > $3 THEN s.changed_username END AS "replayUsername", ' +
          'CASE WHEN s.idempotency_key_hash = $2 AND s.idempotency_expires_at > $3 THEN s.request_fingerprint END AS "replayFingerprint", ' +
          'CASE WHEN s.idempotency_key_hash = $2 AND s.idempotency_expires_at > $3 THEN s.last_changed_at END AS "replayChangedAt", ' +
          'CASE WHEN s.idempotency_key_hash = $2 AND s.idempotency_expires_at > $3 THEN s.idempotency_expires_at END AS "replayExpiresAt" ' +
          'FROM "user" u LEFT JOIN auth_username_change_state s ON s.user_id = u.id ' +
          'WHERE u.id = $1 LIMIT 1',
        [userId, idempotencyKeyHash, new Date(nowIso)],
      )
      return mapContext(result.rows[0])
    },

    async loadState(userId) {
      const result = await pool.query<StateRow>(
        'SELECT u.username AS username, u.account_state AS "accountState", ' +
          'COALESCE(s.username_version, 0) AS "usernameVersion", s.last_changed_at AS "lastChangedAt" ' +
          'FROM "user" u LEFT JOIN auth_username_change_state s ON s.user_id = u.id ' +
          'WHERE u.id = $1 LIMIT 1',
        [userId],
      )
      const row = result.rows[0]
      if (!row) return null
      const usernameVersion = Number(row.usernameVersion)
      if (!Number.isSafeInteger(usernameVersion) || usernameVersion < 0) {
        throw new Error('USERNAME_VERSION_INVALID')
      }
      return {
        username: row.username,
        accountState: row.accountState,
        usernameVersion,
        lastChangedAt: isoOrNull(row.lastChangedAt),
      } satisfies UsernameChangeState
    },

    async applyChange(command: UsernameChangeCommand): Promise<UsernameChangeWriteResult> {
      let client: PoolClient | undefined
      let transactionOpen = false
      try {
        client = await pool.connect()
        await client.query('BEGIN')
        transactionOpen = true

        const locked = await client.query<{ id: string }>(
          'SELECT id FROM "user" WHERE id = $1 FOR UPDATE',
          [command.userId],
        )
        if (locked.rowCount !== 1) {
          await client.query('COMMIT')
          transactionOpen = false
          return { updated: 0, saved: 0 }
        }

        const updatedUser = await client.query(
          'UPDATE "user" SET username = $1, updated_at = $2 ' +
            'WHERE id = $3 AND username = $4 AND account_state = \'ACTIVE\' ' +
            'AND COALESCE((SELECT username_version FROM auth_username_change_state WHERE user_id = $3), 0) = $5 ' +
            'AND NOT EXISTS (SELECT 1 FROM auth_username_change_state WHERE previous_username_normalized = $6 AND previous_username_expires_at > $2) ' +
            'AND NOT EXISTS (SELECT 1 FROM auth_identities WHERE username_normalized = $7 AND user_id <> $3) ' +
            'AND NOT EXISTS (SELECT 1 FROM "user" WHERE lower(username) = $7 AND id <> $3) ' +
            'AND NOT EXISTS (SELECT 1 FROM auth_credentials c JOIN auth_identities i ON i.id = c.identity_id ' +
            'WHERE c.kind = \'username\' AND c.active = TRUE AND c.normalized_value = $7 AND i.user_id <> $3)',
          [
            command.nextUsername,
            new Date(command.nowIso),
            command.userId,
            command.currentUsername,
            command.expectedVersion,
            command.nextUsernameNormalized,
            command.nextUsernameNormalized,
          ],
        )
        const updated = updatedUser.rowCount ?? 0
        if (updated !== 1) {
          await client.query('COMMIT')
          transactionOpen = false
          return { updated: 0, saved: 0 }
        }

        const savedState = await client.query<{ userId: string }>(
          'INSERT INTO auth_username_change_state (' +
            'user_id, username_version, last_changed_at, previous_username, previous_username_normalized, ' +
            'previous_username_expires_at, idempotency_key_hash, request_fingerprint, idempotency_expires_at, changed_username' +
          ') SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10 ' +
          'WHERE EXISTS (SELECT 1 FROM "user" WHERE id = $1 AND username = $10 AND updated_at = $3 AND account_state = \'ACTIVE\') ' +
          'ON CONFLICT (user_id) DO UPDATE SET ' +
            'username_version = EXCLUDED.username_version, ' +
            'last_changed_at = EXCLUDED.last_changed_at, ' +
            'previous_username = EXCLUDED.previous_username, ' +
            'previous_username_normalized = EXCLUDED.previous_username_normalized, ' +
            'previous_username_expires_at = EXCLUDED.previous_username_expires_at, ' +
            'idempotency_key_hash = EXCLUDED.idempotency_key_hash, ' +
            'request_fingerprint = EXCLUDED.request_fingerprint, ' +
            'idempotency_expires_at = EXCLUDED.idempotency_expires_at, ' +
            'changed_username = EXCLUDED.changed_username ' +
          'WHERE auth_username_change_state.username_version = $11 ' +
          'RETURNING user_id AS "userId"',
          [
            command.userId,
            command.expectedVersion + 1,
            new Date(command.nowIso),
            command.currentUsername,
            command.currentUsernameNormalized,
            new Date(command.reservationExpiresAt),
            command.idempotencyKeyHash,
            command.requestFingerprint,
            new Date(command.idempotencyExpiresAt),
            command.nextUsername,
            command.expectedVersion,
          ],
        )
        const saved = savedState.rowCount ?? 0
        if (saved !== 1) {
          // Match D1 batch atomicity: never leave the username updated without
          // its version, previous-handle lease and idempotency receipt.
          await client.query('ROLLBACK')
          transactionOpen = false
          return { updated: 0, saved: 0 }
        }

        await client.query('COMMIT')
        transactionOpen = false
        return { updated: 1, saved: 1 }
      } catch (error) {
        if (transactionOpen && client) {
          try {
            await client.query('ROLLBACK')
          } catch {
            // Preserve the primary error; the connection is released as broken below.
          }
        }
        const code = error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code ?? '')
          : ''
        if (code === '23505' || (code === '23514' && error instanceof Error && error.message.includes('USERNAME_RESERVED'))) {
          throw Object.assign(new Error('USERNAME_UNAVAILABLE'), { cause: error, code })
        }
        throw error
      } finally {
        client?.release()
      }
    },
  }
}
