import type { Pool as NodePostgresPool } from 'pg'

import {
  createPostgresModerationD1Database,
  type W06ModerationPostgresClient,
  type W06ModerationPostgresPool,
} from '../neon-postgres-d1-database.js'
import { createPostgresModerationQueueReadStore } from '../moderation-queue-read-store-postgres.js'
import type { ModerationQueueReadStore } from '../moderation-queue-read-store.js'
import {
  createPostgresModerationCaseDetailReadStore,
  type ModerationCaseDetailReadStore,
} from '../moderation-case-detail-read-store-postgres.js'

/**
 * @deprecated-next-version
 * Reason: W06 Neon runtime still exposes a D1-shaped persistence facade and an explicit legacy D1 test/compatibility branch.
 * Replacement: Native PostgreSQL moderation stores and explicit PostgreSQL transaction/query contracts.
 * Removal: Next release.
 * Condition: Report, moderation, audit, and queue consumers accept native PostgreSQL stores without D1Database signatures or SQL translation; then remove the explicitly selected legacy D1 compatibility branch.
 */
export type W06ModerationDatabaseDriver = 'd1' | 'neon'

export type W06ModerationDatabaseRuntimeEnv = Readonly<{
  D1_03?: D1Database
  W06_MODERATION_DATABASE_DRIVER?: string
  HYPERDRIVE_D1_03?: Readonly<{ connectionString?: string }>
}>

const pools = new WeakMap<object, Promise<NodePostgresPool>>()
const poolAdapters = new WeakMap<object, W06ModerationPostgresPool>()
const databases = new WeakMap<object, D1Database>()
const queueStores = new WeakMap<object, ModerationQueueReadStore>()
const caseDetailStores = new WeakMap<object, ModerationCaseDetailReadStore>()

export function resolveW06ModerationDatabaseDriver(
  env: W06ModerationDatabaseRuntimeEnv,
): W06ModerationDatabaseDriver {
  const configured = env.W06_MODERATION_DATABASE_DRIVER?.trim().toLowerCase() || 'neon'
  if (configured === 'd1' || configured === 'neon') return configured
  throw new Error('W06_MODERATION_DATABASE_DRIVER_UNSUPPORTED')
}

function validateHyperdriveConnectionString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new Error('W06_HYPERDRIVE_D1_03_CONNECTION_STRING_REQUIRED')
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('W06_HYPERDRIVE_D1_03_CONNECTION_STRING_INVALID')
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.pathname.length < 2 ||
    decodeURIComponent(parsed.pathname.replace(/^\/+/, '')) !== 'luckread_governance'
  ) {
    throw new Error('W06_HYPERDRIVE_D1_03_CONNECTION_STRING_INVALID')
  }
  return value
}

function loadW06PostgresPool(binding: object, connectionString: string): Promise<NodePostgresPool> {
  const cached = pools.get(binding)
  if (cached) return cached

  // Load the Node.js PostgreSQL driver lazily, on the first operation against the
  // explicitly selected (or default) Neon runtime.
  const pending = import('pg').then(({ Pool }) => {
    const pool = new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      keepAlive: true,
    })
    pool.on('error', (error: Error) => {
      console.error(JSON.stringify({
        event: 'w06.moderation.postgres.pool_error',
        errorType: error instanceof Error ? error.name : 'UNKNOWN',
      }))
    })
    return pool
  })
  pools.set(binding, pending)
  return pending
}

/**
 * Lazy structural pool adapter. Resolving the W06 Neon database does not load
 * pg; the driver is imported only on the first actual query/connect operation.
 */
export function getW06ModerationPostgresPool(
  env: W06ModerationDatabaseRuntimeEnv,
): W06ModerationPostgresPool {
  if (resolveW06ModerationDatabaseDriver(env) !== 'neon') {
    throw new Error('W06_POSTGRES_POOL_REQUIRES_NEON_DRIVER')
  }
  const binding = env.HYPERDRIVE_D1_03
  if (!binding || typeof binding !== 'object') {
    throw new Error('W06_HYPERDRIVE_D1_03_BINDING_REQUIRED')
  }
  const connectionString = validateHyperdriveConnectionString(binding.connectionString)
  const cached = poolAdapters.get(binding)
  if (cached) return cached

  const load = () => loadW06PostgresPool(binding, connectionString)
  const adapter: W06ModerationPostgresPool = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ) {
      const pool = await load()
      const result = await pool.query(sql, values)
      return {
        rows: result.rows as Row[],
        rowCount: result.rowCount,
      }
    },
    async connect(): Promise<W06ModerationPostgresClient> {
      const pool = await load()
      const client = await pool.connect()
      return {
        async query<Row extends Record<string, unknown> = Record<string, unknown>>(
          sql: string,
          values?: unknown[],
        ) {
          const result = await client.query(sql, values)
          return {
            rows: result.rows as Row[],
            rowCount: result.rowCount,
          }
        },
        release() {
          client.release()
        },
      }
    },
  }
  poolAdapters.set(binding, adapter)
  return adapter
}

export function getW06ModerationDatabase(env: W06ModerationDatabaseRuntimeEnv): D1Database {
  if (resolveW06ModerationDatabaseDriver(env) === 'd1') {
    if (!env.D1_03) throw new Error('W06_D1_03_BINDING_REQUIRED')
    return env.D1_03
  }

  const binding = env.HYPERDRIVE_D1_03
  if (!binding || typeof binding !== 'object') {
    throw new Error('W06_HYPERDRIVE_D1_03_BINDING_REQUIRED')
  }
  const cached = databases.get(binding)
  if (cached) return cached

  const database = createPostgresModerationD1Database(getW06ModerationPostgresPool(env))
  databases.set(binding, database)
  return database
}

/** Dedicated PostgreSQL projection preserves native keyset timestamp precision. */
export function getW06ModerationQueueReadStore(
  env: W06ModerationDatabaseRuntimeEnv,
): ModerationQueueReadStore {
  const binding = env.HYPERDRIVE_D1_03
  if (!binding || typeof binding !== 'object') {
    throw new Error('W06_HYPERDRIVE_D1_03_BINDING_REQUIRED')
  }
  const cached = queueStores.get(binding)
  if (cached) return cached

  const store = createPostgresModerationQueueReadStore(getW06ModerationPostgresPool(env))
  queueStores.set(binding, store)
  return store
}

/** Dedicated PostgreSQL detail reader for the single-case moderation endpoint. */
export function getW06ModerationCaseDetailReadStore(
  env: W06ModerationDatabaseRuntimeEnv,
): ModerationCaseDetailReadStore | undefined {
  if (resolveW06ModerationDatabaseDriver(env) === 'd1') return undefined

  const binding = env.HYPERDRIVE_D1_03
  if (!binding || typeof binding !== 'object') {
    throw new Error('W06_HYPERDRIVE_D1_03_BINDING_REQUIRED')
  }
  const cached = caseDetailStores.get(binding)
  if (cached) return cached

  const store = createPostgresModerationCaseDetailReadStore(getW06ModerationPostgresPool(env))
  caseDetailStores.set(binding, store)
  return store
}

/** Close the Neon pool cached for a disposable PostgreSQL entrypoint rehearsal. */
export async function closeW06ModerationPostgresRuntimeForTest(
  binding: NonNullable<W06ModerationDatabaseRuntimeEnv['HYPERDRIVE_D1_03']>,
): Promise<void> {
  const pending = pools.get(binding)
  if (!pending) return

  pools.delete(binding)
  poolAdapters.delete(binding)
  databases.delete(binding)
  queueStores.delete(binding)
  caseDetailStores.delete(binding)

  const pool = await pending
  await pool.end()
}
