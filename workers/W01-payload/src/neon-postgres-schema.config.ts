import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { text } from '@payloadcms/db-postgres/drizzle/pg-core'
import { redirectsPlugin } from '@payloadcms/plugin-redirects'
import { lexicalEditor, UploadFeature } from '@payloadcms/richtext-lexical'
import { r2Storage } from '@payloadcms/storage-r2'
import { buildConfig } from 'payload'

import { payloadAdminOnly } from './auth/payload-admin-access.js'
import { Media } from './collections/Media.js'
import { Users } from './collections/Users.js'
import { createPublicMediaUrl } from './media/public-media-url.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// Schema generation is local-only by default. A remote D1-01 application is
// possible only through the explicit, main-branch manual workflow that sets
// NEON_SCHEMA_APPLY=true and provides the exact luckread Neon URL.
const databaseUrl = process.env.PAYLOAD_SCHEMA_DATABASE_URL
if (!databaseUrl) throw new Error('PAYLOAD_SCHEMA_DATABASE_URL is required')
const parsedDatabaseUrl = new URL(databaseUrl)
const localSchemaTarget =
  new Set(['127.0.0.1', 'localhost', 'postgres']).has(parsedDatabaseUrl.hostname) &&
  parsedDatabaseUrl.port === '5432' &&
  new Set(['/luckread_schema', '/luckread_schema_rollback']).has(parsedDatabaseUrl.pathname)
const neonD101Target =
  process.env.NEON_SCHEMA_APPLY === 'true' &&
  ['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol) &&
  parsedDatabaseUrl.hostname.endsWith('.neon.tech') &&
  parsedDatabaseUrl.pathname === '/luckread' &&
  ['require', 'verify-ca', 'verify-full'].includes(parsedDatabaseUrl.searchParams.get('sslmode')) &&
  parsedDatabaseUrl.searchParams.get('channel_binding') === 'require'
if (!localSchemaTarget && !neonD101Target) {
  throw new Error('Refusing to initialize Payload schema against an unauthorized database target')
}

// R2's adapter is configured only so Payload can derive its real media schema
// fields. The CLI uses disableOnInit, and no upload/static handler is invoked.

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
  },
  collections: [Users, Media],
  editor: lexicalEditor({
    features: ({ defaultFeatures }) => [
      ...defaultFeatures.filter((feature) => feature.key !== 'upload'),
      UploadFeature({ enabledCollections: ['media'] }),
    ],
  }),
  secret: process.env.PAYLOAD_SECRET || 'schema-generation-only-not-a-runtime-secret',
  typescript: {
    outputFile: path.resolve(dirname, 'neon-postgres-payload-types.ts'),
  },
  db: postgresAdapter({
    pool: { connectionString: databaseUrl },
    idType: 'serial',
    push: false,
    disableCreateDatabase: true,
    migrationDir: path.resolve(dirname, 'neon-postgres-migrations'),
    afterSchemaInit: [
      ({ schema, extendTable }) => {
        const users = schema.tables.users
        if (!users) throw new Error('W01 PostgreSQL schema is missing the users table')
        // Preserve this existing W01 physical column without exposing a new
        // public Payload Collection field.
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
    // v3.90.2's R2 plugin can insert its schema fields while disabled.
    // It adds prefix and _objectKey without enabling upload/storage handlers.
    r2Storage({
      // Keep the R2 field schema active. The schema CLI's disableOnInit mode
      // prevents storage initialization and no upload handlers are invoked.
      alwaysInsertFields: true,
      bucket: Object.freeze({}) as never,
      collections: {
        media: { prefix: 'media', generateFileURL: createPublicMediaUrl },
      },
    }),
  ],
})
