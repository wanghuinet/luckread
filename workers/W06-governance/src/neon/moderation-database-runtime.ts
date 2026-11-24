import type { Pool as NodePostgresPool } from 'pg'

import type {
  W06ModerationPostgresClient,
  W06ModerationPostgresPool,
} from '../moderation-postgres-pool.js'
import { createPostgresModerationQueueReadStore } from '../moderation-queue-read-store-postgres.js'
import type { ModerationQueueReadStore } from '../moderation-queue-read-store.js'
import { createPostgresModerationReportWriteStore } from '../moderation-report-write-store-postgres.js'
import type { ModerationReportWriteStore } from '../moderation-report-write-store.js'
import { createPostgresAuditEventStore } from '../audit-event-store-postgres.js'
import type { AuditEventStore } from '../audit-event-store.js'
import {
  createPostgresModerationCaseDetailReadStore,
  type ModerationCaseDetailReadStore,
} from '../moderation-case-detail-read-store-postgres.js'
import { createPostgresModerationDecisionWriteStore } from '../moderation-decision-write-store-postgres.js'
import type { ModerationDecisionWriteStore } from '../moderation-decision-write-store-postgres.js'

export type W06ModerationDatabaseRuntimeEnv = Readonly<{
  HYPERDRIVE_NEON_GOVERNANCE?: Readonly<{ connectionString?: string }>
}>

const pools = new WeakMap<object, Promise<NodePostgresPool>>()
const poolAdapters = new WeakMap<object, W06ModerationPostgresPool>()
const queueStores = new WeakMap<object, ModerationQueueReadStore>()
const reportStores = new WeakMap<object, ModerationReportWriteStore>()
const auditEventStores = new WeakMap<object, AuditEventStore>()
const caseDetailStores = new WeakMap<object, ModerationCaseDetailReadStore>()
const decisionWriteStores = new WeakMap<object, ModerationDecisionWriteStore>()

function validateHyperdriveConnectionString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new Error('W06_HYPERDRIVE_NEON_GOVERNANCE_CONNECTION_STRING_REQUIRED')
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('W06_HYPERDRIVE_NEON_GOVERNANCE_CONNECTION_STRING_INVALID')
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.pathname.length < 2 ||
    decodeURIComponent(parsed.pathname.replace(/^\/+/, '')) !== 'luckread_governance'
  ) {
    throw new Error('W06_HYPERDRIVE_NEON_GOVERNANCE_CONNECTION_STRING_INVALID')
  }
  return value
}

function loadW06PostgresPool(binding: object, connectionString: string): Promise<NodePostgresPool> {
  const cached = pools.get(binding)
  if (cached) return cached

  // Load the Node.js PostgreSQL driver lazily, on the first operation against the
  // Neon runtime.
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
 * Lazy structural pool adapter. Resolving the W06 PostgreSQL pool does not load
 * pg; the driver is imported only on the first actual query/connect operation.
 */
export function getW06ModerationPostgresPool(
  env: W06ModerationDatabaseRuntimeEnv,
): W06ModerationPostgresPool {
  const binding = env.HYPERDRIVE_NEON_GOVERNANCE
  if (!binding || typeof binding !== 'object') {
    throw new Error('W06_HYPERDRIVE_NEON_GOVERNANCE_BINDING_REQUIRED')
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

/** W06-owned Report writes use native PostgreSQL transactions and W09's AuditEvent append-only guard. */
export function getW06ModerationReportWriteStore(
  env: W06ModerationDatabaseRuntimeEnv,
): ModerationReportWriteStore {
  const pool = getW06ModerationPostgresPool(env)
  const binding = env.HYPERDRIVE_NEON_GOVERNANCE
  if (!binding || typeof binding !== 'object') {
    throw new Error('W06_HYPERDRIVE_NEON_GOVERNANCE_BINDING_REQUIRED')
  }
  const cached = reportStores.get(binding)
  if (cached) return cached

  const store = createPostgresModerationReportWriteStore(pool)
  reportStores.set(binding, store)
  return store
}

/** Native W06 consumer Store reuses W09's append-only SELECT/INSERT SQL policy. */
export function getW06AuditEventStore(env: W06ModerationDatabaseRuntimeEnv): AuditEventStore {
  const pool = getW06ModerationPostgresPool(env)
  const binding = env.HYPERDRIVE_NEON_GOVERNANCE
  if (!binding || typeof binding !== 'object') {
    throw new Error('W06_HYPERDRIVE_NEON_GOVERNANCE_BINDING_REQUIRED')
  }
  const cached = auditEventStores.get(binding)
  if (cached) return cached

  const store = createPostgresAuditEventStore(pool)
  auditEventStores.set(binding, store)
  return store
}

/** Native PostgreSQL transaction for moderation Decision, Case, idempotency, W09 AuditEvent and Outbox. */
export function getW06ModerationDecisionWriteStore(
  env: W06ModerationDatabaseRuntimeEnv,
): ModerationDecisionWriteStore {
  const pool = getW06ModerationPostgresPool(env)
  const binding = env.HYPERDRIVE_NEON_GOVERNANCE
  if (!binding || typeof binding !== 'object') {
    throw new Error('W06_HYPERDRIVE_NEON_GOVERNANCE_BINDING_REQUIRED')
  }
  const cached = decisionWriteStores.get(binding)
  if (cached) return cached

  const store = createPostgresModerationDecisionWriteStore(pool)
  decisionWriteStores.set(binding, store)
  return store
}

/** Dedicated PostgreSQL projection preserves native keyset timestamp precision. */
export function getW06ModerationQueueReadStore(
  env: W06ModerationDatabaseRuntimeEnv,
): ModerationQueueReadStore {
  const pool = getW06ModerationPostgresPool(env)
  const binding = env.HYPERDRIVE_NEON_GOVERNANCE
  if (!binding || typeof binding !== 'object') {
    throw new Error('W06_HYPERDRIVE_NEON_GOVERNANCE_BINDING_REQUIRED')
  }
  const cached = queueStores.get(binding)
  if (cached) return cached

  const store = createPostgresModerationQueueReadStore(pool)
  queueStores.set(binding, store)
  return store
}

/** Dedicated PostgreSQL detail reader for the single-case moderation endpoint. */
export function getW06ModerationCaseDetailReadStore(
  env: W06ModerationDatabaseRuntimeEnv,
): ModerationCaseDetailReadStore {
  const binding = env.HYPERDRIVE_NEON_GOVERNANCE
  if (!binding || typeof binding !== 'object') {
    throw new Error('W06_HYPERDRIVE_NEON_GOVERNANCE_BINDING_REQUIRED')
  }
  const cached = caseDetailStores.get(binding)
  if (cached) return cached

  const store = createPostgresModerationCaseDetailReadStore(getW06ModerationPostgresPool(env))
  caseDetailStores.set(binding, store)
  return store
}

/** Close the Neon pool cached for a disposable PostgreSQL entrypoint rehearsal. */
export async function closeW06ModerationPostgresRuntimeForTest(
  binding: NonNullable<W06ModerationDatabaseRuntimeEnv['HYPERDRIVE_NEON_GOVERNANCE']>,
): Promise<void> {
  const pending = pools.get(binding)
  if (!pending) return

  pools.delete(binding)
  poolAdapters.delete(binding)
  queueStores.delete(binding)
  reportStores.delete(binding)
  auditEventStores.delete(binding)
  caseDetailStores.delete(binding)
  decisionWriteStores.delete(binding)

  const pool = await pending
  await pool.end()
}
