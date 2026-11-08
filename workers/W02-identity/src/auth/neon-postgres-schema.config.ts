/**
 * Schema-generation-only Better Auth configuration.
 *
 * This module reuses W02's canonical Better Auth options/plugins and injects a
 * local PostgreSQL pool for the pinned Better Auth CLI. It is not imported by
 * the Worker entrypoint and does not alter W02's production D1_01 binding.
 *
 * The D1Database value below is an inert type-only placeholder captured by
 * request hooks. Schema generation never invokes those hooks.
 */
import { Pool } from 'pg'

import { buildLuckReadAuth, type BetterAuthEnv } from './better-auth.js'

const schemaEnvironment = {
  D1_01: undefined as unknown as BetterAuthEnv['D1_01'],
  CLOUDFLARE_ENV: 'production',
} satisfies BetterAuthEnv

const postgresPool = new Pool({
  host: process.env.W02_SCHEMA_PGHOST ?? '127.0.0.1',
  port: Number(process.env.W02_SCHEMA_PGPORT ?? '5432'),
  user: process.env.W02_SCHEMA_PGUSER ?? 'schema_generator',
  password: process.env.W02_SCHEMA_PGPASSWORD ?? 'local-schema-only',
  database: process.env.W02_SCHEMA_PGDATABASE ?? 'luckread_schema',
  max: 1,
  connectionTimeoutMillis: 5_000,
})

export const auth = buildLuckReadAuth(schemaEnvironment, postgresPool)
