import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { text } from '@payloadcms/db-postgres/drizzle/pg-core'
import { buildConfig } from 'payload'

import productionConfig from './payload.config.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const databaseUrl = process.env.PAYLOAD_RUNTIME_DATABASE_URL

if (!databaseUrl) {
  throw new Error('PAYLOAD_RUNTIME_DATABASE_URL is required for the local W01 PostgreSQL runtime rehearsal')
}
if (
  process.env.NODE_ENV === 'production' ||
  process.env.PAYLOAD_MIGRATION_REMOTE === 'true' ||
  process.env.NEON_SCHEMA_APPLY === 'true' ||
  (typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers')
) {
  throw new Error('W01 PostgreSQL runtime rehearsal config is local-only and cannot run in production or a Worker')
}

let parsedDatabaseUrl: URL
try {
  parsedDatabaseUrl = new URL(databaseUrl)
} catch {
  throw new Error('PAYLOAD_RUNTIME_DATABASE_URL must be a valid PostgreSQL URL')
}

const localHosts = new Set(['127.0.0.1', 'localhost', 'postgres'])
if (
  !['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol) ||
  !localHosts.has(parsedDatabaseUrl.hostname) ||
  parsedDatabaseUrl.port !== '5432' ||
  parsedDatabaseUrl.pathname !== '/luckread_schema'
) {
  throw new Error('Refusing W01 runtime rehearsal against any database except local PostgreSQL 18 luckread_schema')
}

// Reuse the exact production W01 Collections, redirects and R2 plugin setup.
// Only the database adapter changes; the production payload.config.ts remains
// the D1 default and is not modified by this rehearsal.
const sharedConfig = await Promise.resolve(productionConfig)

export default buildConfig({
  ...sharedConfig,
  db: postgresAdapter({
    pool: {
      connectionString: databaseUrl,
      max: 2,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 1_000,
      allowExitOnIdle: true,
    },
    idType: 'serial',
    push: false,
    disableCreateDatabase: true,
    migrationDir: path.resolve(dirname, 'neon-postgres-migrations'),
    afterSchemaInit: [
      ({ schema, extendTable }) => {
        const users = schema.tables.users
        if (!users) throw new Error('W01 PostgreSQL runtime schema is missing the users table')
        extendTable({
          table: users,
          columns: {
            reset_password_requested_at: text('reset_password_requested_at'),
          },
        })

        const media = schema.tables.media
        if (!media) throw new Error('W01 PostgreSQL runtime schema is missing the media table')
        if (!('prefix' in media)) {
          extendTable({
            table: media,
            columns: { prefix: text('prefix').default('media') },
          })
        }
        if (!('_objectKey' in media)) {
          extendTable({
            table: media,
            columns: { _objectKey: text('_objectkey') },
          })
        }

        return schema
      },
    ],
  }),
})
