import {
  getW07PaymentWebhookPostgresPool,
  type W07PaymentMethodReadRuntimeEnv,
} from './neon/payment-method-read-runtime.js'
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'

export type RenewalCycleState =
  | 'AWAITING_PRICING'
  | 'AWAITING_MANDATE'
  | 'PREPARED'
  | 'PAYMENT_READY'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'RECONCILIATION_REQUIRED'

export type RenewalCycleRow = {
  cycle_id: string
  provider: 'hyperswitch'
  merchant_id: string
  subscription_id: string
  subscriber_id: string
  plan_id: string
  plan_version: number
  cycle_start: string
  cycle_end: string
  billing_interval: 'MONTHLY' | 'YEARLY'
  currency: string
  offer_snapshot_json: string
  amount_minor: number | null
  pricing_snapshot_json: string | null
  payment_method_id: string | null
  mandate_record_id: string | null
  order_id: string | null
  payment_id: string | null
  state: RenewalCycleState
  subscription_sync_state: 'PENDING' | 'APPLIED' | 'RECONCILIATION_REQUIRED'
  subscription_sync_updated_at: string | null
  subscription_sync_error_code: string | null
  attempt_number: number
  provider_response_status: string | null
  outcome_code: string | null
  lease_token: string | null
  lease_expires_at: string | null
  version: number
  created_at: string
  updated_at: string
}

export type RenewalCursorRow = {
  state_id: 'subscription-renewals'
  cursor_period_end: string | null
  cursor_subscription_id: string | null
  version: number
  updated_at: string
}

export type RenewalCycleStore = W07WebhookPostgresPool

export type RenewalCycleRuntimeEnv = W07PaymentMethodReadRuntimeEnv

/** Renewal-cycle state is stored in the Neon finance PostgreSQL database. */
export function getW07RenewalCycleStore(env: RenewalCycleRuntimeEnv): RenewalCycleStore {
  try {
    const pool = getW07PaymentWebhookPostgresPool(env)
    if (!pool) throw new Error('W07_RENEWAL_CYCLE_STORE_UNAVAILABLE')
    return pool
  } catch {
    throw new Error('W07_RENEWAL_CYCLE_STORE_UNAVAILABLE')
  }
}

function failUnavailable(): never {
  throw new Error('W07_RENEWAL_CYCLE_POSTGRES_UNAVAILABLE')
}

const RENEWAL_CYCLE_COLUMNS =
  'cycle_id, provider, merchant_id, subscription_id, subscriber_id, plan_id, ' +
  'plan_version::double precision AS plan_version, ' +
  `to_char(cycle_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS cycle_start, ` +
  `to_char(cycle_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS cycle_end, ` +
  'billing_interval, currency, offer_snapshot_json, ' +
  'amount_minor::double precision AS amount_minor, pricing_snapshot_json, ' +
  'payment_method_id, mandate_record_id, order_id, payment_id, state, subscription_sync_state, ' +
  `CASE WHEN subscription_sync_updated_at IS NULL THEN NULL ELSE to_char(subscription_sync_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS subscription_sync_updated_at, ` +
  'subscription_sync_error_code, attempt_number::double precision AS attempt_number, ' +
  'provider_response_status, outcome_code, lease_token, ' +
  `CASE WHEN lease_expires_at IS NULL THEN NULL ELSE to_char(lease_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS lease_expires_at, ` +
  'version::double precision AS version, ' +
  `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at, ` +
  `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at`

const SCHEDULER_CURSOR_COLUMNS =
  "state_id, cursor_subscription_id, version::double precision AS version, " +
  `CASE WHEN cursor_period_end IS NULL THEN NULL ELSE to_char(cursor_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS cursor_period_end, ` +
  `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at`

export async function readRenewalCycleByIdPostgres(
  pool: W07WebhookPostgresPool,
  cycleId: string,
): Promise<RenewalCycleRow | null> {
  try {
    const result = await pool.query<RenewalCycleRow & Record<string, unknown>>(
      `SELECT ${RENEWAL_CYCLE_COLUMNS} FROM subscription_renewal_cycles WHERE cycle_id = $1 LIMIT 1`,
      [cycleId],
    )
    return result.rows[0] ?? null
  } catch {
    return failUnavailable()
  }
}

export async function readRenewalCycleByPeriodPostgres(
  pool: W07WebhookPostgresPool,
  subscriptionId: string,
  cycleStart: string,
): Promise<RenewalCycleRow | null> {
  try {
    const result = await pool.query<RenewalCycleRow & Record<string, unknown>>(
      `SELECT ${RENEWAL_CYCLE_COLUMNS} FROM subscription_renewal_cycles WHERE subscription_id = $1 AND cycle_start = $2::timestamptz LIMIT 1`,
      [subscriptionId, cycleStart],
    )
    return result.rows[0] ?? null
  } catch {
    return failUnavailable()
  }
}

export type InsertRenewalCycleInput = Readonly<{
  cycleId: string
  merchantId: string
  subscriptionId: string
  subscriberId: string
  planId: string
  planVersion: number
  cycleStart: string
  cycleEnd: string
  billingInterval: 'MONTHLY' | 'YEARLY'
  currency: string
  offerSnapshotJson: string
  now: string
}>

export async function insertRenewalCyclePostgres(
  pool: W07WebhookPostgresPool,
  input: InsertRenewalCycleInput,
): Promise<boolean> {
  try {
    const result = await pool.query<{ cycle_id: string } & Record<string, unknown>>(
      'INSERT INTO subscription_renewal_cycles ' +
      '(cycle_id, provider, merchant_id, subscription_id, subscriber_id, plan_id, plan_version, ' +
      'cycle_start, cycle_end, billing_interval, currency, offer_snapshot_json, amount_minor, ' +
      'pricing_snapshot_json, payment_method_id, mandate_record_id, order_id, payment_id, state, ' +
      'attempt_number, provider_response_status, outcome_code, lease_token, lease_expires_at, version, created_at, updated_at) ' +
      "VALUES ($1, 'hyperswitch', $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9, $10, $11, " +
      "NULL, NULL, NULL, NULL, NULL, NULL, 'AWAITING_PRICING', 0, NULL, NULL, NULL, NULL, 1, $12::timestamptz, $13::timestamptz) " +
      'ON CONFLICT (subscription_id, cycle_start) DO NOTHING RETURNING cycle_id',
      [
        input.cycleId, input.merchantId, input.subscriptionId, input.subscriberId,
        input.planId, input.planVersion, input.cycleStart, input.cycleEnd,
        input.billingInterval, input.currency, input.offerSnapshotJson, input.now, input.now,
      ],
    )
    return result.rows.length === 1
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : ''
    if (code === '23505') return false
    return failUnavailable()
  }
}

export async function updateRenewalCyclePostgres(
  pool: W07WebhookPostgresPool,
  cycle: RenewalCycleRow,
  updatedAt: string,
  assignments: string,
  values: unknown[],
): Promise<RenewalCycleRow | null> {
  const placeholders = (assignments.match(/\?/g) ?? []).length
  if (placeholders !== values.length) return failUnavailable()
  let next = 1
  const postgresAssignments = assignments.replace(/\?/g, () => `$${next++}`)
  try {
    const result = await pool.query<{ cycle_id: string } & Record<string, unknown>>(
      'UPDATE subscription_renewal_cycles SET ' + postgresAssignments +
      `, version = version + 1, updated_at = $${next}::timestamptz WHERE cycle_id = $${next + 1} AND version = $${next + 2} RETURNING cycle_id`,
      [...values, updatedAt, cycle.cycle_id, cycle.version],
    )
    // A CAS miss must not be reported as a successful update by returning the latest row.
    // Callers must treat null as a lost version race and re-read/reconcile explicitly.
    if (result.rows.length !== 1) return null
    return readRenewalCycleByIdPostgres(pool, cycle.cycle_id)
  } catch {
    return failUnavailable()
  }
}

export async function transitionRenewalCycleToPaymentReadyPostgres(
  pool: W07WebhookPostgresPool,
  cycle: RenewalCycleRow,
  updatedAt: string,
): Promise<RenewalCycleRow> {
  try {
    await pool.query(
      "UPDATE subscription_renewal_cycles SET state = 'PAYMENT_READY', outcome_code = NULL, " +
      'version = version + 1, updated_at = $1::timestamptz WHERE cycle_id = $2 AND version = $3 AND state = $4 ' +
      'AND order_id IS NOT NULL AND payment_id IS NOT NULL RETURNING cycle_id',
      [updatedAt, cycle.cycle_id, cycle.version, cycle.state],
    )
    const latest = await readRenewalCycleByIdPostgres(pool, cycle.cycle_id)
    if (!latest) return failUnavailable()
    return latest
  } catch {
    return failUnavailable()
  }
}

export async function acquireRenewalSubmissionLeasePostgres(
  pool: W07WebhookPostgresPool,
  cycle: RenewalCycleRow,
  leaseToken: string,
  leaseExpiresAt: string,
  updatedAt: string,
  now: string,
): Promise<RenewalCycleRow | null> {
  try {
    const result = await pool.query<{ cycle_id: string } & Record<string, unknown>>(
      "UPDATE subscription_renewal_cycles SET state = 'SUBMITTING', lease_token = $1, lease_expires_at = $2::timestamptz, " +
      'version = version + 1, updated_at = $3::timestamptz WHERE cycle_id = $4 AND version = $5 ' +
      "AND (state = 'PAYMENT_READY' OR (state = 'SUBMITTING' AND lease_expires_at <= $6::timestamptz)) RETURNING cycle_id",
      [leaseToken, leaseExpiresAt, updatedAt, cycle.cycle_id, cycle.version, now],
    )
    if (result.rows.length !== 1) return null
    return readRenewalCycleByIdPostgres(pool, cycle.cycle_id)
  } catch {
    return failUnavailable()
  }
}

export async function retryFailedRenewalCyclePostgres(
  pool: W07WebhookPostgresPool,
  cycle: RenewalCycleRow,
  updatedAt: string,
  retryCutoff: string,
  maxAttempts: number,
): Promise<boolean> {
  try {
    const result = await pool.query<{ cycle_id: string } & Record<string, unknown>>(
      "UPDATE subscription_renewal_cycles SET state = 'PREPARED', payment_id = NULL, " +
      "provider_response_status = NULL, outcome_code = 'RETRY_PREPARED', " +
      "subscription_sync_state = 'PENDING', subscription_sync_updated_at = NULL, subscription_sync_error_code = NULL, " +
      'lease_token = NULL, lease_expires_at = NULL, version = version + 1, updated_at = $1::timestamptz ' +
      "WHERE cycle_id = $2 AND version = $3 AND state = 'FAILED' AND subscription_sync_state = 'APPLIED' " +
      'AND attempt_number < $4 AND updated_at <= $5::timestamptz RETURNING cycle_id',
      [updatedAt, cycle.cycle_id, cycle.version, maxAttempts, retryCutoff],
    )
    return result.rows.length === 1
  } catch {
    return failUnavailable()
  }
}

export async function readRenewalSchedulerCursorPostgres(
  pool: W07WebhookPostgresPool,
): Promise<RenewalCursorRow | null> {
  try {
    const result = await pool.query<RenewalCursorRow & Record<string, unknown>>(
      `SELECT ${SCHEDULER_CURSOR_COLUMNS} FROM subscription_renewal_scheduler_state WHERE state_id = 'subscription-renewals' LIMIT 1`,
      [],
    )
    return result.rows[0] ?? null
  } catch {
    return failUnavailable()
  }
}

export async function writeRenewalSchedulerCursorPostgres(
  pool: W07WebhookPostgresPool,
  cursor: RenewalCursorRow,
  periodEnd: string | null,
  subscriptionId: string | null,
  updatedAt: string,
): Promise<boolean> {
  try {
    const result = await pool.query<{ state_id: string } & Record<string, unknown>>(
      "UPDATE subscription_renewal_scheduler_state SET cursor_period_end = $1::timestamptz, cursor_subscription_id = $2, " +
      "version = version + 1, updated_at = $3::timestamptz WHERE state_id = 'subscription-renewals' AND version = $4 RETURNING state_id",
      [periodEnd, subscriptionId, updatedAt, cursor.version],
    )
    return result.rows.length === 1
  } catch {
    return failUnavailable()
  }
}

export async function readRenewalCycleByPaymentPostgres(
  pool: W07WebhookPostgresPool,
  merchantId: string,
  paymentId: string,
): Promise<Pick<RenewalCycleRow, 'cycle_id'> | null> {
  try {
    const result = await pool.query<{ cycle_id: string } & Record<string, unknown>>(
      "SELECT cycle_id FROM subscription_renewal_cycles WHERE provider = 'hyperswitch' AND merchant_id = $1 AND payment_id = $2 LIMIT 1",
      [merchantId, paymentId],
    )
    return result.rows[0] ?? null
  } catch (error) {
    // Migration 0004 may not yet be applied in a deliberately isolated
    // non-renewal profile; preserve the regular-payment NO_RENEWAL_CYCLE path.
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : ''
    if (code === '42P01') return null
    return failUnavailable()
  }
}
export async function listPendingRenewalCycleIdsPostgres(
  pool: W07WebhookPostgresPool,
  limit: number,
): Promise<Array<Pick<RenewalCycleRow, 'cycle_id'>>> {
  try {
    const result = await pool.query<{ cycle_id: string } & Record<string, unknown>>(
      "SELECT cycle_id FROM subscription_renewal_cycles WHERE state IN ('SUCCEEDED','FAILED') " +
      "AND subscription_sync_state = 'PENDING' ORDER BY updated_at ASC, cycle_id ASC LIMIT $1",
      [limit],
    )
    return result.rows
  } catch {
    return failUnavailable()
  }
}

export async function markRenewalCycleSyncStatePostgres(
  pool: W07WebhookPostgresPool,
  cycle: RenewalCycleRow,
  nextState: 'APPLIED' | 'RECONCILIATION_REQUIRED',
  errorCode: string | null,
  syncUpdatedAt: string,
  updatedAt: string,
): Promise<boolean> {
  try {
    const result = await pool.query<{ cycle_id: string } & Record<string, unknown>>(
      'UPDATE subscription_renewal_cycles SET subscription_sync_state = $1, ' +
      'subscription_sync_updated_at = $2::timestamptz, subscription_sync_error_code = $3, ' +
      'version = version + 1, updated_at = $4::timestamptz ' +
      "WHERE cycle_id = $5 AND version = $6 AND state = $7 AND subscription_sync_state = 'PENDING' RETURNING cycle_id",
      [nextState, syncUpdatedAt, errorCode, updatedAt, cycle.cycle_id, cycle.version, cycle.state],
    )
    if (result.rows.length === 1) return true
    const latest = await readRenewalCycleByIdPostgres(pool, cycle.cycle_id)
    if (!latest) return failUnavailable()
    return latest.subscription_sync_state === nextState
  } catch {
    return failUnavailable()
  }
}
