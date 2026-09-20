import type { SQLiteSchemaHook } from '@payloadcms/db-d1-sqlite'
import { index, integer, sqliteTable, text } from '@payloadcms/db-d1-sqlite/drizzle/sqlite-core'

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
  (table) => ({
    userIdIdx: index('auth_session_state_user_id_idx').on(table.userId),
    deviceIdIdx: index('auth_session_state_device_id_idx').on(table.deviceId),
    tokenVersionIdx: index('auth_session_state_token_version_idx').on(table.tokenVersion),
    revokedAtIdx: index('auth_session_state_revoked_at_idx').on(table.revokedAt),
  }),
)

export const authSessionStateSchemaHook: SQLiteSchemaHook = ({ schema }) => ({
  ...schema,
  tables: {
    ...schema.tables,
    authSessionState,
  },
})
