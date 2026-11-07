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

// Schema generation only: no Cloudflare binding or R2 bucket is used.
const schemaOnlyR2Bucket = Object.freeze({}) as never
const databaseUrl =
  process.env.PAYLOAD_SCHEMA_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:5432/luckread_schema'

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
      enabled: false,
      alwaysInsertFields: true,
      bucket: schemaOnlyR2Bucket,
      collections: {
        media: { prefix: 'media', generateFileURL: createPublicMediaUrl },
      },
    }),
  ],
})
