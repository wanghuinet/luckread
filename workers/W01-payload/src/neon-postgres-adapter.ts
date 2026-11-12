import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { text } from '@payloadcms/db-postgres/drizzle/pg-core'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Shared W01 PostgreSQL adapter for both schema generation and the optional
 * Hyperdrive runtime. D1 remains selected by default in payload.config.ts.
 */
export function createW01NeonPostgresAdapter(connectionString: string) {
  if (typeof connectionString !== 'string' || connectionString.trim() === '') {
    throw new Error('W01_NEON_HYPERDRIVE_CONNECTION_STRING_MISSING')
  }

  return postgresAdapter({
    pool: { connectionString },
    idType: 'serial',
    push: false,
    disableCreateDatabase: true,
    migrationDir: path.resolve(dirname, 'neon-postgres-migrations'),
    afterSchemaInit: [
      ({ schema, extendTable }) => {
        const users = schema.tables.users
        if (!users) throw new Error('W01 PostgreSQL schema is missing the users table')
        extendTable({
          table: users,
          columns: {
            reset_password_requested_at: text('reset_password_requested_at'),
          },
        })

        const media = schema.tables.media
        if (!media) throw new Error('W01 PostgreSQL schema is missing the media table')
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
  })
}
