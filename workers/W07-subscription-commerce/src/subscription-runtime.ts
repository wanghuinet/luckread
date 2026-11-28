/// <reference types="@cloudflare/workers-types" />

import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js';
import type { W07WebhookPostgresClient, W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';

export type SubscriptionStatus = 'PENDING' | 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'PAUSING' | 'PAUSED' | 'CANCELED' | 'EXPIRED'

export type SubscriptionRow = {
  subscription_id: string
  subscriber_id: string
  plan_id: string
  plan_version: number
  creator_id: string | null
  status: SubscriptionStatus
  started_at: string
  current_period_start: string
  current_period_end: string
  trial_started_at: string | null
  trial_ends_at: string | null
  trial_converted_at: string | null
  cancel_at: string | null
  entitlement_snapshot_ref: string | null
  created_at: string
  updated_at: string
  version: number
}

export class SubscriptionRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
  }
}

const MAX_ID = 256
const MAX_IDEMPOTENCY_KEY = 256

export type ActiveMembershipPlanRow = {
  price_minor: number | null
  price_mode?: 'FIXED' | 'FLEXIBLE'
  minimum_price_minor?: number | null
  suggested_price_minor?: number | null
  maximum_price_minor?: number | null
  trial_period_days: number
  plan_id: string
  owner_id: string
  current_version: number
  created_at: string
  updated_at: string
  name: string
  tier: string
  billing_interval: string
  currency: string
  benefits_json: string
}

type PlanListCursor = { createdAt: string; planId: string }

const encodePlanListCursor = (cursor: PlanListCursor): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

const decodePlanListCursor = (value: string | null): PlanListCursor | null => {
  if (value === null) return null
  const normalized = value.trim()
  if (!normalized || normalized.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
  try {
    const base64 = normalized.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - normalized.length % 4) % 4)
    const binary = atob(base64)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid cursor shape')
    const candidate = parsed as Record<string, unknown>
    if (
      typeof candidate.createdAt !== 'string' ||
      candidate.createdAt.length > 64 ||
      !Number.isFinite(Date.parse(candidate.createdAt)) ||
      typeof candidate.planId !== 'string' ||
      candidate.planId.trim().length === 0 ||
      candidate.planId.length > MAX_ID
    ) throw new Error('invalid cursor fields')
    return { createdAt: candidate.createdAt, planId: candidate.planId }
  } catch {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
}

const ensureId = (value: string, code = 'VALIDATION_FAILED'): string => {
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_ID) {
    throw new SubscriptionRuntimeError(code, code === 'UNAUTHENTICATED' ? 401 : 400)
  }
  return normalized
}

export const validatePrincipal = (value: string): string => ensureId(value, 'UNAUTHENTICATED')

export const validateIdempotencyKey = (value: string | null): string => {
  const normalized = value?.trim() ?? ''
  if (!normalized || normalized.length > MAX_IDEMPOTENCY_KEY) {
    throw new SubscriptionRuntimeError('PRECONDITION_REQUIRED', 428)
  }
  return normalized
}

export const parseBoundedPositiveInt = (value: string | null, fallback: number, max: number): number => {
  if (value === null) return fallback
  if (!/^[1-9]\d*$/.test(value)) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > max) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  return parsed
}

export const validateIfMatch = (value: string | null): string => {
  const normalized = value?.trim() ?? ''
  if (!normalized || normalized.length > 256) {
    throw new SubscriptionRuntimeError('PRECONDITION_REQUIRED', 428)
  }
  if (normalized === '*') throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  return normalized
}

export const etagForVersion = (version: number): string => {
  if (!Number.isSafeInteger(version) || version < 1) throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500)
  return '"lr-v' + version + '"'
}

const versionFromEtag = (etag: string): number => {
  const match = /^"lr-v([1-9]\d*)"$/.exec(etag)
  if (!match?.[1]) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  const version = Number(match[1])
  if (!Number.isSafeInteger(version) || version < 1) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  return version
}

const nowIso = () => new Date().toISOString()

/** Calendar-accurate billing period arithmetic: month-end and leap-day dates clamp, never overflow. */
export function addBillingPeriod(start: string, interval: 'MONTHLY' | 'YEARLY'): string {
  const parsed = new Date(start)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== start ||
      (interval !== 'MONTHLY' && interval !== 'YEARLY')) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
  const year = parsed.getUTCFullYear() + (interval === 'YEARLY' ? 1 : 0)
  const month = parsed.getUTCMonth() + (interval === 'MONTHLY' ? 1 : 0)
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(
    year,
    month,
    Math.min(parsed.getUTCDate(), lastDay),
    parsed.getUTCHours(),
    parsed.getUTCMinutes(),
    parsed.getUTCSeconds(),
    parsed.getUTCMilliseconds(),
  )).toISOString()
}

const nextUpdatedAt = (previous: string): string => {
  const previousMs = Date.parse(previous)
  const nowMs = Date.now()
  const nextMs = Number.isFinite(previousMs) ? Math.max(nowMs, previousMs + 1) : nowMs
  return new Date(nextMs).toISOString()
}

const subscriptionIdFromIdempotency = async (subscriberId: string, idempotencyKey: string): Promise<string> => {
  // Preserve existing deterministic IDs for accepted inputs, but reject values
  // containing the legacy delimiter so a component cannot impersonate a boundary.
  if (subscriberId.includes('\\0') || idempotencyKey.includes('\\0')) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
  const material = new TextEncoder().encode('subscription-create\\0' + subscriberId + '\\0' + idempotencyKey)
  try {
    return 'sub_' + await sha256BytesToHex(material)
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

const toPublic = (row: SubscriptionRow) => ({
  subscriptionId: row.subscription_id,
  subscriberId: row.subscriber_id,
  planId: row.plan_id,
  planVersion: row.plan_version,
  creatorId: row.creator_id,
  status: row.status,
  startedAt: row.started_at,
  currentPeriodStart: row.current_period_start,
  currentPeriodEnd: row.current_period_end,
  trialStartedAt: row.trial_started_at,
  trialEndsAt: row.trial_ends_at,
  trialConvertedAt: row.trial_converted_at,
  cancelAt: row.cancel_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  version: row.version,
  etag: etagForVersion(row.version),
})

const SUBSCRIPTION_READ_COLUMNS =
  'subscription_id, subscriber_id, plan_id, plan_version, creator_id, status, ' +
  `to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS started_at, ` +
  `to_char(current_period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS current_period_start, ` +
  `to_char(current_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS current_period_end, ` +
  `CASE WHEN trial_started_at IS NULL THEN NULL ELSE to_char(trial_started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS trial_started_at, ` +
  `CASE WHEN trial_ends_at IS NULL THEN NULL ELSE to_char(trial_ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS trial_ends_at, ` +
  `CASE WHEN trial_converted_at IS NULL THEN NULL ELSE to_char(trial_converted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS trial_converted_at, ` +
  `CASE WHEN cancel_at IS NULL THEN NULL ELSE to_char(cancel_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS cancel_at, ` +
  'entitlement_snapshot_ref, ' +
  `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at, ` +
  `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at, version`;

const readSubscriptionRow = async (
  db: W07WebhookPostgresPool,
  subscriptionId: string,
  subscriberId?: string,
): Promise<SubscriptionRow> => {
  const id = ensureId(subscriptionId);
  const values = subscriberId === undefined ? [id] : [id, ensureId(subscriberId)];
  try {
    const result = await db.query<SubscriptionRow & Record<string, unknown>>(
      `SELECT ${SUBSCRIPTION_READ_COLUMNS} FROM membership_subscriptions ` +
      (subscriberId === undefined
        ? 'WHERE subscription_id = $1 LIMIT 1'
        : 'WHERE subscription_id = $1 AND subscriber_id = $2 LIMIT 1'),
      values,
    );
    const row = result.rows[0] ?? null;
    if (!row) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
    return row;
  } catch (error) {
    if (error instanceof SubscriptionRuntimeError) throw error;
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
};

export async function getSubscription(
  db: W07WebhookPostgresPool,
  subscriberId: string,
  subscriptionId: string,
): Promise<ReturnType<typeof toPublic>> {
  return toPublic(await readSubscriptionRow(db, subscriptionId, validatePrincipal(subscriberId)));
}


/**
 * Read-only creator membership check for W03 content authorization.
 * Subscription/access state remains in D1-01; W03 receives only a boolean
 * decision and never reads or persists membership rows.
 */
export async function hasActiveCreatorMembership(
  db: W07WebhookPostgresPool,
  subscriberIdInput: string,
  creatorIdInput: string,
  now = new Date(),
): Promise<boolean> {
  const subscriberId = validatePrincipal(subscriberIdInput);
  const creatorId = ensureId(creatorIdInput);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  const nowValue = now.toISOString();
  try {
    const result = await db.query<{ subscription_id: string } & Record<string, unknown>>(
      "SELECT subscription_id FROM membership_subscriptions " +
      "WHERE subscriber_id = $1 AND creator_id = $2 AND status IN ('ACTIVE','TRIALING') " +
      "AND current_period_start <= $3::timestamptz AND current_period_end > $4::timestamptz " +
      "AND (cancel_at IS NULL OR cancel_at > $5::timestamptz) " +
      "ORDER BY current_period_end DESC, subscription_id ASC LIMIT 1",
      [subscriberId, creatorId, nowValue, nowValue, nowValue],
    );
    const row = result.rows[0];
    return row !== undefined && typeof row.subscription_id === 'string' && row.subscription_id.length > 0;
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

export async function listSubscriptions(
  db: W07WebhookPostgresPool,
  subscriberId: string,
  limit = 20,
  page = 1,
): Promise<{
  docs: ReturnType<typeof toPublic>[];
  limit: number;
  page: number;
  hasNextPage: boolean;
}> {
  const subscriber = validatePrincipal(subscriberId);
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 50) : 20;
  const safePage = Number.isFinite(page) ? Math.min(Math.max(Math.trunc(page), 1), 10000) : 1;
  const offset = (safePage - 1) * safeLimit;
  try {
    const result = await db.query<SubscriptionRow & Record<string, unknown>>(
      `SELECT ${SUBSCRIPTION_READ_COLUMNS} FROM membership_subscriptions ` +
      'WHERE subscriber_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [subscriber, safeLimit + 1, offset],
    );
    const docs = result.rows.slice(0, safeLimit).map(toPublic);
    return { docs, limit: safeLimit, page: safePage, hasNextPage: result.rows.length > safeLimit };
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

export async function listActiveMembershipPlans(
  db: W07WebhookPostgresPool,
  limit = 20,
  cursorValue: string | null = null,
  creatorIdInput: string | null = null,
): Promise<{
  docs: Array<{
    planId: string;
    creatorId: string;
    planVersion: number;
    name: string;
    tier: string;
    billingInterval: string;
    priceMinor: number | null;
    priceMode: 'FIXED' | 'FLEXIBLE';
    minimumPriceMinor: number | null;
    suggestedPriceMinor: number | null;
    maximumPriceMinor: number | null;
    currency: string;
    trialPeriodDays: number;
    benefits: unknown;
    createdAt: string;
    updatedAt: string;
  }>;
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const safeLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 20;
  const cursor = decodePlanListCursor(cursorValue);
  const creatorId = creatorIdInput === null ? null : ensureId(creatorIdInput);
  let sql =
    'SELECT p.plan_id, p.owner_id, p.current_version, ' +
    `to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at, ` +
    `to_char(p.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at, ` +
    'v.name, v.tier, v.billing_interval, v.price_minor, v.price_mode, v.minimum_price_minor, v.suggested_price_minor, v.maximum_price_minor, v.currency, v.benefits_json, v.trial_period_days ' +
    'FROM membership_plans AS p ' +
    'INNER JOIN membership_plan_versions AS v ON v.plan_id = p.plan_id AND v.plan_version = p.current_version ' +
    "WHERE p.owner_type = 'CREATOR' AND p.status = 'ACTIVE' AND p.visibility = 'PUBLIC' ";
  const values: unknown[] = [];
  if (creatorId) {
    values.push(creatorId);
    sql += `AND p.owner_id = $${values.length} `;
  }
  if (cursor) {
    values.push(cursor.createdAt, cursor.createdAt, cursor.planId);
    sql += `AND (p.created_at < $${values.length - 2}::timestamptz OR ` +
      `(p.created_at = $${values.length - 1}::timestamptz AND p.plan_id < $${values.length})) `;
  }
  values.push(safeLimit + 1);
  sql += `ORDER BY p.created_at DESC, p.plan_id DESC LIMIT $${values.length}`;
  let candidates: ActiveMembershipPlanRow[];
  try {
    const result = await db.query<ActiveMembershipPlanRow & Record<string, unknown>>(sql, values);
    candidates = result.rows;
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }

  const hasMore = candidates.length > safeLimit;
  const page = candidates.slice(0, safeLimit);
  const docs = page.map((row) => {
    const trialPeriodDays = row.trial_period_days === undefined || row.trial_period_days === null ? 0 : row.trial_period_days;
    let benefits: unknown;
    try {
      benefits = JSON.parse(row.benefits_json) as unknown;
    } catch {
      throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
    }
    if (
      !Array.isArray(benefits) ||
      benefits.length > 20 ||
      benefits.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 180) ||
      new Set(benefits).size !== benefits.length ||
      row.benefits_json.length > 8192
    ) {
      throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
    }
    if (
      !Number.isSafeInteger(row.current_version) || row.current_version < 1 ||
      ((row.price_mode ?? 'FIXED') === 'FIXED' && (!Number.isSafeInteger(row.price_minor) || (row.price_minor as number) < 0 || (row.price_minor as number) > 2_147_483_647)) ||
      ((row.price_mode ?? 'FIXED') === 'FLEXIBLE' && (row.price_minor !== null || !Number.isSafeInteger(row.minimum_price_minor) || (row.minimum_price_minor as number) < 1 || !Number.isSafeInteger(row.suggested_price_minor) || (row.suggested_price_minor as number) < (row.minimum_price_minor as number) || !Number.isSafeInteger(row.maximum_price_minor) || (row.maximum_price_minor as number) < (row.suggested_price_minor as number) || (row.maximum_price_minor as number) > 2_147_483_647)) ||
      !['FIXED', 'FLEXIBLE'].includes(row.price_mode ?? 'FIXED') ||
      !/^[A-Z]{3}$/.test(row.currency) ||
      !Number.isSafeInteger(trialPeriodDays) || trialPeriodDays < 0 || trialPeriodDays > 30 ||
      (row.billing_interval !== 'MONTHLY' && row.billing_interval !== 'YEARLY') ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(row.tier) ||
      typeof row.name !== 'string' || row.name.trim().length < 1 || row.name.length > 120
    ) {
      throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
    }
    return {
      planId: row.plan_id,
      creatorId: row.owner_id,
      planVersion: row.current_version,
      name: row.name,
      tier: row.tier,
      billingInterval: row.billing_interval,
      priceMinor: row.price_minor,
      priceMode: row.price_mode ?? 'FIXED',
      minimumPriceMinor: row.minimum_price_minor ?? null,
      suggestedPriceMinor: row.suggested_price_minor ?? null,
      maximumPriceMinor: row.maximum_price_minor ?? null,
      currency: row.currency,
      trialPeriodDays,
      benefits,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
  const last = page.at(-1);
  return {
    docs,
    limit: safeLimit,
    hasMore,
    nextCursor: hasMore && last ? encodePlanListCursor({ createdAt: last.created_at, planId: last.plan_id }) : null,
  };
}

export type MembershipPlanDraftInput = {
  name: string
  tier: string
  billingInterval: 'MONTHLY' | 'YEARLY'
  priceMode: 'FIXED' | 'FLEXIBLE'
  priceMinor: number | null
  minimumPriceMinor: number | null
  suggestedPriceMinor: number | null
  maximumPriceMinor: number | null
  currency: string
  benefits: string[]
  trialPeriodDays: number
}

async function readOwnedMembershipPlanPostgres(
  pool: W07WebhookPostgresPool,
  planId: string,
  creatorId: string,
): Promise<MembershipPlanStoredRow | null> {
  try {
    const result = await pool.query<MembershipPlanStoredRow & Record<string, unknown>>(
      'SELECT p.plan_id, p.owner_id, p.current_version, p.status, p.visibility, p.version, ' +
      `to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at, ` +
      `to_char(p.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at, ` +
      'v.name, v.tier, v.billing_interval, v.price_minor, v.price_mode, v.minimum_price_minor, v.suggested_price_minor, v.maximum_price_minor, v.currency, v.benefits_json, v.trial_period_days ' +
      'FROM membership_plans AS p INNER JOIN membership_plan_versions AS v ' +
      'ON v.plan_id = p.plan_id AND v.plan_version = p.current_version ' +
      "WHERE p.plan_id = $1 AND p.owner_type = 'CREATOR' AND p.owner_id = $2 LIMIT 1",
      [planId, creatorId],
    )
    return result.rows[0] ?? null
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

type MembershipPlanRevisionWriteInput = Readonly<{
  planId: string
  creatorId: string
  currentPlanVersion: number
  expectedVersion: number
  nextPlanVersion: number
  revision: MembershipPlanDraftInput
  benefitsJson: string
  updatedAt: string
}>

async function reviseMembershipPlanPostgres(
  pool: W07WebhookPostgresPool,
  input: MembershipPlanRevisionWriteInput,
): Promise<boolean> {
  let client: W07WebhookPostgresClient | undefined
  let inTransaction = false
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    inTransaction = true
    const inserted = await client.query<{ plan_id: string } & Record<string, unknown>>(
      'INSERT INTO membership_plan_versions ' +
      '(plan_id, plan_version, name, tier, billing_interval, price_minor, price_mode, minimum_price_minor, suggested_price_minor, maximum_price_minor, currency, benefits_json, trial_period_days, created_at) ' +
      'SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::timestamptz WHERE EXISTS (' +
      "SELECT 1 FROM membership_plans p WHERE p.plan_id = $15 AND p.owner_type = 'CREATOR' AND p.owner_id = $16 " +
      "AND p.status IN ('DRAFT','ACTIVE','PAUSED') AND p.current_version = $17 AND p.version = $18) " +
      'ON CONFLICT (plan_id, plan_version) DO NOTHING RETURNING plan_id',
      [
        input.planId, input.nextPlanVersion, input.revision.name, input.revision.tier,
        input.revision.billingInterval, input.revision.priceMinor, input.revision.priceMode,
        input.revision.minimumPriceMinor, input.revision.suggestedPriceMinor, input.revision.maximumPriceMinor,
        input.revision.currency, input.benefitsJson, input.revision.trialPeriodDays, input.updatedAt,
        input.planId, input.creatorId, input.currentPlanVersion, input.expectedVersion,
      ],
    )
    if (inserted.rows.length !== 1) {
      await client.query('ROLLBACK')
      inTransaction = false
      return false
    }
    const updated = await client.query<{ plan_id: string } & Record<string, unknown>>(
      'UPDATE membership_plans SET current_version = $1, updated_at = $2::timestamptz, version = version + 1 ' +
      "WHERE plan_id = $3 AND owner_type = 'CREATOR' AND owner_id = $4 " +
      "AND status IN ('DRAFT','ACTIVE','PAUSED') AND current_version = $5 AND version = $6 " +
      'AND EXISTS (SELECT 1 FROM membership_plan_versions v WHERE v.plan_id = membership_plans.plan_id ' +
      'AND v.plan_version = $7 AND v.name = $8 AND v.tier = $9 AND v.billing_interval = $10 ' +
      'AND v.price_minor IS NOT DISTINCT FROM $11 AND v.price_mode = $12 ' +
      'AND v.minimum_price_minor IS NOT DISTINCT FROM $13 AND v.suggested_price_minor IS NOT DISTINCT FROM $14 ' +
      'AND v.maximum_price_minor IS NOT DISTINCT FROM $15 AND v.currency = $16 ' +
      'AND v.benefits_json = $17 AND v.trial_period_days = $18) ' +
      'RETURNING plan_id',
      [
        input.nextPlanVersion, input.updatedAt, input.planId, input.creatorId,
        input.currentPlanVersion, input.expectedVersion, input.nextPlanVersion,
        input.revision.name, input.revision.tier, input.revision.billingInterval,
        input.revision.priceMinor, input.revision.priceMode, input.revision.minimumPriceMinor,
        input.revision.suggestedPriceMinor, input.revision.maximumPriceMinor, input.revision.currency,
        input.benefitsJson, input.revision.trialPeriodDays,
      ],
    )
    if (updated.rows.length !== 1) {
      await client.query('ROLLBACK')
      inTransaction = false
      return false
    }
    await client.query('COMMIT')
    inTransaction = false
    return true
  } catch {
    if (client && inTransaction) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Do not expose database diagnostics.
      }
    }
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  } finally {
    client?.release()
  }
}

type MembershipPlanStoredRow = {
  plan_id: string
  owner_id: string
  current_version: number
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'RETIRED'
  visibility: 'PRIVATE' | 'PUBLIC'
  version: number
  created_at: string
  updated_at: string
  name: string
  tier: string
  billing_interval: string
  price_minor: number | null
  price_mode?: 'FIXED' | 'FLEXIBLE'
  minimum_price_minor?: number | null
  suggested_price_minor?: number | null
  maximum_price_minor?: number | null
  currency: string
  benefits_json: string
  trial_period_days: number
}

const canonicalBenefitsJson = (benefits: string[]): string => JSON.stringify(benefits)

export function normalizeMembershipPlanDraft(value: unknown, defaultTrialPeriodDays = 0): MembershipPlanDraftInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
  const source = value as Record<string, unknown>
  const allowedKeys = new Set([
    'name', 'tier', 'billingInterval', 'priceMode', 'priceMinor',
    'minimumPriceMinor', 'suggestedPriceMinor', 'maximumPriceMinor',
    'currency', 'benefits', 'trialPeriodDays',
  ])
  if (Object.keys(source).some((key) => !allowedKeys.has(key))) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }

  const name = typeof source.name === 'string' ? source.name.trim() : ''
  const tier = typeof source.tier === 'string' ? source.tier.trim() : ''
  const billingInterval = typeof source.billingInterval === 'string' ? source.billingInterval.trim() : ''
  const currency = typeof source.currency === 'string' ? source.currency.trim() : ''
  const priceMode = source.priceMode === undefined ? 'FIXED' : source.priceMode
  const priceMinor = source.priceMinor
  const minimumPriceMinor = source.minimumPriceMinor
  const suggestedPriceMinor = source.suggestedPriceMinor
  const maximumPriceMinor = source.maximumPriceMinor
  const rawBenefits = source.benefits
  const trialPeriodDays = source.trialPeriodDays === undefined ? defaultTrialPeriodDays : source.trialPeriodDays

  if (name.length < 1 || name.length > 120) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(tier)) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  if (billingInterval !== 'MONTHLY' && billingInterval !== 'YEARLY') throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  if (!/^[A-Z]{3}$/.test(currency)) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  if (priceMode !== 'FIXED' && priceMode !== 'FLEXIBLE') {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
  if (priceMode === 'FIXED') {
    if (typeof priceMinor !== 'number' || !Number.isSafeInteger(priceMinor) || priceMinor < 0 || priceMinor > 2_147_483_647 ||
        minimumPriceMinor !== undefined || suggestedPriceMinor !== undefined || maximumPriceMinor !== undefined) {
      throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
    }
  } else if (
    (priceMinor !== undefined && priceMinor !== null) ||
    typeof minimumPriceMinor !== 'number' || !Number.isSafeInteger(minimumPriceMinor) || minimumPriceMinor < 1 ||
    typeof suggestedPriceMinor !== 'number' || !Number.isSafeInteger(suggestedPriceMinor) ||
    suggestedPriceMinor < minimumPriceMinor ||
    typeof maximumPriceMinor !== 'number' || !Number.isSafeInteger(maximumPriceMinor) ||
    maximumPriceMinor < suggestedPriceMinor || maximumPriceMinor > 2_147_483_647
  ) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
  if (typeof trialPeriodDays !== 'number' || !Number.isSafeInteger(trialPeriodDays) || trialPeriodDays < 0 || trialPeriodDays > 30) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!Array.isArray(rawBenefits) || rawBenefits.length > 20 ||
    rawBenefits.some((item) => typeof item !== 'string' || item.trim().length < 1 || item.trim().length > 180)) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
  const benefits = rawBenefits.map((item) => (item as string).trim())
  if (new Set(benefits).size !== benefits.length || canonicalBenefitsJson(benefits).length > 8192) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }

  return {
    name, tier, billingInterval, priceMode,
    priceMinor: priceMode === 'FIXED' ? priceMinor as number : null,
    minimumPriceMinor: priceMode === 'FLEXIBLE' ? minimumPriceMinor as number : null,
    suggestedPriceMinor: priceMode === 'FLEXIBLE' ? suggestedPriceMinor as number : null,
    maximumPriceMinor: priceMode === 'FLEXIBLE' ? maximumPriceMinor as number : null,
    currency, benefits, trialPeriodDays,
  }
}

const membershipPlanIdFromIdempotency = async (creatorId: string, idempotencyKey: string): Promise<string> => {
  const material = new TextEncoder().encode('membership-plan-create\u0000' + creatorId + '\u0000' + idempotencyKey)
  const digest = await crypto.subtle.digest('SHA-256', material)
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return 'plan_' + hex
}

const mapMembershipPlan = (row: MembershipPlanStoredRow, replayed?: boolean) => {
  const trialPeriodDays = row.trial_period_days === undefined || row.trial_period_days === null ? 0 : row.trial_period_days;
  let benefits: unknown
  try {
    benefits = JSON.parse(row.benefits_json) as unknown
  } catch {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500)
  }
  if (
    !Array.isArray(benefits) ||
    benefits.length > 20 ||
    benefits.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 180) ||
    new Set(benefits).size !== benefits.length ||
    row.benefits_json.length > 8192 ||
    !Number.isSafeInteger(row.current_version) || row.current_version < 1 ||
    !Number.isSafeInteger(row.version) || row.version < 1 ||
    ((row.price_mode ?? 'FIXED') === 'FIXED' && (!Number.isSafeInteger(row.price_minor) || (row.price_minor as number) < 0 || (row.price_minor as number) > 2_147_483_647)) ||
    ((row.price_mode ?? 'FIXED') === 'FLEXIBLE' && (row.price_minor !== null || !Number.isSafeInteger(row.minimum_price_minor) || (row.minimum_price_minor as number) < 1 || !Number.isSafeInteger(row.suggested_price_minor) || (row.suggested_price_minor as number) < (row.minimum_price_minor as number) || !Number.isSafeInteger(row.maximum_price_minor) || (row.maximum_price_minor as number) < (row.suggested_price_minor as number) || (row.maximum_price_minor as number) > 2_147_483_647)) ||
    !['FIXED', 'FLEXIBLE'].includes(row.price_mode ?? 'FIXED') ||
    !/^[A-Z]{3}$/.test(row.currency) ||
    !Number.isSafeInteger(trialPeriodDays) || trialPeriodDays < 0 || trialPeriodDays > 30 ||
    (row.billing_interval !== 'MONTHLY' && row.billing_interval !== 'YEARLY') ||
    !/^[a-z][a-z0-9_-]{0,63}$/.test(row.tier) ||
    typeof row.name !== 'string' || row.name.trim().length < 1 || row.name.length > 120
  ) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500)
  }
  return {
    planId: row.plan_id,
    creatorId: row.owner_id,
    planVersion: row.current_version,
    name: row.name,
    tier: row.tier,
    billingInterval: row.billing_interval,
    priceMinor: row.price_minor,
    priceMode: row.price_mode ?? 'FIXED',
    minimumPriceMinor: row.minimum_price_minor ?? null,
    suggestedPriceMinor: row.suggested_price_minor ?? null,
    maximumPriceMinor: row.maximum_price_minor ?? null,
    currency: row.currency,
    benefits,
    trialPeriodDays,
    status: row.status,
    visibility: row.visibility,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    etag: '"lr-plan-v' + row.version + '"',
    ...(replayed === undefined ? {} : { replayed }),
  }
}

/**
 * Creates a private DRAFT under the creator ID resolved by W08. Plan IDs are
 * deterministic per creator/idempotency key; the immutable v1 record lets a
 * replay detect key reuse with a different request even after later edits.
 */
async function readMembershipPlanDraftByIdPostgres(
  pool: W07WebhookPostgresPool,
  planId: string,
): Promise<MembershipPlanStoredRow | null> {
  try {
    const result = await pool.query<MembershipPlanStoredRow & Record<string, unknown>>(
      'SELECT p.plan_id, p.owner_id, p.current_version, p.status, p.visibility, p.version, ' +
      `to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at, ` +
      `to_char(p.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at, ` +
      'v.name, v.tier, v.billing_interval, v.price_minor, v.price_mode, v.minimum_price_minor, v.suggested_price_minor, v.maximum_price_minor, v.currency, v.benefits_json, v.trial_period_days ' +
      'FROM membership_plans AS p INNER JOIN membership_plan_versions AS v ' +
      'ON v.plan_id = p.plan_id AND v.plan_version = 1 WHERE p.plan_id = $1 LIMIT 1',
      [planId],
    )
    return result.rows[0] ?? null
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

function membershipPlanDraftMatches(
  row: MembershipPlanStoredRow,
  creatorId: string,
  plan: MembershipPlanDraftInput,
  benefitsJson: string,
): boolean {
  return row.owner_id === creatorId &&
    row.name === plan.name &&
    row.tier === plan.tier &&
    row.billing_interval === plan.billingInterval &&
    row.price_minor === plan.priceMinor &&
    (row.price_mode ?? 'FIXED') === plan.priceMode &&
    (row.minimum_price_minor ?? null) === plan.minimumPriceMinor &&
    (row.suggested_price_minor ?? null) === plan.suggestedPriceMinor &&
    (row.maximum_price_minor ?? null) === plan.maximumPriceMinor &&
    row.currency === plan.currency &&
    row.benefits_json === benefitsJson &&
    (row.trial_period_days ?? 0) === plan.trialPeriodDays
}

function replayMembershipPlanDraft(row: MembershipPlanStoredRow): ReturnType<typeof mapMembershipPlan> {
  // Return the immutable original create result, not current mutable plan state.
  return mapMembershipPlan({
    ...row,
    current_version: 1,
    status: 'DRAFT',
    visibility: 'PRIVATE',
    version: 1,
    updated_at: row.created_at,
  }, true)
}

async function insertMembershipPlanDraftPostgres(
  pool: W07WebhookPostgresPool,
  input: Readonly<{
    planId: string
    creatorId: string
    plan: MembershipPlanDraftInput
    benefitsJson: string
    now: string
  }>,
): Promise<boolean> {
  let client: W07WebhookPostgresClient | undefined
  let inTransaction = false
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    inTransaction = true
    const planInsert = await client.query<{ plan_id: string } & Record<string, unknown>>(
      "INSERT INTO membership_plans " +
      '(plan_id, owner_type, owner_id, current_version, status, visibility, version, created_at, updated_at) ' +
      "VALUES ($1, 'CREATOR', $2, 1, 'DRAFT', 'PRIVATE', 1, $3::timestamptz, $4::timestamptz) " +
      'ON CONFLICT (plan_id) DO NOTHING RETURNING plan_id',
      [input.planId, input.creatorId, input.now, input.now],
    )
    if (planInsert.rows.length !== 1) {
      await client.query('ROLLBACK')
      inTransaction = false
      return false
    }
    const versionInsert = await client.query<{ plan_id: string } & Record<string, unknown>>(
      'INSERT INTO membership_plan_versions ' +
      '(plan_id, plan_version, name, tier, billing_interval, price_minor, price_mode, minimum_price_minor, suggested_price_minor, maximum_price_minor, currency, benefits_json, trial_period_days, created_at) ' +
      'VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz) ' +
      'ON CONFLICT (plan_id, plan_version) DO NOTHING RETURNING plan_id',
      [
        input.planId, input.plan.name, input.plan.tier, input.plan.billingInterval,
        input.plan.priceMinor, input.plan.priceMode, input.plan.minimumPriceMinor,
        input.plan.suggestedPriceMinor, input.plan.maximumPriceMinor, input.plan.currency,
        input.benefitsJson, input.plan.trialPeriodDays, input.now,
      ],
    )
    if (versionInsert.rows.length !== 1) {
      await client.query('ROLLBACK')
      inTransaction = false
      return false
    }
    await client.query('COMMIT')
    inTransaction = false
    return true
  } catch {
    if (client && inTransaction) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Keep database diagnostics private and preserve the sanitized error.
      }
    }
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  } finally {
    client?.release()
  }
}

/**
 * Creates a private DRAFT under the creator ID resolved by W08. Plan IDs are
 * deterministic per creator/idempotency key; the immutable v1 record lets a
 * replay detect key reuse with a different request even after later edits.
 */
export async function createMembershipPlanDraft(
  db: W07WebhookPostgresPool,
  actorUserId: string,
  verifiedCreatorId: string,
  input: unknown,
  key: string | null,
): Promise<ReturnType<typeof mapMembershipPlan>> {
  const actor = validatePrincipal(actorUserId);
  const creatorId = validatePrincipal(verifiedCreatorId);
  const idempotencyKey = validateIdempotencyKey(key);
  const plan = normalizeMembershipPlanDraft(input);
  const planId = await membershipPlanIdFromIdempotency(creatorId, idempotencyKey);
  const benefitsJson = canonicalBenefitsJson(plan.benefits);

  const existing = await readMembershipPlanDraftByIdPostgres(db, planId);
  if (existing) {
    if (!membershipPlanDraftMatches(existing, creatorId, plan, benefitsJson)) {
      throw new SubscriptionRuntimeError('CONFLICT', 409);
    }
    return replayMembershipPlanDraft(existing);
  }

  const now = nowIso();
  const inserted = await insertMembershipPlanDraftPostgres(db, {
    planId, creatorId, plan, benefitsJson, now,
  });
  if (!inserted) {
    const raced = await readMembershipPlanDraftByIdPostgres(db, planId);
    if (!raced || !membershipPlanDraftMatches(raced, creatorId, plan, benefitsJson)) {
      throw new SubscriptionRuntimeError('CONFLICT', 409);
    }
    return replayMembershipPlanDraft(raced);
  }

  console.log(JSON.stringify({
    event: 'membership.plan.draft.created',
    operation: 'createMembershipPlanDraft',
    planId,
    creatorId,
    actorUserId: actor,
  }));
  return {
    planId,
    creatorId,
    planVersion: 1,
    name: plan.name,
    tier: plan.tier,
    billingInterval: plan.billingInterval,
    priceMinor: plan.priceMinor,
    priceMode: plan.priceMode,
    minimumPriceMinor: plan.minimumPriceMinor,
    suggestedPriceMinor: plan.suggestedPriceMinor,
    maximumPriceMinor: plan.maximumPriceMinor,
    currency: plan.currency,
    benefits: plan.benefits,
    trialPeriodDays: plan.trialPeriodDays,
    status: 'DRAFT',
    visibility: 'PRIVATE',
    version: 1,
    createdAt: now,
    updatedAt: now,
    etag: '"lr-plan-v1"',
    replayed: false,
  };
}

const planVersionFromEtag = (etag: string): number => {
  const match = /^"lr-plan-v([1-9]\d*)"$/.exec(etag)
  if (!match?.[1]) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  const version = Number(match[1])
  if (!Number.isSafeInteger(version) || version < 1) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  return version
}

/**
 * Publish an owner's plan draft using an optimistic version precondition.
 * Publishing only changes the existing D1-01 MembershipPlan lifecycle; it
 * does not create a subscription, order, payment, or entitlement.
 */
export async function publishMembershipPlan(
  db: W07WebhookPostgresPool,
  verifiedCreatorId: string,
  planIdInput: string,
  ifMatchInput: string | null,
): Promise<ReturnType<typeof mapMembershipPlan>> {
  const creatorId = validatePrincipal(verifiedCreatorId);
  const planId = ensureId(planIdInput);
  const expectedVersion = planVersionFromEtag(validateIfMatch(ifMatchInput));
  const readOwnedPlan = () => readOwnedMembershipPlanPostgres(db, planId, creatorId);
  const current = await readOwnedPlan();
  if (!current) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);

  if (current.version !== expectedVersion) {
    if (current.status === 'ACTIVE' && current.visibility === 'PUBLIC' &&
        current.version === expectedVersion + 1) return mapMembershipPlan(current, true);
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  }
  if (current.status === 'ACTIVE' && current.visibility === 'PUBLIC') return mapMembershipPlan(current, true);
  if (current.status !== 'DRAFT' || current.visibility !== 'PRIVATE') {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }

  const updatedAt = nextUpdatedAt(current.updated_at);
  let updated = false;
  try {
    const result = await db.query<{ plan_id: string } & Record<string, unknown>>(
      "UPDATE membership_plans SET status = 'ACTIVE', visibility = 'PUBLIC', updated_at = $1::timestamptz, version = version + 1 " +
      "WHERE plan_id = $2 AND owner_type = 'CREATOR' AND owner_id = $3 " +
      "AND status = 'DRAFT' AND visibility = 'PRIVATE' AND version = $4 " +
      'AND EXISTS (SELECT 1 FROM membership_plan_versions AS v ' +
      'WHERE v.plan_id = membership_plans.plan_id AND v.plan_version = membership_plans.current_version) ' +
      'RETURNING plan_id',
      [updatedAt, planId, creatorId, expectedVersion],
    );
    updated = result.rows.length === 1;
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }

  if (!updated) {
    const raced = await readOwnedPlan();
    if (!raced) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
    if (raced.status === 'ACTIVE' && raced.visibility === 'PUBLIC' &&
        raced.version === expectedVersion + 1) return mapMembershipPlan(raced, true);
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  }

  const published = await readOwnedPlan();
  if (!published || published.status !== 'ACTIVE' || published.visibility !== 'PUBLIC' ||
      published.version !== expectedVersion + 1) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  console.log(JSON.stringify({
    event: 'membership.plan.published',
    operation: 'publishMembershipPlan',
    planId,
    creatorId,
    planVersion: published.current_version,
    version: published.version,
  }));
  return mapMembershipPlan(published, false);
}

/**
 * Create a new immutable commercial plan version and CAS the plan's current
 * pointer. Existing subscriptions keep their original plan_version snapshot.
 * Replaying the same expected ETag and exact terms after a successful write
 * returns the current version; changed terms or a newer lifecycle version fail.
 */
export async function reviseMembershipPlan(
  db: W07WebhookPostgresPool,
  verifiedCreatorId: string,
  planIdInput: string,
  ifMatchInput: string | null,
  input: unknown,
): Promise<ReturnType<typeof mapMembershipPlan>> {
  const creatorId = validatePrincipal(verifiedCreatorId);
  const planId = ensureId(planIdInput);
  const expectedVersion = planVersionFromEtag(validateIfMatch(ifMatchInput));
  const readOwnedPlan = () => readOwnedMembershipPlanPostgres(db, planId, creatorId);
  const current = await readOwnedPlan();
  if (!current) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
  if (current.status === 'RETIRED') throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  const revision = normalizeMembershipPlanDraft(input, current.trial_period_days);
  const benefitsJson = canonicalBenefitsJson(revision.benefits);
  const matchesRevision = (row: MembershipPlanStoredRow): boolean =>
    row.name === revision.name &&
    row.tier === revision.tier &&
    row.billing_interval === revision.billingInterval &&
    row.price_minor === revision.priceMinor &&
    (row.price_mode ?? 'FIXED') === revision.priceMode &&
    (row.minimum_price_minor ?? null) === revision.minimumPriceMinor &&
    (row.suggested_price_minor ?? null) === revision.suggestedPriceMinor &&
    (row.maximum_price_minor ?? null) === revision.maximumPriceMinor &&
    row.currency === revision.currency &&
    row.benefits_json === benefitsJson &&
    (row.trial_period_days ?? 0) === revision.trialPeriodDays;

  if (current.version !== expectedVersion) {
    if (current.version === expectedVersion + 1 && current.current_version > 1 && matchesRevision(current)) {
      return mapMembershipPlan(current, true);
    }
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  }
  if (matchesRevision(current)) return mapMembershipPlan(current, true);

  const nextPlanVersion = current.current_version + 1;
  if (!Number.isSafeInteger(nextPlanVersion) || nextPlanVersion < 2) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  const updatedAt = nextUpdatedAt(current.updated_at);
  const revisedPlan = await reviseMembershipPlanPostgres(db, {
    planId,
    creatorId,
    currentPlanVersion: current.current_version,
    expectedVersion,
    nextPlanVersion,
    revision,
    benefitsJson,
    updatedAt,
  });

  if (!revisedPlan) {
    const raced = await readOwnedPlan();
    if (!raced) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
    if (raced.version === expectedVersion + 1 && raced.current_version === nextPlanVersion && matchesRevision(raced)) {
      return mapMembershipPlan(raced, true);
    }
    if (raced.version !== expectedVersion) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
    throw new SubscriptionRuntimeError('CONFLICT', 409);
  }
  const revised = await readOwnedPlan();
  if (!revised || revised.current_version !== nextPlanVersion ||
      revised.version !== expectedVersion + 1 || !matchesRevision(revised)) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  console.log(JSON.stringify({
    event: 'membership.plan.updated',
    operation: 'reviseMembershipPlan',
    planId,
    creatorId,
    previousPlanVersion: current.current_version,
    planVersion: revised.current_version,
    version: revised.version,
  }));
  return mapMembershipPlan(revised, false);
}

/** Pause/resume new sales or permanently retire a paused plan with lifecycle CAS; existing subscribers keep their accepted plan_version. */
export async function transitionMembershipPlanLifecycle(
  db: W07WebhookPostgresPool,
  verifiedCreatorId: string,
  planIdInput: string,
  ifMatchInput: string | null,
  action: 'pause' | 'resume' | 'retire',
): Promise<ReturnType<typeof mapMembershipPlan>> {
  const creatorId = validatePrincipal(verifiedCreatorId);
  const planId = ensureId(planIdInput);
  const expectedVersion = planVersionFromEtag(validateIfMatch(ifMatchInput));
  if (action !== 'pause' && action !== 'resume' && action !== 'retire') {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }
  const target = action === 'pause'
    ? { status: 'PAUSED' as const, visibility: 'PRIVATE' as const, fromStatus: 'ACTIVE' as const, fromVisibility: 'PUBLIC' as const }
    : action === 'resume'
      ? { status: 'ACTIVE' as const, visibility: 'PUBLIC' as const, fromStatus: 'PAUSED' as const, fromVisibility: 'PRIVATE' as const }
      : { status: 'RETIRED' as const, visibility: 'PRIVATE' as const, fromStatus: 'PAUSED' as const, fromVisibility: 'PRIVATE' as const };
  const readOwnedPlan = () => readOwnedMembershipPlanPostgres(db, planId, creatorId);
  const current = await readOwnedPlan();
  if (!current) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
  if (current.version !== expectedVersion) {
    if (current.version === expectedVersion + 1 && current.status === target.status &&
        current.visibility === target.visibility) return mapMembershipPlan(current, true);
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  }
  if (current.status === 'RETIRED') {
    if (action === 'retire') return mapMembershipPlan(current, true);
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }
  if (current.status === target.status && current.visibility === target.visibility) return mapMembershipPlan(current, true);
  if (current.status !== target.fromStatus || current.visibility !== target.fromVisibility) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }
  const updatedAt = nextUpdatedAt(current.updated_at);
  let updated = false;
  try {
    const result = await db.query<{ plan_id: string } & Record<string, unknown>>(
      'UPDATE membership_plans SET status = $1, visibility = $2, updated_at = $3::timestamptz, version = version + 1 ' +
      "WHERE plan_id = $4 AND owner_type = 'CREATOR' AND owner_id = $5 AND version = $6 " +
      'AND status = $7 AND visibility = $8 AND EXISTS (' +
      'SELECT 1 FROM membership_plan_versions v WHERE v.plan_id = membership_plans.plan_id ' +
      'AND v.plan_version = membership_plans.current_version) RETURNING plan_id',
      [target.status, target.visibility, updatedAt, planId, creatorId, expectedVersion, target.fromStatus, target.fromVisibility],
    );
    updated = result.rows.length === 1;
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!updated) {
    const raced = await readOwnedPlan();
    if (!raced) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
    if (raced.version === expectedVersion + 1 && raced.status === target.status &&
        raced.visibility === target.visibility) return mapMembershipPlan(raced, true);
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  }
  const transitioned = await readOwnedPlan();
  if (!transitioned || transitioned.status !== target.status || transitioned.visibility !== target.visibility ||
      transitioned.version !== expectedVersion + 1 || transitioned.current_version !== current.current_version) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  console.log(JSON.stringify({
    event: action === 'pause' ? 'membership.plan.paused' : action === 'resume' ? 'membership.plan.activated' : 'membership.plan.retired',
    operation: 'transitionMembershipPlanLifecycle',
    action,
    planId,
    creatorId,
    planVersion: transitioned.current_version,
    version: transitioned.version,
  }));
  return mapMembershipPlan(transitioned, false);
}

/** Owner-scoped plan list/** Owner-scoped plan list for the authenticated creator, including private drafts. */
export async function listCreatorMembershipPlans(
  db: W07WebhookPostgresPool,
  verifiedCreatorId: string,
  limit = 20,
  cursorValue: string | null = null,
): Promise<{
  docs: ReturnType<typeof mapMembershipPlan>[];
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const creatorId = validatePrincipal(verifiedCreatorId);
  const safeLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 20;
  const cursor = decodePlanListCursor(cursorValue);
  let sql =
    'SELECT p.plan_id, p.owner_id, p.current_version, p.status, p.visibility, p.version, ' +
    `to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at, ` +
    `to_char(p.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at, ` +
    'v.name, v.tier, v.billing_interval, v.price_minor, v.price_mode, v.minimum_price_minor, v.suggested_price_minor, v.maximum_price_minor, v.currency, v.benefits_json, v.trial_period_days ' +
    'FROM membership_plans AS p INNER JOIN membership_plan_versions AS v ' +
    'ON v.plan_id = p.plan_id AND v.plan_version = p.current_version ' +
    "WHERE p.owner_type = 'CREATOR' AND p.owner_id = $1 ";
  const values: unknown[] = [creatorId];
  if (cursor) {
    values.push(cursor.createdAt, cursor.createdAt, cursor.planId);
    sql += `AND (p.created_at < $${values.length - 2}::timestamptz OR ` +
      `(p.created_at = $${values.length - 1}::timestamptz AND p.plan_id < $${values.length})) `;
  }
  values.push(safeLimit + 1);
  sql += `ORDER BY p.created_at DESC, p.plan_id DESC LIMIT $${values.length}`;
  let candidates: MembershipPlanStoredRow[];
  try {
    const result = await db.query<MembershipPlanStoredRow & Record<string, unknown>>(sql, values);
    candidates = result.rows;
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  const hasMore = candidates.length > safeLimit;
  const page = candidates.slice(0, safeLimit);
  const last = page.at(-1);
  return {
    docs: page.map((row) => mapMembershipPlan(row)),
    limit: safeLimit,
    hasMore,
    nextCursor: hasMore && last ? encodePlanListCursor({ createdAt: last.created_at, planId: last.plan_id }) : null,
  };
}

const RESOLVABLE_MEMBERSHIP_PLAN_ID_PATTERN = /^plan_[a-f0-9]{64}$/;

/**
 * Resolve public, active creator membership offers from their authoritative
 * D1-01 plan + immutable current-version rows. This is read-only and deliberately
 * does not create an order, contact a payment provider, or grant an entitlement.
 */
export async function resolvePurchasableMembershipPlanOffers(
  db: W07WebhookPostgresPool,
  planIds: readonly string[],
): Promise<Array<ReturnType<typeof mapMembershipPlan>>> {
  if (!Array.isArray(planIds) || planIds.length < 1 || planIds.length > 50) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }
  const seen = new Set<string>();
  for (const planId of planIds as readonly unknown[]) {
    if (typeof planId !== 'string' || !RESOLVABLE_MEMBERSHIP_PLAN_ID_PATTERN.test(planId) ||
        planId.trim() !== planId) {
      throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
    }
    if (seen.has(planId)) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
    seen.add(planId);
  }

  let rows: unknown[];
  try {
    const result = await db.query<MembershipPlanStoredRow & Record<string, unknown>>(
      'SELECT p.plan_id, p.owner_id, p.current_version, p.status, p.visibility, p.version, ' +
      `to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at, ` +
      `to_char(p.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at, ` +
      'v.name, v.tier, v.billing_interval, v.price_minor, v.price_mode, v.minimum_price_minor, v.suggested_price_minor, v.maximum_price_minor, v.currency, v.benefits_json, v.trial_period_days ' +
      'FROM membership_plans AS p ' +
      'INNER JOIN membership_plan_versions AS v ON v.plan_id = p.plan_id AND v.plan_version = p.current_version ' +
      "WHERE p.owner_type = 'CREATOR' AND p.status = 'ACTIVE' AND p.visibility = 'PUBLIC' " +
      'AND p.plan_id = ANY($1::text[])',
      [planIds],
    );
    rows = result.rows;
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!Array.isArray(rows) || rows.length > planIds.length) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  const mappedById = new Map<string, ReturnType<typeof mapMembershipPlan>>();
  for (const candidate of rows) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
    }
    const row = candidate as MembershipPlanStoredRow;
    if (typeof row.plan_id !== 'string' || !RESOLVABLE_MEMBERSHIP_PLAN_ID_PATTERN.test(row.plan_id) ||
        !seen.has(row.plan_id) || mappedById.has(row.plan_id) ||
        typeof row.owner_id !== 'string' || row.owner_id.trim() !== row.owner_id ||
        row.owner_id.length < 1 || row.owner_id.length > MAX_ID ||
        row.status !== 'ACTIVE' || row.visibility !== 'PUBLIC') {
      throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
    }
    mappedById.set(row.plan_id, mapMembershipPlan(row));
  }
  if (mappedById.size !== planIds.length) {
    throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
  }
  return planIds.map((planId) => {
    const plan = mappedById.get(planId);
    if (!plan) throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
    return plan;
  });
}
