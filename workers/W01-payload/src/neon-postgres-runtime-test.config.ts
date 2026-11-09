import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { redirectsPlugin } from '@payloadcms/plugin-redirects'
import { buildConfig } from 'payload'

import { payloadAdminOnly } from './auth/payload-admin-access.js'
import { Users } from './collections/Users.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const databaseUrl = process.env.PAYLOAD_SCHEMA_DATABASE_URL

if (!databaseUrl) throw new Error('PAYLOAD_SCHEMA_DATABASE_URL is required')
const parsedDatabaseUrl = new URL(databaseUrl)
const localRuntimeTarget =
  new Set(['127.0.0.1', 'localhost', 'postgres']).has(parsedDatabaseUrl.hostname) &&
  parsedDatabaseUrl.port === '5432' &&
  parsedDatabaseUrl.pathname === '/luckread_schema'

if (!localRuntimeTarget) {
  throw new Error('W01 Payload PostgreSQL runtime rehearsal is restricted to disposable local luckread_schema')
}

// This config deliberately excludes R2 and is only used for Local API CRUD
// against the disposable PostgreSQL 18 service in CI. Payload's auth collection
// already defines reset_password_requested_at; do not extend it a second time.
// It is not a Worker config.
export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
  },
  collections: [Users],
  secret: process.env.PAYLOAD_SECRET || 'local-postgres-runtime-rehearsal-only',
  db: postgresAdapter({
    pool: { connectionString: databaseUrl, max: 2 },
    idType: 'serial',
    push: false,
    disableCreateDatabase: true,
  }),
  plugins: [
    redirectsPlugin({
      collections: ['users'],
      redirectTypes: ['301'],
      overrides: {
        access: {
          create: payloadAdminOnly,
          read: payloadAdminOnly,
          update: payloadAdminOnly,
          delete: payloadAdminOnly,
          admin: payloadAdminOnly,
        },
        fields: ({ defaultFields }) => [
          ...defaultFields,
          {
            name: 'redirectScope',
            type: 'select',
            options: [{ label: 'Username history', value: 'username' }],
            defaultValue: 'username',
            required: true,
            index: true,
            admin: { position: 'sidebar', readOnly: true },
          },
          {
            name: 'identityId',
            type: 'text',
            required: true,
            index: true,
            admin: { position: 'sidebar', readOnly: true },
          },
          {
            name: 'sourceUsername',
            type: 'text',
            required: true,
            index: true,
            admin: { position: 'sidebar', readOnly: true },
          },
          {
            name: 'destinationUsername',
            type: 'text',
            required: true,
            admin: { position: 'sidebar', readOnly: true },
          },
          {
            name: 'expiresAt',
            type: 'date',
            required: true,
            index: true,
            admin: { position: 'sidebar', readOnly: true },
          },
        ],
      },
    }),
  ],
})
