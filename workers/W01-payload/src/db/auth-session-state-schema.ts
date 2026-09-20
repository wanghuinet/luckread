import type { SQLiteSchemaHook } from '@payloadcms/db-d1-sqlite'
import { index, integer, sqliteTable, text } from '@payloadcms/db-d1-sqlite/drizzle/sqlite-core'

type RawSchemaAdapter = {
  rawTables: Record<
    string,
    {
      name: string
      columns: Record<
        string,
        {
          name: string
          type: 'integer' | 'text'
          primaryKey?: boolean
          notNull?: boolean
        }
      >
      indexes?: Record<
        string,
        {
          name: string
          on: string | string[]
          unique?: boolean
        }
      >
    }
  >
}

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

export const authSessionStateSchemaHook: SQLiteSchemaHook = (args) => {
  // D1 3.87.1 executes SQLite schema hooks with the runtime adapter object,
  // while its public hook type intentionally exposes only extendTable/schema.
  // Narrow that runtime shape locally; do not modify Payload Core types.
  const { adapter, schema } = args as typeof args & { adapter: RawSchemaAdapter }

  // Payload's migration generator serializes adapter.rawTables. Keep the same
  // contracted table in raw schema and Drizzle schema so generation and runtime
  // observe one source without creating a Payload Collection.
  adapter.rawTables.authSessionState = {
    name: 'auth_session_state',
    columns: {
      sessionId: {
        name: 'session_id',
        type: 'text',
        primaryKey: true,
        notNull: true,
      },
      userId: {
        name: 'user_id',
        type: 'text',
        notNull: true,
      },
      deviceId: {
        name: 'device_id',
        type: 'text',
        notNull: true,
      },
      tokenVersion: {
        name: 'token_version',
        type: 'integer',
        notNull: true,
      },
      refreshCredentialHash: {
        name: 'refresh_credential_hash',
        type: 'text',
        notNull: true,
      },
      revokedAt: {
        name: 'revoked_at',
        type: 'text',
      },
      lastSeenAt: {
        name: 'last_seen_at',
        type: 'text',
      },
    },
    indexes: {
      userIdIdx: {
        name: 'auth_session_state_user_id_idx',
        unique: false,
        on: ['user_id'],
      },
      deviceIdIdx: {
        name: 'auth_session_state_device_id_idx',
        unique: false,
        on: ['device_id'],
      },
      tokenVersionIdx: {
        name: 'auth_session_state_token_version_idx',
        unique: false,
        on: ['token_version'],
      },
      revokedAtIdx: {
        name: 'auth_session_state_revoked_at_idx',
        unique: false,
        on: ['revoked_at'],
      },
    },
  }

  return {
    ...schema,
    tables: {
      ...schema.tables,
      authSessionState,
    },
  }
}
