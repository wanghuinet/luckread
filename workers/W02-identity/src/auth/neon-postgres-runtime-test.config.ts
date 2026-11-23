/**
 * Test-only W02 runtime rehearsal configuration.
 *
 * It reuses the canonical Better Auth builder and official PostgreSQL Pool
 * adapter, but selects the explicit postgres-rehearsal profile. It injects the
 * PostgreSQL MFA factor-state Store, L1 role materialization and AUTH-013
 * email-verification lifecycle callbacks.
 *
 * This file is never imported by the deployed Worker.
 */
import { Pool } from 'pg'

import { activateEmailVerifiedAccountPostgres } from '../neon/email-verification-activation-postgres.js'
import { ensureBaseUserRolePostgres } from '../neon/role-assignment-postgres.js'
import { createPostgresMfaFactorStateStore } from '../neon/mfa-factor-state-postgres.js'

import {
  buildLuckReadAuth,
  type BetterAuthEnv,
} from './better-auth.js'

const connectionString = process.env.W02_RUNTIME_DATABASE_URL
if (!connectionString) {
  throw new Error('W02_RUNTIME_DATABASE_URL is required for the PostgreSQL runtime rehearsal')
}

const target = new URL(connectionString)
const localDatabaseTarget =
  new Set(['127.0.0.1', 'localhost', 'postgres']).has(target.hostname) &&
  target.port === '5432' &&
  target.pathname === '/luckread_schema'

if (!localDatabaseTarget) {
  throw new Error('Refusing W02 runtime rehearsal outside disposable local luckread_schema PostgreSQL')
}

export const postgresPool = new Pool({
  connectionString,
  max: 2,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 5_000,
})

const rehearsalEnvironment = {
  CLOUDFLARE_ENV: 'development',
} satisfies BetterAuthEnv

export const postgresLifecycleAdapters = {
  afterUserCreated: (userId: string) => ensureBaseUserRolePostgres(postgresPool, userId),
  afterEmailVerified: (userId: string, now?: string) =>
    activateEmailVerifiedAccountPostgres(postgresPool, userId, now),
}

export const auth = buildLuckReadAuth(
  rehearsalEnvironment,
  postgresPool,
  'postgres-rehearsal',
  createPostgresMfaFactorStateStore(postgresPool),
  postgresLifecycleAdapters,
)
