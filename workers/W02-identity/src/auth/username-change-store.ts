export type UsernameChangeContext = {
  username: string | null
  accountState: string
  usernameVersion: number
  lastChangedAt: string | null
  replayKeyHash: string | null
  replayUsername: string | null
  replayFingerprint: string | null
  replayChangedAt: string | null
  replayExpiresAt: string | null
}

export type UsernameChangeState = Pick<
  UsernameChangeContext,
  'username' | 'accountState' | 'usernameVersion' | 'lastChangedAt'
>

export type UsernameChangeCommand = {
  userId: string
  currentUsername: string
  nextUsername: string
  currentUsernameNormalized: string
  nextUsernameNormalized: string
  expectedVersion: number
  nowIso: string
  reservationExpiresAt: string
  idempotencyKeyHash: string
  requestFingerprint: string
  idempotencyExpiresAt: string
}

export type UsernameChangeWriteResult = {
  updated: number
  saved: number
}

/**
 * Persistence seam for W02 username changes.
 *
 * The adapter must atomically update Better Auth's current username and the
 * compact W02 lease/idempotency row. Public policy, caller authentication,
 * rate limiting and response semantics remain in username-change.ts.
 */
export type UsernameChangeStore = {
  loadContext(
    userId: string,
    idempotencyKeyHash: string,
    nowIso: string,
  ): Promise<UsernameChangeContext | null>
  loadState(userId: string): Promise<UsernameChangeState | null>
  applyChange(command: UsernameChangeCommand): Promise<UsernameChangeWriteResult>
}

const CONTEXT_SQL = [
  'SELECT u.username AS username, u.account_state AS accountState,',
  '       COALESCE(s.username_version, 0) AS usernameVersion,',
  '       s.last_changed_at AS lastChangedAt,',
  '       CASE WHEN s.idempotency_key_hash = ? AND s.idempotency_expires_at > ? THEN s.idempotency_key_hash END AS replayKeyHash,',
  '       CASE WHEN s.idempotency_key_hash = ? AND s.idempotency_expires_at > ? THEN s.changed_username END AS replayUsername,',
  '       CASE WHEN s.idempotency_key_hash = ? AND s.idempotency_expires_at > ? THEN s.request_fingerprint END AS replayFingerprint,',
  '       CASE WHEN s.idempotency_key_hash = ? AND s.idempotency_expires_at > ? THEN s.last_changed_at END AS replayChangedAt,',
  '       CASE WHEN s.idempotency_key_hash = ? AND s.idempotency_expires_at > ? THEN s.idempotency_expires_at END AS replayExpiresAt',
  'FROM "user" u',
  'LEFT JOIN auth_username_change_state s ON s.user_id = u.id',
  'WHERE u.id = ? LIMIT 1',
].join('\n')

const STATE_SQL = [
  'SELECT u.username AS username, u.account_state AS accountState,',
  '       COALESCE(s.username_version, 0) AS usernameVersion,',
  '       s.last_changed_at AS lastChangedAt',
  'FROM "user" u',
  'LEFT JOIN auth_username_change_state s ON s.user_id = u.id',
  'WHERE u.id = ? LIMIT 1',
].join('\n')

/**
 * Production remains on this D1 adapter until an independently approved
 * runtime-adapter/cutover change control changes the W02 Worker entry point.
 */
export function createD1UsernameChangeStore(db: D1Database): UsernameChangeStore {
  return {
    async loadContext(userId, idempotencyKeyHash, nowIso) {
      const row = await db.prepare(CONTEXT_SQL).bind(
        idempotencyKeyHash, nowIso,
        idempotencyKeyHash, nowIso,
        idempotencyKeyHash, nowIso,
        idempotencyKeyHash, nowIso,
        idempotencyKeyHash, nowIso,
        userId,
      ).first<UsernameChangeContext>()
      return row ? {
        ...row,
        usernameVersion: Number(row.usernameVersion),
      } : null
    },

    async loadState(userId) {
      const row = await db.prepare(STATE_SQL).bind(userId).first<UsernameChangeState>()
      return row ? {
        ...row,
        usernameVersion: Number(row.usernameVersion),
      } : null
    },

    async applyChange(command) {
      const updateUser = db.prepare(
        'UPDATE "user" SET username = ?, updated_at = ? ' +
        'WHERE id = ? AND username = ? AND account_state = \'ACTIVE\' ' +
        'AND COALESCE((SELECT username_version FROM auth_username_change_state WHERE user_id = ?), 0) = ? ' +
        'AND NOT EXISTS (SELECT 1 FROM auth_username_change_state WHERE previous_username_normalized = ? AND previous_username_expires_at > ?) ' +
        'AND NOT EXISTS (SELECT 1 FROM auth_identities WHERE username_normalized = ? AND user_id <> ?) ' +
        'AND NOT EXISTS (SELECT 1 FROM "user" WHERE lower(username) = ? AND id <> ?) ' +
        'AND NOT EXISTS (SELECT 1 FROM auth_credentials c JOIN auth_identities i ON i.id = c.identity_id ' +
        'WHERE c.kind = \'username\' AND c.active = 1 AND c.normalized_value = ? AND i.user_id <> ?)',
      ).bind(
        command.nextUsername, command.nowIso, command.userId, command.currentUsername,
        command.userId, command.expectedVersion,
        command.nextUsernameNormalized, command.nowIso,
        command.nextUsernameNormalized, command.userId, command.nextUsernameNormalized,
        command.userId, command.nextUsernameNormalized, command.userId,
      )

      const saveState = db.prepare(
        'INSERT INTO auth_username_change_state (' +
          'user_id, username_version, last_changed_at, previous_username, previous_username_normalized, ' +
          'previous_username_expires_at, idempotency_key_hash, request_fingerprint, idempotency_expires_at, changed_username' +
        ') SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? ' +
        'WHERE EXISTS (SELECT 1 FROM "user" WHERE id = ? AND username = ? AND updated_at = ? AND account_state = \'ACTIVE\') ' +
        'ON CONFLICT(user_id) DO UPDATE SET ' +
          'username_version = excluded.username_version, ' +
          'last_changed_at = excluded.last_changed_at, ' +
          'previous_username = excluded.previous_username, ' +
          'previous_username_normalized = excluded.previous_username_normalized, ' +
          'previous_username_expires_at = excluded.previous_username_expires_at, ' +
          'idempotency_key_hash = excluded.idempotency_key_hash, ' +
          'request_fingerprint = excluded.request_fingerprint, ' +
          'idempotency_expires_at = excluded.idempotency_expires_at, ' +
          'changed_username = excluded.changed_username ' +
        'WHERE auth_username_change_state.username_version = ?',
      ).bind(
        command.userId, command.expectedVersion + 1, command.nowIso,
        command.currentUsername, command.currentUsernameNormalized, command.reservationExpiresAt,
        command.idempotencyKeyHash, command.requestFingerprint, command.idempotencyExpiresAt, command.nextUsername,
        command.userId, command.nextUsername, command.nowIso, command.expectedVersion,
      )

      const results = await db.batch([updateUser, saveState])
      if (!Array.isArray(results) || results.length !== 2 || results.some(result => result.success !== true)) {
        throw new Error('USERNAME_CHANGE_BATCH_FAILED')
      }
      return {
        updated: Number(results[0]?.meta?.changes ?? 0),
        saved: Number(results[1]?.meta?.changes ?? 0),
      }
    },
  }
}
