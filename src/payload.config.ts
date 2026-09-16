import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { sqliteD1Adapter } from '@payloadcms/db-d1-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'

import { Users } from './collections/Users'
import { authSessionState } from './db/auth-session-state'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

declare const cloudflare: {
  env: {
    D1: D1Database
  }
}

export default buildConfig({
  admin: {
    user: Users.slug,
  },
  collections: [Users],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || 'development-only-secret',
  db: sqliteD1Adapter({
    binding: cloudflare.env.D1,
    beforeSchemaInit: [
      ({ adapter, schema }) => {
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
      },
    ],
    push: false,
    migrationDir: path.resolve(dirname, './migrations'),
  }),
  typescript: {
    outputFile: path.resolve(dirname, './payload-types.ts'),
  },
  graphQL: {
    disable: true,
  },
})
