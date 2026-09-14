import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getCloudflareContext, type CloudflareContext } from '@opennextjs/cloudflare'
import type { GetPlatformProxyOptions } from 'wrangler'
import { sqliteD1Adapter } from '@payloadcms/db-d1-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'

import { Users } from './collections/Users'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const realpath = (value: string) => (fs.existsSync(value) ? fs.realpathSync(value) : undefined)

const isProduction = process.env.NODE_ENV === 'production'
const isWorkerRuntime =
  typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'

const cloudflare = isWorkerRuntime
  ? await getCloudflareContext({ async: true })
  : await getCloudflareContextFromWrangler()

export default buildConfig({
  admin: {
    user: Users.slug,
  },
  collections: [Users],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || 'development-only-secret',
  db: sqliteD1Adapter({
    binding: cloudflare.env.D1,
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

function getCloudflareContextFromWrangler(): Promise<CloudflareContext> {
  return import(/* webpackIgnore: true */ `${'__wrangler'.replaceAll('_', '')}`).then(
    ({ getPlatformProxy }) =>
      getPlatformProxy({
        environment: process.env.CLOUDFLARE_ENV,
        remoteBindings: isProduction && process.argv.some((value) => realpath(value)?.endsWith(path.join('payload', 'bin.js'))),
      } satisfies GetPlatformProxyOptions),
  )
}
