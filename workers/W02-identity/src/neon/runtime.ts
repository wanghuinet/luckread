import { Pool } from 'pg'

import { createPostgresAccountStateTransitionStore } from './account-state-transition-store-postgres.js'
import { createPostgresCreatorRoleGrantStore } from './creator-role-grant-store-postgres.js'
import { createPostgresMfaAuditOperationReceiptStore } from './mfa-audit-operation-receipts-postgres.js'
import { createPostgresMfaEnrollmentConfirmStore } from './mfa-enrollment-confirm-postgres.js'
import { createPostgresMfaEnrollmentStartStore } from './mfa-enrollment-start-postgres.js'
import {
  createPostgresMfaFactorStateStore,
  createPostgresMfaStatusStore,
} from './mfa-factor-state-postgres.js'
import { createPostgresPrincipalAuthorityStore } from './principal-authority-postgres.js'
import { createPostgresRegistrationRollbackStore } from './registration-rollback-postgres.js'
import { createPostgresRoleLayerStore } from './role-layer-postgres.js'
import { createPostgresSessionListStore } from './session-list-postgres.js'
import { createPostgresSessionLogoutStore } from './session-logout-postgres-store.js'
import { createPostgresSessionRevocationStore } from './session-revocation-postgres-store.js'
import { createPostgresUsernameChangeStore } from './username-change-postgres.js'

export type W02DatabaseDriver = 'neon'

export type W02RuntimeEnv = {
  W02_DATABASE_DRIVER?: string
  CLOUDFLARE_ENV?: string
  HYPERDRIVE?: {
    connectionString?: string
  }
}

type InstrumentablePgClient = {
  query: (...args: unknown[]) => unknown
}

const instrumentedClients = new WeakSet<object>()

function pgOperationLabel(input: unknown): string {
  let statement = ''
  if (typeof input === 'string') statement = input
  else if (input && typeof input === 'object' && 'text' in input) {
    const text = (input as { text?: unknown }).text
    if (typeof text === 'string') statement = text
  }
  const operation = /^(SELECT|INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|WITH)\\b/i.exec(statement.trim())?.[1]
  return operation?.toUpperCase() ?? 'OTHER'
}

/**
 * Development-only PostgreSQL query tracing. It deliberately logs only the
 * SQL command category, completion/failure state and duration; never SQL text,
 * bound values, row data or connection credentials.
 */
function instrumentDevelopmentPgClient(client: object): void {
  if (instrumentedClients.has(client)) return
  instrumentedClients.add(client)

  const instrumentable = client as InstrumentablePgClient
  const originalQuery = instrumentable.query.bind(client)
  instrumentable.query = (...args: unknown[]) => {
    // Callback-style queries are uncommon in Better Auth; preserve their exact
    // callback/return contract and do not wrap the callback result.
    if (args.some((value) => typeof value === 'function')) {
      return originalQuery(...args)
    }

    const operation = pgOperationLabel(args[0])
    const startedAt = Date.now()
    console.info(JSON.stringify({
      event: 'w02.postgres.query_started',
      operation,
    }))

    let result: unknown
    try {
      result = originalQuery(...args)
    } catch (error) {
      console.error(JSON.stringify({
        event: 'w02.postgres.query_failed',
        operation,
        errorType: error instanceof Error ? error.name : 'UNKNOWN',
      }))
      throw error
    }

    if (result && typeof result === 'object' && 'then' in result &&
        typeof (result as { then?: unknown }).then === 'function') {
      return Promise.resolve(result).then(
        (value) => {
          console.info(JSON.stringify({
            event: 'w02.postgres.query_completed',
            operation,
            durationMs: Math.max(0, Date.now() - startedAt),
          }))
          return value
        },
        (error: unknown) => {
          console.error(JSON.stringify({
            event: 'w02.postgres.query_failed',
            operation,
            durationMs: Math.max(0, Date.now() - startedAt),
            errorType: error instanceof Error ? error.name : 'UNKNOWN',
          }))
          throw error
        },
      )
    }

    console.info(JSON.stringify({
      event: 'w02.postgres.query_completed',
      operation,
      durationMs: Math.max(0, Date.now() - startedAt),
    }))
    return result
  }
}

const pools = new WeakMap<object, Pool>()
const runtimes = new WeakMap<object, ReturnType<typeof buildW02PostgresRuntime>>()

/** W02 runtime is Neon-only. Missing and legacy D1 selections fail closed. */
export function resolveW02DatabaseDriver(env: W02RuntimeEnv): W02DatabaseDriver {
  const configured = env.W02_DATABASE_DRIVER?.trim().toLowerCase()
  if (configured !== 'neon') throw new Error('W02_DATABASE_DRIVER_UNSUPPORTED')
  return 'neon'
}

export function isW02NeonRuntime(env: W02RuntimeEnv): boolean {
  return resolveW02DatabaseDriver(env) === 'neon'
}

function validateHyperdriveConnectionString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new Error('W02_HYPERDRIVE_CONNECTION_STRING_REQUIRED')
  }
  let target: URL
  try {
    target = new URL(value)
  } catch {
    throw new Error('W02_HYPERDRIVE_CONNECTION_STRING_INVALID')
  }
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !target.hostname ||
    target.pathname.length < 2
  ) {
    throw new Error('W02_HYPERDRIVE_CONNECTION_STRING_INVALID')
  }
  return value
}

export function getW02PostgresPool(env: W02RuntimeEnv): Pool {
  if (!isW02NeonRuntime(env)) {
    throw new Error('W02_POSTGRES_POOL_REQUIRES_NEON_DRIVER')
  }
  const binding = env.HYPERDRIVE
  if (!binding || typeof binding !== 'object') {
    throw new Error('W02_HYPERDRIVE_BINDING_REQUIRED')
  }

  const cached = pools.get(binding)
  if (cached) return cached

  const connectionString = validateHyperdriveConnectionString(binding.connectionString)
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
  })
  const developmentDiagnostics = env.CLOUDFLARE_ENV?.trim().toLowerCase() === 'development'
  if (developmentDiagnostics) {
    console.info(JSON.stringify({ event: 'w02.postgres.pool_created' }))
    pool.on('connect', (client) => {
      instrumentDevelopmentPgClient(client)
      console.info(JSON.stringify({ event: 'w02.postgres.connection_established' }))
    })
    pool.on('acquire', () => console.info(JSON.stringify({ event: 'w02.postgres.connection_acquired' })))
    pool.on('remove', () => console.info(JSON.stringify({ event: 'w02.postgres.connection_removed' })))
  }
  pool.on('error', (error) => {
    console.error(JSON.stringify({
      event: 'w02.postgres.pool_error',
      errorType: error instanceof Error ? error.name : 'UNKNOWN',
    }))
  })
  pools.set(binding, pool)
  return pool
}

function buildW02PostgresRuntime(pool: Pool) {
  return {
    pool,
    accountStateTransitionStore: createPostgresAccountStateTransitionStore(pool),
    creatorRoleGrantStore: createPostgresCreatorRoleGrantStore(pool),
    mfaAuditOperationReceiptStore: createPostgresMfaAuditOperationReceiptStore(pool),
    mfaEnrollmentConfirmStore: createPostgresMfaEnrollmentConfirmStore(pool),
    mfaEnrollmentStartStore: createPostgresMfaEnrollmentStartStore(pool),
    mfaFactorStateStore: createPostgresMfaFactorStateStore(pool),
    mfaStatusStore: createPostgresMfaStatusStore(pool),
    principalAuthorityStore: createPostgresPrincipalAuthorityStore(pool),
    registrationRollbackStore: createPostgresRegistrationRollbackStore(pool),
    roleLayerStore: createPostgresRoleLayerStore(pool),
    sessionListStore: createPostgresSessionListStore(pool),
    sessionLogoutStore: createPostgresSessionLogoutStore(pool),
    sessionRevocationStore: createPostgresSessionRevocationStore(pool),
    usernameChangeStore: createPostgresUsernameChangeStore(pool),
  }
}

/**
 * One adapter composition per Hyperdrive binding/isolate. Every store returned
 * here targets the same D1-01 Neon database as Better Auth; no route silently
 * falls back to a different D1 authority in Neon mode.
 */
export function getW02PostgresRuntime(env: W02RuntimeEnv) {
  const binding = env.HYPERDRIVE
  if (!binding || typeof binding !== 'object') {
    throw new Error('W02_HYPERDRIVE_BINDING_REQUIRED')
  }
  const cached = runtimes.get(binding)
  if (cached) return cached
  const runtime = buildW02PostgresRuntime(getW02PostgresPool(env))
  runtimes.set(binding, runtime)
  return runtime
}
