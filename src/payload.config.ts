import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { D1Database } from '@cloudflare/workers-types'
import { sqliteD1Adapter } from '@payloadcms/db-d1-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'

import { Users } from './collections/Users'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// The Cloudflare D1 template supplies the `cloudflare.env` runtime binding.
// Keep the binding lookup at the infrastructure boundary; no domain code may
// depend on the binding name.
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
