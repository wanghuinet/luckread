import { index, integer, sqliteTable, text } from '@payloadcms/db-sqlite/drizzle/sqlite-core'

/**
 * Minimal extension state for AUTH-002.
 *
 * Payload's native users.sessions[] remains the canonical Session identity,
 * creation timestamp, and expiry. This table stores only dimensions that are
 * not represented by the native Payload UserSession shape.
 */
export const authSessionState = sqliteTable(
  'auth_session_state',
  {
    sessionId: text('session_id').primaryKey().notNull(),
    userId: text('user_id').notNull(),
    deviceId: text('device_id').notNull(),
    tokenVersion: integer('token_version').notNull(),
    refreshCredentialHash: text('refresh_credential_hash').notNull(),
    revokedAt: text('revoked_at'),
    lastSeenAt: text('last_seen_at'),
  },
  (table) => [
    index('auth_session_state_user_id_idx').on(table.userId),
    index('auth_session_state_device_id_idx').on(table.deviceId),
    index('auth_session_state_token_version_idx').on(table.tokenVersion),
    index('auth_session_state_revoked_at_idx').on(table.revokedAt),
  ],
)
