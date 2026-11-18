import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { SubscriptionRuntimeError } from './subscription-runtime.js'
import type {
  ScheduledSubscriptionPlanDowngrade,
  ScheduledSubscriptionPlanDowngradeResult,
} from './subscription-plan-change-schedule.js'

type ScheduledPlanChangePgRow = Readonly<{
  change_id: string
  subscriber_id: string
  subscription_id: string
  change_type: 'DOWNGRADE' | 'BILLING_INTERVAL_CHANGE'
  expected_subscription_version: number
  expected_plan_id: string
  expected_plan_version: number
  target_plan_id: string
  target_plan_version: number
  effective_at: string
  idempotency_key_hash: string
  status: 'SCHEDULED' | 'APPLIED' | 'CANCELLED' | 'RECONCILIATION_REQUIRED'
  applied_at: string | null
  applied_subscription_version: number | null
  created_at: string
  updated_at: string
  version: number
}>

type ScheduleTargetPlan = Readonly<{
  planId: string
  planVersion: number
  name: string
  tier: string
  billingInterval: 'MONTHLY' | 'YEARLY'
  priceMinor: number
  currency: string
  benefits: string[]
  creatorId: string
}>

type InsertScheduledPlanChangeInput = Readonly<{
  changeId: string
  subscriberId: string
  subscriptionId: string
  changeType: 'DOWNGRADE' | 'BILLING_INTERVAL_CHANGE'
  expectedVersion: number
  currentPlanId: string
  currentPlanVersion: number
  targetPlanId: string
  targetPlanVersion: number
  effectiveAt: string
  idempotencyKeyHash: string
  now: string
  currentPeriodStart: string
  currentPeriodEnd: string
}>

const CHANGE_ID_PATTERN = /^sudc_[a-f0-9]{64}$/
const PLAN_ID_PATTERN = /^plan_[a-f0-9]{64}$/

function failUnavailable(): never {
  throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
}

function isBoundedText(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
}

function isCanonicalUtc(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function toScheduledChange(row: ScheduledPlanChangePgRow): ScheduledSubscriptionPlanDowngrade {
  if (!CHANGE_ID_PATTERN.test(row.change_id) ||
      (row.change_type !== 'DOWNGRADE' && row.change_type !== 'BILLING_INTERVAL_CHANGE') ||
      !isBoundedText(row.subscriber_id) || !isBoundedText(row.subscription_id) ||
      !Number.isSafeInteger(row.expected_subscription_version) || row.expected_subscription_version < 1 ||
      !PLAN_ID_PATTERN.test(row.expected_plan_id) ||
      !Number.isSafeInteger(row.expected_plan_version) || row.expected_plan_version < 1 ||
      !PLAN_ID_PATTERN.test(row.target_plan_id) ||
      !Number.isSafeInteger(row.target_plan_version) || row.target_plan_version < 1 ||
      !isCanonicalUtc(row.effective_at) || !/^[a-f0-9]{64}$/.test(row.idempotency_key_hash) ||
      !['SCHEDULED', 'APPLIED', 'CANCELLED', 'RECONCILIATION_REQUIRED'].includes(row.status) ||
      !isCanonicalUtc(row.created_at) || !isCanonicalUtc(row.updated_at) ||
      !Number.isSafeInteger(row.version) || row.version < 1 ||
      !(row.applied_at === null || isCanonicalUtc(row.applied_at)) ||
      !(row.applied_subscription_version === null ||
        (Number.isSafeInteger(row.applied_subscription_version) && row.applied_subscription_version > 0))) {
    return failUnavailable()
  }
  return {
    changeId: row.change_id,
    subscriberId: row.subscriber_id,
    subscriptionId: row.subscription_id,
    changeType: row.change_type,
    expectedSubscriptionVersion: row.expected_subscription_version,
    expectedPlanId: row.expected_plan_id,
    expectedPlanVersion: row.expected_plan_version,
    targetPlanId: row.target_plan_id,
    targetPlanVersion: row.target_plan_version,
    effectiveAt: row.effective_at,
    status: row.status,
    appliedAt: row.applied_at,
    appliedSubscriptionVersion: row.applied_subscription_version,
  }
}

const SCHEDULED_CHANGE_COLUMNS = `
  change_id, subscriber_id, subscription_id, change_type,
  expected_subscription_version, expected_plan_id, expected_plan_version,
  target_plan_id, target_plan_version,
  to_char(effective_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS effective_at,
  idempotency_key_hash, status,
  CASE WHEN applied_at IS NULL THEN NULL ELSE
    to_char(applied_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS applied_at,
  applied_subscription_version,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at,
  version
`

export async function readScheduledChangeByIdempotencyPostgres(
  pool: W07WebhookPostgresPool,
  subscriberId: string,
  keyHash: string,
): Promise<ScheduledSubscriptionPlanDowngrade | null> {
  try {
    const result = await pool.query<ScheduledPlanChangePgRow & Record<string, unknown>>(
      `SELECT ${SCHEDULED_CHANGE_COLUMNS}
       FROM membership_subscription_scheduled_plan_changes
       WHERE subscriber_id = $1 AND idempotency_key_hash = $2
       LIMIT 1`,
      [subscriberId, keyHash],
    )
    return result.rows[0] ? toScheduledChange(result.rows[0]) : null
  } catch {
    return failUnavailable()
  }
}

export async function readScheduledSubscriptionPlanDowngradeForPeriodPostgres(
  pool: W07WebhookPostgresPool,
  subscriptionId: string,
  subscriberId: string,
  effectiveAt: string,
  includeApplied = true,
): Promise<ScheduledSubscriptionPlanDowngrade | null> {
  try {
    const result = await pool.query<ScheduledPlanChangePgRow & Record<string, unknown>>(
      `SELECT ${SCHEDULED_CHANGE_COLUMNS}
       FROM membership_subscription_scheduled_plan_changes
       WHERE subscription_id = $1 AND effective_at = $2::timestamptz
         AND subscriber_id = $3
         AND ${includeApplied ? "status IN ('SCHEDULED', 'APPLIED')" : "status = 'SCHEDULED'"}
       LIMIT 1`,
      [subscriptionId, effectiveAt, subscriberId],
    )
    const row = result.rows[0]
    if (!row) return null
    const change = toScheduledChange(row)
    if (change.subscriberId !== subscriberId || change.subscriptionId !== subscriptionId) {
      throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500)
    }
    return change
  } catch (error) {
    if (error instanceof SubscriptionRuntimeError) throw error
    return failUnavailable()
  }
}

export async function hasPendingScheduledPlanDowngradePostgres(
  pool: W07WebhookPostgresPool,
  subscriptionId: string,
): Promise<boolean> {
  try {
    const result = await pool.query<{ change_id: string } & Record<string, unknown>>(
      "SELECT change_id FROM membership_subscription_scheduled_plan_changes WHERE subscription_id = $1 " +
      "AND status IN ('SCHEDULED', 'RECONCILIATION_REQUIRED') LIMIT 1",
      [subscriptionId],
    )
    return result.rows.length > 0
  } catch {
    return failUnavailable()
  }
}

export async function readScheduledDowngradeTargetPlanPostgres(
  pool: W07WebhookPostgresPool,
  change: ScheduledSubscriptionPlanDowngrade,
): Promise<ScheduleTargetPlan | null> {
  let row: {
    plan_id: string
    plan_version: number
    owner_type: string
    owner_id: string
    name: string
    tier: string
    billing_interval: string
    price_minor: number
    currency: string
    benefits_json: string
  } | undefined
  try {
    const result = await pool.query<Record<string, unknown> & NonNullable<typeof row>>(
      'SELECT p.plan_id, v.plan_version, p.owner_type, p.owner_id, v.name, v.tier, ' +
      'v.billing_interval, v.price_minor, v.currency, v.benefits_json ' +
      'FROM membership_plans p INNER JOIN membership_plan_versions v ' +
      'ON v.plan_id = p.plan_id AND v.plan_version = $1 ' +
      'WHERE p.plan_id = $2 LIMIT 1',
      [change.targetPlanVersion, change.targetPlanId],
    )
    row = result.rows[0]
  } catch {
    return failUnavailable()
  }
  if (!row || row.plan_id !== change.targetPlanId || row.plan_version !== change.targetPlanVersion ||
      row.owner_type !== 'CREATOR' || !isBoundedText(row.owner_id) ||
      !PLAN_ID_PATTERN.test(row.plan_id) || !isBoundedText(row.name, 120) ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(row.tier) ||
      (row.billing_interval !== 'MONTHLY' && row.billing_interval !== 'YEARLY') ||
      !Number.isSafeInteger(row.price_minor) || row.price_minor < 0 ||
      !/^[A-Z]{3}$/.test(row.currency)) {
    return failUnavailable()
  }
  let benefits: unknown
  try {
    benefits = JSON.parse(row.benefits_json) as unknown
  } catch {
    return failUnavailable()
  }
  if (!Array.isArray(benefits) || benefits.length > 20 ||
      benefits.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 180) ||
      new Set(benefits).size !== benefits.length) {
    return failUnavailable()
  }
  return {
    planId: row.plan_id,
    planVersion: row.plan_version,
    name: row.name,
    tier: row.tier,
    billingInterval: row.billing_interval,
    priceMinor: row.price_minor,
    currency: row.currency,
    benefits: benefits as string[],
    creatorId: row.owner_id,
  }
}

export async function insertScheduledPlanChangePostgres(
  pool: W07WebhookPostgresPool,
  input: InsertScheduledPlanChangeInput,
): Promise<boolean> {
  try {
    const result = await pool.query<{ change_id: string } & Record<string, unknown>>(
      'INSERT INTO membership_subscription_scheduled_plan_changes ' +
      '(change_id, subscriber_id, subscription_id, change_type, expected_subscription_version, expected_plan_id, ' +
      'expected_plan_version, target_plan_id, target_plan_version, effective_at, idempotency_key_hash, ' +
      'status, applied_at, applied_subscription_version, created_at, updated_at, version) ' +
      "SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11, 'SCHEDULED', NULL, NULL, " +
      '$12::timestamptz, $13::timestamptz, 1 ' +
      'WHERE EXISTS (SELECT 1 FROM membership_subscriptions s WHERE s.subscription_id = $14 AND s.subscriber_id = $15 ' +
      "AND s.status = 'ACTIVE' AND s.cancel_at IS NULL AND s.version = $16 AND s.plan_id = $17 AND s.plan_version = $18 " +
      'AND s.current_period_start = $19::timestamptz AND s.current_period_end = $20::timestamptz) ' +
      "AND EXISTS (SELECT 1 FROM membership_plans p WHERE p.plan_id = $21 AND p.owner_type = 'CREATOR' " +
      'AND p.owner_id = (SELECT creator_id FROM membership_subscriptions WHERE subscription_id = $22 AND subscriber_id = $23) ' +
      "AND p.status = 'ACTIVE' AND p.visibility = 'PUBLIC') " +
      "AND NOT EXISTS (SELECT 1 FROM membership_subscription_plan_change_attempts a " +
      "WHERE a.subscription_id = $24 AND a.status IN ('PENDING_PAYMENT', 'RECONCILIATION_REQUIRED')) " +
      "AND NOT EXISTS (SELECT 1 FROM membership_subscription_scheduled_plan_changes c " +
      "WHERE c.subscription_id = $25 AND c.status IN ('SCHEDULED', 'RECONCILIATION_REQUIRED')) " +
      'RETURNING change_id',
      [
        input.changeId, input.subscriberId, input.subscriptionId, input.changeType,
        input.expectedVersion, input.currentPlanId, input.currentPlanVersion,
        input.targetPlanId, input.targetPlanVersion, input.effectiveAt,
        input.idempotencyKeyHash, input.now, input.now,
        input.subscriptionId, input.subscriberId, input.expectedVersion,
        input.currentPlanId, input.currentPlanVersion, input.currentPeriodStart,
        input.currentPeriodEnd, input.targetPlanId, input.subscriptionId,
        input.subscriberId, input.subscriptionId, input.subscriptionId,
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

export function scheduledPlanChangeResultFromRow(
  change: ScheduledSubscriptionPlanDowngrade,
  subscriptionId: string,
  replayed: boolean,
): ScheduledSubscriptionPlanDowngradeResult {
  if (change.subscriptionId !== subscriptionId) throw new SubscriptionRuntimeError('CONFLICT', 409)
  return {
    changeId: change.changeId,
    subscriptionId,
    status: change.status === 'APPLIED' ? 'APPLIED' : 'SCHEDULED',
    changeType: change.changeType,
    currentPlanId: change.expectedPlanId,
    targetPlanId: change.targetPlanId,
    targetPlanVersion: change.targetPlanVersion,
    effectiveAt: change.effectiveAt,
    replayed,
  }
}
