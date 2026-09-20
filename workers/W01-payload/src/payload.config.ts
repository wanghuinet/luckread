import fs from 'fs'
import path from 'path'
import { sqliteD1Adapter } from '@payloadcms/db-d1-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'
import type { Payload } from 'payload'
import { fileURLToPath } from 'url'
import { CloudflareContext, getCloudflareContext } from '@opennextjs/cloudflare'
import { GetPlatformProxyOptions } from 'wrangler'
import { r2Storage } from '@payloadcms/storage-r2'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { authSessionStateSchemaHook } from './db/auth-session-state-schema'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const realpath = (value: string) => (fs.existsSync(value) ? fs.realpathSync(value) : undefined)

const isPayloadCLI = process.argv.some((value) => {
  const resolved = realpath(value)
  return resolved !== undefined && resolved.endsWith(path.join('payload', 'bin.js'))
})
const isProduction = process.env.NODE_ENV === 'production'
// The migration workflow sets this only for the explicitly admitted baseline
// migration. This makes the remote-D1 decision independent of package-manager
// CLI argv/symlink shape while keeping next build/dev offline.
const isExplicitRemoteMigration = process.env.PAYLOAD_MIGRATION_REMOTE === 'true'
// ADR-B001 (docs/312-BUILD-BASELINE-AND-BINDING-SEMANTICS-v1.0.md, D-03):
// runtime detection is the only signal stable across all process shapes;
// process.argv-based detection fails in Next.js page-data collection workers.
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
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: sqliteD1Adapter({
    binding: cloudflare.env.D1,
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
    beforeSchemaInit: [authSessionStateSchemaHook],
  }),
  logger: isProduction ? cloudflareLogger : undefined,
  onInit: async (payload: Payload) => {
    if (payload.db.packageName !== '@payloadcms/db-d1-sqlite') return

    // CC-MAPPING-0-AUTH-002-E4-5-D1-ADAPTER-CORRECTION-2026-09-20:
    // The pinned D1 adapter currently aliases upsert to updateOne without
    // forwarding the required { upsert: true } option. Keep the correction
    // at the W01 configuration boundary; do not modify Payload core.
    const updateOne = payload.db.updateOne.bind(payload.db)
    payload.db.upsert = (args) =>
      updateOne({
        ...args,
        options: { upsert: true },
      })
  },
  plugins: [
    r2Storage({
      bucket: cloudflare.env.R2,
      collections: { media: true },
    }),
  ],
})

function getCloudflareContextFromWrangler(): Promise<CloudflareContext> {
  return import(/* webpackIgnore: true */ `${'__wrangler'.replaceAll('_', '')}`).then(
    ({ getPlatformProxy }) =>
      getPlatformProxy({
        environment: process.env.CLOUDFLARE_ENV,
        // D-02: next build/dev stay local; only production Payload CLI
        // migrations admitted by the workflow may opt into remote D1.
        remoteBindings: isProduction && (isPayloadCLI || isExplicitRemoteMigration),
        // During next build the page-data phase forks parallel workers, each
        // of which loads its own workerd against the same local D1 persistence
        // file, so production non-CLI evaluation stays in-memory and offline.
        persist: isProduction ? false : undefined,
      } satisfies GetPlatformProxyOptions),
  )
}
