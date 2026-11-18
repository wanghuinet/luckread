import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { SubscriptionRuntimeError } from './subscription-runtime.js'
import type { PlanChangeAttemptRow } from './subscription-plan-change-checkout.js'

function failUnavailable(): never {
  throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
}

const ATTEMPT_COLUMNS = `
  attempt_id, subscriber_id, subscription_id,
  expected_subscription_version, expected_plan_id, expected_plan_version,
  target_plan_id, target_plan_version,
  to_char(current_period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS current_period_start,
  to_char(current_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS current_period_end,
  idempotency_key_hash, order_id, status,
  to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at,
  CASE WHEN applied_at IS NULL THEN NULL ELSE
    to_char(applied_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS applied_at,
  applied_subscription_version,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at,
  version
`

export async function readPlanUpgradeAttemptByIdempotencyPostgres(
  pool: W07WebhookPostgresPool,
  subscriberId: string,
  keyHash: string,
): Promise<PlanChangeAttemptRow | null> {
  try {
    const result = await pool.query<PlanChangeAttemptRow & Record<string, unknown>>(
      `SELECT ${ATTEMPT_COLUMNS}
       FROM membership_subscription_plan_change_attempts
       WHERE subscriber_id = $1 AND idempotency_key_hash = $2
       LIMIT 1`,
      [subscriberId, keyHash],
    )
    return result.rows[0] ?? null
  } catch {
    return failUnavailable()
  }
}

export async function readPlanUpgradeAttemptByIdPostgres(
  pool: W07WebhookPostgresPool,
  attemptId: string,
): Promise<PlanChangeAttemptRow | null> {
  try {
    const result = await pool.query<PlanChangeAttemptRow & Record<string, unknown>>(
      `SELECT ${ATTEMPT_COLUMNS}
       FROM membership_subscription_plan_change_attempts
       WHERE attempt_id = $1
       LIMIT 1`,
      [attemptId],
    )
    return result.rows[0] ?? null
  } catch {
    return failUnavailable()
  }
}

export async function expirePlanUpgradeAttemptPostgres(
  pool: W07WebhookPostgresPool,
  row: PlanChangeAttemptRow,
  now: string,
): Promise<void> {
  try {
    await pool.query(
      "UPDATE membership_subscription_plan_change_attempts SET status = 'EXPIRED', " +
      'updated_at = $1::timestamptz, version = version + 1 WHERE attempt_id = $2 AND status = $3 AND version = $4',
      [now, row.attempt_id, row.status, row.version],
    )
  } catch {
    return failUnavailable()
  }
}

export async function expireStalePlanUpgradeAttemptsPostgres(
  pool: W07WebhookPostgresPool,
  subscriptionId: string,
  now: string,
): Promise<void> {
  try {
    await pool.query(
      "UPDATE membership_subscription_plan_change_attempts SET status = 'EXPIRED', " +
      'updated_at = $1::timestamptz, version = version + 1 ' +
      "WHERE subscription_id = $2 AND status = 'PENDING_PAYMENT' AND expires_at <= $1::timestamptz",
      [now, subscriptionId],
    )
  } catch {
    return failUnavailable()
  }
}

export type InsertPlanUpgradeAttemptInput = Readonly<{
  attemptId: string
  subscriberId: string
  subscriptionId: string
  expectedSubscriptionVersion: number
  expectedPlanId: string
  expectedPlanVersion: number
  targetPlanId: string
  targetPlanVersion: number
  currentPeriodStart: string
  currentPeriodEnd: string
  idempotencyKeyHash: string
  expiresAt: string
  createdAt: string
  updatedAt: string
}>

/**
 * Guarded native reservation insert. The reservation is accepted only while
 * the source subscription CAS/period and the creator-owned public target plan
 * still match, and while neither a paid upgrade nor a scheduled change is pending.
 */
export async function insertPlanUpgradeAttemptPostgres(
  pool: W07WebhookPostgresPool,
  input: InsertPlanUpgradeAttemptInput,
): Promise<boolean> {
  try {
    const result = await pool.query<{ attempt_id: string } & Record<string, unknown>>(
      'INSERT INTO membership_subscription_plan_change_attempts ' +
      '(attempt_id, subscriber_id, subscription_id, expected_subscription_version, expected_plan_id, ' +
      'expected_plan_version, target_plan_id, target_plan_version, current_period_start, current_period_end, ' +
      'idempotency_key_hash, order_id, status, expires_at, applied_at, applied_subscription_version, ' +
      'created_at, updated_at, version) ' +
      "SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11, NULL, 'PENDING_PAYMENT', " +
      '$12::timestamptz, NULL, NULL, $13::timestamptz, $14::timestamptz, 1 ' +
      'WHERE EXISTS (SELECT 1 FROM membership_subscriptions WHERE subscription_id = $15 AND subscriber_id = $16 ' +
      "AND status = 'ACTIVE' AND cancel_at IS NULL AND version = $17 AND plan_id = $18 AND plan_version = $19 " +
      'AND current_period_start = $20::timestamptz AND current_period_end = $21::timestamptz) ' +
      'AND EXISTS (SELECT 1 FROM membership_plans WHERE plan_id = $22 AND owner_type = \'CREATOR\' ' +
      'AND owner_id = (SELECT creator_id FROM membership_subscriptions WHERE subscription_id = $23 AND subscriber_id = $24) ' +
      "AND current_version = $25 AND status = 'ACTIVE' AND visibility = 'PUBLIC') " +
      "AND NOT EXISTS (SELECT 1 FROM membership_subscription_scheduled_plan_changes " +
      "WHERE subscription_id = $26 AND status IN ('SCHEDULED', 'RECONCILIATION_REQUIRED')) " +
      'RETURNING attempt_id',
      [
        input.attemptId, input.subscriberId, input.subscriptionId,
        input.expectedSubscriptionVersion, input.expectedPlanId, input.expectedPlanVersion,
        input.targetPlanId, input.targetPlanVersion, input.currentPeriodStart,
        input.currentPeriodEnd, input.idempotencyKeyHash, input.expiresAt,
        input.createdAt, input.updatedAt,
        input.subscriptionId, input.subscriberId, input.expectedSubscriptionVersion,
        input.expectedPlanId, input.expectedPlanVersion, input.currentPeriodStart,
        input.currentPeriodEnd, input.targetPlanId, input.subscriptionId,
        input.subscriberId, input.targetPlanVersion, input.subscriptionId,
      ],
    )
    return result.rows.length === 1
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : ''
    if (code === '23505') throw new SubscriptionRuntimeError('CONFLICT', 409)
    return failUnavailable()
  }
}

export async function attachPlanUpgradeOrderPostgres(
  pool: W07WebhookPostgresPool,
  attemptId: string,
  orderId: string,
  updatedAt: string,
): Promise<boolean> {
  try {
    const result = await pool.query<{ attempt_id: string } & Record<string, unknown>>(
      'UPDATE membership_subscription_plan_change_attempts SET order_id = $1, ' +
      'updated_at = $2::timestamptz, version = version + 1 ' +
      "WHERE attempt_id = $3 AND status = 'PENDING_PAYMENT' AND (order_id IS NULL OR order_id = $1) " +
      'RETURNING attempt_id',
      [orderId, updatedAt, attemptId],
    )
    return result.rows.length === 1
  } catch {
    return failUnavailable()
  }
}
