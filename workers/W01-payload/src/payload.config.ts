import fs from 'fs'
import path from 'path'
import { sqliteD1Adapter } from '@payloadcms/db-d1-sqlite'
import { lexicalEditor, UploadFeature } from '@payloadcms/richtext-lexical'
import { redirectsPlugin } from '@payloadcms/plugin-redirects'
import { buildConfig } from 'payload'
import type { Payload } from 'payload'
import { fileURLToPath } from 'url'
import { CloudflareContext, getCloudflareContext } from '@opennextjs/cloudflare'
import { GetPlatformProxyOptions } from 'wrangler'
import { r2Storage } from '@payloadcms/storage-r2'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { payloadAdminOnly } from './auth/payload-admin-access'
import { createPublicMediaUrl } from './media/public-media-url'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const realpath = (value: string) => (fs.existsSync(value) ? fs.realpathSync(value) : undefined)

const isPayloadCLI = process.argv.some((value) => {
  const resolved = realpath(value)
  return resolved !== undefined && resolved.endsWith(path.join('payload', 'bin.js'))
})
const isProduction = process.env.NODE_ENV === 'production'
const isExplicitRemoteMigration = process.env.PAYLOAD_MIGRATION_REMOTE === 'true'
const isWorkerRuntime =
  typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'

const createLog =
  (level: string, fn: typeof console.log) => (objOrMsg: object | string, msg?: string) => {
    if (typeof objOrMsg === 'string') {
      fn(JSON.stringify({ level, msg: objOrMsg }))
    } else {
      fn(JSON.stringify({ level, ...objOrMsg, msg: msg ?? (objOrMsg as { msg?: string }).msg }))
    }
  }

const cloudflareLogger = {
  level: process.env.PAYLOAD_LOG_LEVEL || 'info',
  trace: createLog('trace', console.debug),
  debug: createLog('debug', console.debug),
  info: createLog('info', console.log),
  warn: createLog('warn', console.warn),
  error: createLog('error', console.error),
  fatal: createLog('fatal', console.error),
  silent: () => {},
} as any

const cloudflare = isWorkerRuntime
  ? await getCloudflareContext({ async: true })
  : await getCloudflareContextFromWrangler()

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Media],
  editor: lexicalEditor({
    features: ({ defaultFeatures }) => [
      ...defaultFeatures.filter((feature) => feature.key !== 'upload'),
      UploadFeature({ enabledCollections: ['media'] }),
    ],
  }),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: sqliteD1Adapter({
    binding: cloudflare.env.D1,
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
  }),
  logger: isProduction ? cloudflareLogger : undefined,
  onInit: async (payload: Payload) => {
    if (payload.db.packageName !== '@payloadcms/db-d1-sqlite') return
    const updateOne = payload.db.updateOne.bind(payload.db)
    payload.db.upsert = (args) =>
      updateOne({
        ...args,
        options: { upsert: true },
      })
  },
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
        ],
      },
    }),
    r2Storage({
      bucket: cloudflare.env.R2,
      collections: { media: { prefix: 'media', generateFileURL: createPublicMediaUrl } },
    }),
  ],
})

function getCloudflareContextFromWrangler(): Promise<CloudflareContext> {
  return import(/* webpackIgnore: true */ `${'__wrangler'.replaceAll('_', '')}`).then(
    ({ getPlatformProxy }) =>
      getPlatformProxy({
        environment: process.env.CLOUDFLARE_ENV,
        remoteBindings: isProduction && (isPayloadCLI || isExplicitRemoteMigration),
        persist: process.env.CLOUDFLARE_PERSIST_TO
          ? { path: path.join(process.env.CLOUDFLARE_PERSIST_TO, 'v3') }
          : isProduction
            ? false
            : undefined,
      } satisfies GetPlatformProxyOptions),
  )
}
