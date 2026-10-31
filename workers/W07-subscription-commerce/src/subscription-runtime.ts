/// <reference types="@cloudflare/workers-types" />

import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js';

export type SubscriptionStatus = 'PENDING' | 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELED' | 'EXPIRED'

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
  cancelAt: row.cancel_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  version: row.version,
  etag: etagForVersion(row.version),
})

const readSubscriptionRow = async (db: D1Database, subscriptionId: string, subscriberId?: string): Promise<SubscriptionRow> => {
  const id = ensureId(subscriptionId)
  const sql = subscriberId === undefined ? 'SELECT * FROM membership_subscriptions WHERE subscription_id = ? LIMIT 1' : 'SELECT * FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1'
  const args = subscriberId === undefined ? [id] : [id, ensureId(subscriberId)]
  const row = await db.prepare(sql).bind(...args).first<SubscriptionRow>()
  if (!row) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404)
  return row
}

export async function createSubscription(db: D1Database, subscriberId: string, input: { planId: string; idempotencyKey: string }): Promise<ReturnType<typeof toPublic>> {
  const subscriber = validatePrincipal(subscriberId)
  const planId = ensureId(input.planId)
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)
  const subscriptionId = await subscriptionIdFromIdempotency(subscriber, idempotencyKey)

  // Replay first: idempotency preserves the original result even if the plan
  // was retired after the first successful request.
  const existing = await db.prepare('SELECT * FROM membership_subscriptions WHERE subscription_id = ? LIMIT 1').bind(subscriptionId).first<SubscriptionRow>()
  if (existing) {
    if (existing.subscriber_id !== subscriber || existing.plan_id !== planId) throw new SubscriptionRuntimeError('CONFLICT', 409)
    return toPublic(existing)
  }

  const now = nowIso()
  let result: { meta?: { changes?: number } }
  try {
    // Resolve the active, public, creator-owned plan and snapshot its current
    // immutable version in the same SQL statement as the subscription insert.
    // This prevents a plan retirement/version switch between lookup and insert.
    result = await db.prepare(
      "INSERT INTO membership_subscriptions " +
      "(subscription_id, subscriber_id, plan_id, plan_version, creator_id, status, started_at, current_period_start, current_period_end, cancel_at, entitlement_snapshot_ref, created_at, updated_at, version) " +
      "SELECT ?, ?, p.plan_id, p.current_version, p.owner_id, 'PENDING', ?, ?, " +
      "CASE pv.billing_interval WHEN 'MONTHLY' THEN ? WHEN 'YEARLY' THEN ? ELSE NULL END, " +
      "NULL, NULL, ?, ?, 1 " +
      "FROM membership_plans AS p " +
      "INNER JOIN membership_plan_versions AS pv ON pv.plan_id = p.plan_id AND pv.plan_version = p.current_version " +
      "WHERE p.plan_id = ? AND p.owner_type = 'CREATOR' AND p.status IN ('ACTIVE','TRIALING') AND p.visibility = 'PUBLIC' " +
      "LIMIT 1",
    ).bind(subscriptionId, subscriber, now, now, addBillingPeriod(now, 'MONTHLY'), addBillingPeriod(now, 'YEARLY'), now, now, planId).run()
  } catch (error) {
    if (!(error instanceof Error) || !error.message.toLowerCase().includes('unique')) throw error
    const raced = await db.prepare('SELECT * FROM membership_subscriptions WHERE subscription_id = ? LIMIT 1').bind(subscriptionId).first<SubscriptionRow>()
    if (!raced) throw error
    if (raced.subscriber_id !== subscriber || raced.plan_id !== planId) throw new SubscriptionRuntimeError('CONFLICT', 409)
    return toPublic(raced)
  }
  if (Number(result.meta?.changes ?? 0) !== 1) throw new SubscriptionRuntimeError('PLAN_NOT_ACTIVE', 409)

  const row = await readSubscriptionRow(db, subscriptionId, subscriber)
  console.log(JSON.stringify({ event: 'membership.subscription.created', operation: 'createSubscription', subscriptionId: row.subscription_id, subscriberId: row.subscriber_id, status: row.status, planVersion: row.plan_version }))
  return toPublic(row)
}

export async function getSubscription(db: D1Database, subscriberId: string, subscriptionId: string): Promise<ReturnType<typeof toPublic>> {
  return toPublic(await readSubscriptionRow(db, subscriptionId, validatePrincipal(subscriberId)))
}


/**
 * Read-only creator membership check for W03 content authorization.
 * Subscription/access state remains in D1-01; W03 receives only a boolean
 * decision and never reads or persists membership rows.
 */
export async function hasActiveCreatorMembership(
  db: D1Database,
  subscriberIdInput: string,
  creatorIdInput: string,
  now = new Date(),
): Promise<boolean> {
  const subscriberId = validatePrincipal(subscriberIdInput)
  const creatorId = ensureId(creatorIdInput)
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  const nowValue = now.toISOString()
  let row: { subscription_id: string } | null
  try {
    row = await db.prepare(
      "SELECT subscription_id FROM membership_subscriptions " +
      "WHERE subscriber_id = ? AND creator_id = ? AND status = 'ACTIVE' " +
      "AND current_period_start <= ? AND current_period_end > ? " +
      "AND (cancel_at IS NULL OR cancel_at > ?) " +
      "ORDER BY current_period_end DESC, subscription_id ASC LIMIT 1",
    ).bind(subscriberId, creatorId, nowValue, nowValue, nowValue).first<{ subscription_id: string }>()
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  return row !== null && typeof row.subscription_id === 'string' && row.subscription_id.length > 0
}

export async function listSubscriptions(
  db: D1Database,
  subscriberId: string,
  limit = 20,
  page = 1,
): Promise<{
  docs: ReturnType<typeof toPublic>[]
  limit: number
  page: number
  hasNextPage: boolean
}> {
  const subscriber = validatePrincipal(subscriberId)
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 50) : 20
  const safePage = Number.isFinite(page) ? Math.min(Math.max(Math.trunc(page), 1), 10000) : 1
  const offset = (safePage - 1) * safeLimit
  const rows = await db.prepare(
    'SELECT * FROM membership_subscriptions WHERE subscriber_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
  ).bind(subscriber, safeLimit + 1, offset).all<SubscriptionRow>()
  const docs = (rows.results ?? []).slice(0, safeLimit).map(toPublic)
  return {
    docs,
    limit: safeLimit,
    page: safePage,
    hasNextPage: (rows.results ?? []).length > safeLimit,
  }
}

const transitionTargets: Record<'cancel' | 'pause' | 'resume', SubscriptionStatus[]> = { cancel: ['ACTIVE', 'PAST_DUE', 'PAUSED'], pause: ['ACTIVE'], resume: ['PAUSED'] }
const nextStates: Record<'cancel' | 'pause' | 'resume', SubscriptionStatus> = { cancel: 'CANCELED', pause: 'PAUSED', resume: 'ACTIVE' }
const nextState = (operation: 'cancel' | 'pause' | 'resume'): SubscriptionStatus => nextStates[operation]

export async function transitionSubscription(db: D1Database, subscriberId: string, subscriptionId: string, operation: 'cancel' | 'pause' | 'resume', ifMatch: string): Promise<ReturnType<typeof toPublic>> {
  const subscriber = validatePrincipal(subscriberId)
  const etag = validateIfMatch(ifMatch)
  const expectedVersion = versionFromEtag(etag)
  const row = await readSubscriptionRow(db, subscriptionId, subscriber)
  if (row.version !== expectedVersion) {
    const convergedState = nextState(operation)
    if (row.status === convergedState) return toPublic(row)
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  }
  if (!transitionTargets[operation].includes(row.status)) throw new SubscriptionRuntimeError('INVALID_STATE', 409)
  const updatedAt = nextUpdatedAt(row.updated_at)
  const result = await db.prepare('UPDATE membership_subscriptions SET status = ?, cancel_at = ?, updated_at = ?, version = version + 1 WHERE subscription_id = ? AND subscriber_id = ? AND version = ?')
    .bind(nextState(operation), operation === 'cancel' ? updatedAt : row.cancel_at, updatedAt, row.subscription_id, subscriber, expectedVersion).run()
  if (Number(result.meta?.changes ?? 0) !== 1) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  const updated = await readSubscriptionRow(db, row.subscription_id, subscriber)
  console.log(JSON.stringify({ event: 'membership.subscription.transitioned', operation: operation + 'Subscription', subscriptionId: updated.subscription_id, subscriberId: updated.subscriber_id, from: row.status, to: updated.status }))
  return toPublic(updated)
}

export async function changeSubscriptionPlan(db: D1Database, subscriberId: string, subscriptionId: string, planId: string, ifMatch: string): Promise<ReturnType<typeof toPublic>> {
  const subscriber = validatePrincipal(subscriberId)
  const nextPlanId = ensureId(planId)
  const etag = validateIfMatch(ifMatch)
  const expectedVersion = versionFromEtag(etag)
  const row = await readSubscriptionRow(db, subscriptionId, subscriber)
  if (row.version !== expectedVersion) {
    if (row.plan_id === nextPlanId) return toPublic(row)
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  }
  if (!['ACTIVE', 'PAUSED', 'PAST_DUE'].includes(row.status)) throw new SubscriptionRuntimeError('INVALID_STATE', 409)
  if (row.plan_id === nextPlanId) return toPublic(row)

  const updatedAt = nextUpdatedAt(row.updated_at)
  const result = await db.prepare(
    "UPDATE membership_subscriptions SET plan_id = ?, " +
    "plan_version = (SELECT current_version FROM membership_plans WHERE plan_id = ? AND owner_type = 'CREATOR' AND status = 'ACTIVE' AND visibility = 'PUBLIC'), " +
    "creator_id = (SELECT owner_id FROM membership_plans WHERE plan_id = ? AND owner_type = 'CREATOR' AND status = 'ACTIVE' AND visibility = 'PUBLIC'), " +
    "updated_at = ?, version = version + 1 " +
    "WHERE subscription_id = ? AND subscriber_id = ? AND version = ? " +
    "AND EXISTS (SELECT 1 FROM membership_plans WHERE plan_id = ? AND owner_type = 'CREATOR' AND owner_id = ? AND status = 'ACTIVE' AND visibility = 'PUBLIC' " +
    "AND EXISTS (SELECT 1 FROM membership_plan_versions WHERE plan_id = membership_plans.plan_id AND plan_version = membership_plans.current_version))",
  ).bind(nextPlanId, nextPlanId, nextPlanId, updatedAt, row.subscription_id, subscriber, expectedVersion, nextPlanId, row.creator_id).run()
  if (Number(result.meta?.changes ?? 0) !== 1) {
    const latest = await readSubscriptionRow(db, row.subscription_id, subscriber)
    if (latest.version !== expectedVersion) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
    throw new SubscriptionRuntimeError('PLAN_NOT_ACTIVE', 409)
  }

  const updated = await readSubscriptionRow(db, row.subscription_id, subscriber)
  console.log(JSON.stringify({ event: 'membership.subscription.plan_changed', operation: 'changeSubscriptionPlan', subscriptionId: updated.subscription_id, subscriberId: updated.subscriber_id, previousPlanId: row.plan_id, planId: updated.plan_id, planVersion: updated.plan_version }))
  return toPublic(updated)
}

export type ActiveMembershipPlanRow = {
  plan_id: string
  owner_id: string
  current_version: number
  created_at: string
  updated_at: string
  name: string
  tier: string
  billing_interval: string
  price_minor: number
  currency: string
  benefits_json: string
  trial_days: number
}

type PlanListCursor = { createdAt: string; planId: string }

const encodePlanListCursor = (cursor: PlanListCursor): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
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

/**
 * Public discovery returns only active, public creator plans with an immutable
 * current version. The cursor is an opaque stable (createdAt, planId) keyset;
 * no offset scan or private-plan metadata is exposed.
 */
export async function listActiveMembershipPlans(
  db: D1Database,
  limit = 20,
  cursorValue: string | null = null,
): Promise<{
  docs: Array<{
    planId: string
    creatorId: string
    planVersion: number
    name: string
    tier: string
    billingInterval: string
    priceMinor: number
    currency: string
    benefits: unknown
    trialDays: number
    createdAt: string
    updatedAt: string
  }>
  limit: number
  nextCursor: string | null
  hasMore: boolean
}> {
  const safeLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 20
  const cursor = decodePlanListCursor(cursorValue)
  const baseSql =
    'SELECT p.plan_id, p.owner_id, p.current_version, p.created_at, p.updated_at, ' +
    'v.name, v.tier, v.billing_interval, v.price_minor, v.currency, v.benefits_json, v.trial_days ' +
    'FROM membership_plans AS p ' +
    'INNER JOIN membership_plan_versions AS v ON v.plan_id = p.plan_id AND v.plan_version = p.current_version ' +
    "WHERE p.owner_type = 'CREATOR' AND p.status = 'ACTIVE' AND p.visibility = 'PUBLIC' "
  const statement = cursor
    ? db.prepare(baseSql + 'AND (p.created_at < ? OR (p.created_at = ? AND p.plan_id < ?)) ORDER BY p.created_at DESC, p.plan_id DESC LIMIT ?')
      .bind(cursor.createdAt, cursor.createdAt, cursor.planId, safeLimit + 1)
    : db.prepare(baseSql + 'ORDER BY p.created_at DESC, p.plan_id DESC LIMIT ?').bind(safeLimit + 1)
  const rows = await statement.all<ActiveMembershipPlanRow>()
  const candidates = rows.results ?? []
  const hasMore = candidates.length > safeLimit
  const page = candidates.slice(0, safeLimit)
  const docs = page.map((row) => {
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
      row.benefits_json.length > 8192
    ) {
      throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500)
    }
    if (
      !Number.isSafeInteger(row.current_version) || row.current_version < 1 ||
      !Number.isSafeInteger(row.price_minor) || row.price_minor < 0 || row.price_minor > 2_147_483_647 ||
      !/^[A-Z]{3}$/.test(row.currency) ||
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
      currency: row.currency,
      benefits,
      trialDays: row.trial_days,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  })
  const last = page.at(-1)
  return {
    docs,
    limit: safeLimit,
    hasMore,
    nextCursor: hasMore && last ? encodePlanListCursor({ createdAt: last.created_at, planId: last.plan_id }) : null,
  }
}

export type MembershipPlanDraftInput = {
  name: string
  tier: string
  billingInterval: 'MONTHLY' | 'YEARLY'
  priceMinor: number
  currency: string
  benefits: string[]
  trialDays: number
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
  price_minor: number
  currency: string
  benefits_json: string
  trial_days: number
}

const canonicalBenefitsJson = (benefits: string[]): string => JSON.stringify(benefits)

export function normalizeMembershipPlanDraft(value: unknown): MembershipPlanDraftInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
  const source = value as Record<string, unknown>
  const allowedKeys = new Set(['name', 'tier', 'billingInterval', 'priceMinor', 'currency', 'benefits', 'trialDays'])
  if (Object.keys(source).some((key) => !allowedKeys.has(key))) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }

  const name = typeof source.name === 'string' ? source.name.trim() : ''
  const tier = typeof source.tier === 'string' ? source.tier.trim() : ''
  const billingInterval = typeof source.billingInterval === 'string' ? source.billingInterval.trim() : ''
  const currency = typeof source.currency === 'string' ? source.currency.trim() : ''
  const priceMinor = source.priceMinor
  const rawBenefits = source.benefits
  const trialDays = source.trialDays === undefined ? 0 : source.trialDays

  if (name.length < 1 || name.length > 120) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(tier)) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  if (billingInterval !== 'MONTHLY' && billingInterval !== 'YEARLY') throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  if (!/^[A-Z]{3}$/.test(currency)) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  if (typeof priceMinor !== 'number' || !Number.isSafeInteger(priceMinor) || priceMinor < 0 || priceMinor > 2_147_483_647) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
  if (typeof trialDays !== 'number' || !Number.isSafeInteger(trialDays) || trialDays < 0 || trialDays > 90) {
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

  return { name, tier, billingInterval, priceMinor: priceMinor as number, currency, benefits, trialDays }
}

const membershipPlanIdFromIdempotency = async (creatorId: string, idempotencyKey: string): Promise<string> => {
  const material = new TextEncoder().encode('membership-plan-create\u0000' + creatorId + '\u0000' + idempotencyKey)
  const digest = await crypto.subtle.digest('SHA-256', material)
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return 'plan_' + hex
}

const mapMembershipPlan = (row: MembershipPlanStoredRow, replayed?: boolean) => {
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
    !Number.isSafeInteger(row.trial_days) || row.trial_days < 0 || row.trial_days > 90 ||
    !Number.isSafeInteger(row.current_version) || row.current_version < 1 ||
    !Number.isSafeInteger(row.version) || row.version < 1 ||
    !Number.isSafeInteger(row.price_minor) || row.price_minor < 0 || row.price_minor > 2_147_483_647 ||
    !/^[A-Z]{3}$/.test(row.currency) ||
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
    currency: row.currency,
    benefits,
    trialDays: row.trial_days,
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
export async function createMembershipPlanDraft(
  db: D1Database,
  actorUserId: string,
  verifiedCreatorId: string,
  input: unknown,
  key: string | null,
): Promise<ReturnType<typeof mapMembershipPlan>> {
  const actor = validatePrincipal(actorUserId)
  const creatorId = validatePrincipal(verifiedCreatorId)
  const idempotencyKey = validateIdempotencyKey(key)
  const plan = normalizeMembershipPlanDraft(input)
  const planId = await membershipPlanIdFromIdempotency(creatorId, idempotencyKey)
  const benefitsJson = canonicalBenefitsJson(plan.benefits)

  const existing = await db.prepare(
    'SELECT p.plan_id, p.owner_id, p.current_version, p.status, p.visibility, p.version, p.created_at, p.updated_at, ' +
    'v.name, v.tier, v.billing_interval, v.price_minor, v.currency, v.benefits_json, v.trial_days ' +
    'FROM membership_plans AS p INNER JOIN membership_plan_versions AS v ' +
    'ON v.plan_id = p.plan_id AND v.plan_version = 1 WHERE p.plan_id = ? LIMIT 1',
  ).bind(planId).first<MembershipPlanStoredRow>()
  if (existing) {
    if (
      existing.owner_id !== creatorId || existing.name !== plan.name || existing.tier !== plan.tier ||
      existing.billing_interval !== plan.billingInterval || existing.price_minor !== plan.priceMinor ||
      existing.currency !== plan.currency || existing.benefits_json !== benefitsJson || existing.trial_days !== plan.trialDays
    ) throw new SubscriptionRuntimeError('CONFLICT', 409)
    // Return the immutable original create result, not current mutable plan state.
    return mapMembershipPlan({ ...existing, current_version: 1, status: 'DRAFT', visibility: 'PRIVATE', version: 1, updated_at: existing.created_at }, true)
  }

  const now = nowIso()
  const results = await db.batch([
    db.prepare(
      "INSERT OR IGNORE INTO membership_plans (plan_id, owner_type, owner_id, current_version, status, visibility, version, created_at, updated_at) " +
      "VALUES (?, 'CREATOR', ?, 1, 'DRAFT', 'PRIVATE', 1, ?, ?)",
    ).bind(planId, creatorId, now, now),
    db.prepare(
      'INSERT OR IGNORE INTO membership_plan_versions (plan_id, plan_version, name, tier, billing_interval, price_minor, currency, benefits_json, created_at, trial_days) ' +
      'VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(planId, plan.name, plan.tier, plan.billingInterval, plan.priceMinor, plan.currency, benefitsJson, now, plan.trialDays),
  ])
  if (Number(results[0]?.meta?.changes ?? 0) !== 1 || Number(results[1]?.meta?.changes ?? 0) !== 1) {
    const raced = await db.prepare(
      'SELECT p.plan_id, p.owner_id, p.current_version, p.status, p.visibility, p.version, p.created_at, p.updated_at, ' +
      'v.name, v.tier, v.billing_interval, v.price_minor, v.currency, v.benefits_json ' +
      'FROM membership_plans AS p INNER JOIN membership_plan_versions AS v ' +
      'ON v.plan_id = p.plan_id AND v.plan_version = 1 WHERE p.plan_id = ? LIMIT 1',
    ).bind(planId).first<MembershipPlanStoredRow>()
    if (!raced) throw new SubscriptionRuntimeError('CONFLICT', 409)
    if (
      raced.owner_id !== creatorId || raced.name !== plan.name || raced.tier !== plan.tier ||
      raced.billing_interval !== plan.billingInterval || raced.price_minor !== plan.priceMinor ||
      raced.currency !== plan.currency || raced.benefits_json !== benefitsJson || raced.trial_days !== plan.trialDays
    ) throw new SubscriptionRuntimeError('CONFLICT', 409)
    return mapMembershipPlan({ ...raced, current_version: 1, status: 'DRAFT', visibility: 'PRIVATE', version: 1, updated_at: raced.created_at }, true)
  }

  console.log(JSON.stringify({ event: 'membership.plan.draft.created', operation: 'createMembershipPlanDraft', planId, creatorId, actorUserId: actor }))
  return {
    planId,
    creatorId,
    planVersion: 1,
    name: plan.name,
    tier: plan.tier,
    billingInterval: plan.billingInterval,
    priceMinor: plan.priceMinor,
    currency: plan.currency,
    benefits: plan.benefits,
    trialDays: plan.trialDays,
    status: 'DRAFT',
    visibility: 'PRIVATE',
    version: 1,
    createdAt: now,
    updatedAt: now,
    etag: '"lr-plan-v1"',
    replayed: false,
  }
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
  db: D1Database,
  verifiedCreatorId: string,
  planIdInput: string,
  ifMatchInput: string | null,
): Promise<ReturnType<typeof mapMembershipPlan>> {
  const creatorId = validatePrincipal(verifiedCreatorId)
  const planId = ensureId(planIdInput)
  const ifMatch = validateIfMatch(ifMatchInput)
  const expectedVersion = planVersionFromEtag(ifMatch)

  const readOwnedPlan = async (): Promise<MembershipPlanStoredRow | null> =>
    db.prepare(
      'SELECT p.plan_id, p.owner_id, p.current_version, p.status, p.visibility, p.version, p.created_at, p.updated_at, ' +
      'v.name, v.tier, v.billing_interval, v.price_minor, v.currency, v.benefits_json ' +
      'FROM membership_plans AS p INNER JOIN membership_plan_versions AS v ' +
      'ON v.plan_id = p.plan_id AND v.plan_version = p.current_version ' +
      "WHERE p.plan_id = ? AND p.owner_type = 'CREATOR' AND p.owner_id = ? LIMIT 1",
    ).bind(planId, creatorId).first<MembershipPlanStoredRow>()

  const current = await readOwnedPlan()
  if (!current) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404)

  if (current.version !== expectedVersion) {
    // A retry after the exact state transition converged must produce the same
    // result; any later mutation still requires the current ETag.
    if (
      current.status === 'ACTIVE' &&
      current.visibility === 'PUBLIC' &&
      current.version === expectedVersion + 1
    ) return mapMembershipPlan(current, true)
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  }

  if (current.status === 'ACTIVE' && current.visibility === 'PUBLIC') {
    return mapMembershipPlan(current, true)
  }
  if (current.status !== 'DRAFT' || current.visibility !== 'PRIVATE') {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409)
  }

  const updatedAt = nextUpdatedAt(current.updated_at)
  let updated: { meta?: { changes?: number } }
  try {
    updated = await db.prepare(
      "UPDATE membership_plans SET status = 'ACTIVE', visibility = 'PUBLIC', updated_at = ?, version = version + 1 " +
      "WHERE plan_id = ? AND owner_type = 'CREATOR' AND owner_id = ? " +
      "AND status = 'DRAFT' AND visibility = 'PRIVATE' AND version = ? " +
      'AND EXISTS (SELECT 1 FROM membership_plan_versions AS v ' +
      'WHERE v.plan_id = membership_plans.plan_id AND v.plan_version = membership_plans.current_version)',
    ).bind(updatedAt, planId, creatorId, expectedVersion).run()
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }

  if (Number(updated.meta?.changes ?? 0) !== 1) {
    const raced = await readOwnedPlan()
    if (!raced) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404)
    if (
      raced.status === 'ACTIVE' &&
      raced.visibility === 'PUBLIC' &&
      raced.version === expectedVersion + 1
    ) return mapMembershipPlan(raced, true)
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  }

  const published = await readOwnedPlan()
  if (
    !published ||
    published.status !== 'ACTIVE' ||
    published.visibility !== 'PUBLIC' ||
    published.version !== expectedVersion + 1
  ) throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500)

  console.log(JSON.stringify({
    event: 'membership.plan.published',
    operation: 'publishMembershipPlan',
    planId,
    creatorId,
    planVersion: published.current_version,
    version: published.version,
  }))
  return mapMembershipPlan(published, false)
}


/**
 * Create a new immutable commercial plan version and CAS the plan's current
 * pointer. Existing subscriptions keep their original plan_version snapshot.
 * Replaying the same expected ETag and exact terms after a successful write
 * returns the current version; changed terms or a newer lifecycle version fail.
 */
export async function reviseMembershipPlan(
  db: D1Database,
  verifiedCreatorId: string,
  planIdInput: string,
  ifMatchInput: string | null,
  input: unknown,
): Promise<ReturnType<typeof mapMembershipPlan>> {
  const creatorId = validatePrincipal(verifiedCreatorId)
  const planId = ensureId(planIdInput)
  const expectedVersion = planVersionFromEtag(validateIfMatch(ifMatchInput))
  const revision = normalizeMembershipPlanDraft(input)
  const benefitsJson = canonicalBenefitsJson(revision.benefits)

  const readOwnedPlan = async (): Promise<MembershipPlanStoredRow | null> =>
    db.prepare(
      'SELECT p.plan_id, p.owner_id, p.current_version, p.status, p.visibility, p.version, p.created_at, p.updated_at, ' +
      'v.name, v.tier, v.billing_interval, v.price_minor, v.currency, v.benefits_json ' +
      'FROM membership_plans AS p INNER JOIN membership_plan_versions AS v ' +
      'ON v.plan_id = p.plan_id AND v.plan_version = p.current_version ' +
      "WHERE p.plan_id = ? AND p.owner_type = 'CREATOR' AND p.owner_id = ? LIMIT 1",
    ).bind(planId, creatorId).first<MembershipPlanStoredRow>()

  const current = await readOwnedPlan()
  if (!current) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404)
  if (current.status === 'RETIRED') throw new SubscriptionRuntimeError('INVALID_STATE', 409)

  const matchesRevision = (row: MembershipPlanStoredRow): boolean =>
    row.name === revision.name &&
    row.trial_days === revision.trialDays &&
    row.tier === revision.tier &&
    row.billing_interval === revision.billingInterval &&
    row.price_minor === revision.priceMinor &&
    row.currency === revision.currency &&
    row.benefits_json === benefitsJson

  if (current.version !== expectedVersion) {
    if (current.version === expectedVersion + 1 && current.current_version > 1 && matchesRevision(current)) {
      return mapMembershipPlan(current, true)
    }
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  }

  if (matchesRevision(current)) return mapMembershipPlan(current, true)

  const nextPlanVersion = current.current_version + 1
  if (!Number.isSafeInteger(nextPlanVersion) || nextPlanVersion < 2) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500)
  }
  const updatedAt = nextUpdatedAt(current.updated_at)

  let results: D1Result[]
  try {
    results = await db.batch([
      db.prepare(
        'INSERT OR IGNORE INTO membership_plan_versions ' +
        '(plan_id, plan_version, name, tier, billing_interval, price_minor, currency, benefits_json, created_at, trial_days) ' +
        'SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (' +
        "SELECT 1 FROM membership_plans p WHERE p.plan_id = ? AND p.owner_type = 'CREATOR' AND p.owner_id = ? " +
        "AND p.status IN ('DRAFT','ACTIVE','PAUSED') AND p.current_version = ? AND p.version = ?)",
      ).bind(
        planId, nextPlanVersion, revision.name, revision.tier, revision.billingInterval,
        revision.priceMinor, revision.currency, benefitsJson, updatedAt, revision.trialDays,
        planId, creatorId, current.current_version, expectedVersion,
      ),
      db.prepare(
        'UPDATE membership_plans SET current_version = ?, updated_at = ?, version = version + 1 ' +
        "WHERE plan_id = ? AND owner_type = 'CREATOR' AND owner_id = ? AND status IN ('DRAFT','ACTIVE','PAUSED') " +
        'AND current_version = ? AND version = ? AND EXISTS (' +
        'SELECT 1 FROM membership_plan_versions v WHERE v.plan_id = membership_plans.plan_id ' +
        'AND v.plan_version = ? AND v.name = ? AND v.tier = ? AND v.billing_interval = ? ' +
        'AND v.price_minor = ? AND v.currency = ? AND v.benefits_json = ? AND v.trial_days = ?)',
      ).bind(
        nextPlanVersion, updatedAt, planId, creatorId, current.current_version, expectedVersion,
        nextPlanVersion, revision.name, revision.tier, revision.billingInterval,
        revision.priceMinor, revision.currency, benefitsJson, revision.trialDays,
      ),
    ])
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }

  if (Number(results[1]?.meta?.changes ?? 0) !== 1) {
    const raced = await readOwnedPlan()
    if (!raced) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404)
    if (raced.version === expectedVersion + 1 && raced.current_version === nextPlanVersion && matchesRevision(raced)) {
      return mapMembershipPlan(raced, true)
    }
    if (raced.version !== expectedVersion) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
    throw new SubscriptionRuntimeError('CONFLICT', 409)
  }

  const revised = await readOwnedPlan()
  if (
    !revised ||
    revised.current_version !== nextPlanVersion ||
    revised.version !== expectedVersion + 1 ||
    !matchesRevision(revised)
  ) throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500)

  console.log(JSON.stringify({
    event: 'membership.plan.updated',
    operation: 'reviseMembershipPlan',
    planId,
    creatorId,
    previousPlanVersion: current.current_version,
    planVersion: revised.current_version,
    version: revised.version,
  }))
  return mapMembershipPlan(revised, false)
}


/** Pause/resume new sales or permanently retire a paused plan with lifecycle CAS; existing subscribers keep their accepted plan_version. */
export async function transitionMembershipPlanLifecycle(
  db: D1Database, verifiedCreatorId: string, planIdInput: string, ifMatchInput: string | null,
  action: 'pause' | 'resume' | 'retire',
): Promise<ReturnType<typeof mapMembershipPlan>> {
  const creatorId = validatePrincipal(verifiedCreatorId)
  const planId = ensureId(planIdInput)
  const expectedVersion = planVersionFromEtag(validateIfMatch(ifMatchInput))
  if (action !== 'pause' && action !== 'resume' && action !== 'retire') throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  const target = action === 'pause'
    ? { status: 'PAUSED' as const, visibility: 'PRIVATE' as const, fromStatus: 'ACTIVE' as const, fromVisibility: 'PUBLIC' as const }
    : action === 'resume'
      ? { status: 'ACTIVE' as const, visibility: 'PUBLIC' as const, fromStatus: 'PAUSED' as const, fromVisibility: 'PRIVATE' as const }
      : { status: 'RETIRED' as const, visibility: 'PRIVATE' as const, fromStatus: 'PAUSED' as const, fromVisibility: 'PRIVATE' as const }
  const readOwnedPlan = async (): Promise<MembershipPlanStoredRow | null> =>
    db.prepare(
      'SELECT p.plan_id, p.owner_id, p.current_version, p.status, p.visibility, p.version, p.created_at, p.updated_at, ' +
      'v.name, v.tier, v.billing_interval, v.price_minor, v.currency, v.benefits_json ' +
      'FROM membership_plans AS p INNER JOIN membership_plan_versions AS v ' +
      'ON v.plan_id = p.plan_id AND v.plan_version = p.current_version ' +
      "WHERE p.plan_id = ? AND p.owner_type = 'CREATOR' AND p.owner_id = ? LIMIT 1",
    ).bind(planId, creatorId).first<MembershipPlanStoredRow>()
  const current = await readOwnedPlan()
  if (!current) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404)
  // Exact retries of a completed retirement converge without reopening the plan.
  if (current.version !== expectedVersion) {
    if (current.version === expectedVersion + 1 && current.status === target.status && current.visibility === target.visibility) {
      return mapMembershipPlan(current, true)
    }
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  }
  if (current.status === 'RETIRED') {
    if (action === 'retire') return mapMembershipPlan(current, true)
    throw new SubscriptionRuntimeError('INVALID_STATE', 409)
  }
  if (current.status === target.status && current.visibility === target.visibility) return mapMembershipPlan(current, true)
  if (current.status !== target.fromStatus || current.visibility !== target.fromVisibility) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409)
  }
  const updatedAt = nextUpdatedAt(current.updated_at)
  let updated: { meta?: { changes?: number } }
  try {
    updated = await db.prepare(
      'UPDATE membership_plans SET status = ?, visibility = ?, updated_at = ?, version = version + 1 ' +
      "WHERE plan_id = ? AND owner_type = 'CREATOR' AND owner_id = ? AND version = ? " +
      'AND status = ? AND visibility = ? AND EXISTS (' +
      'SELECT 1 FROM membership_plan_versions v WHERE v.plan_id = membership_plans.plan_id ' +
      'AND v.plan_version = membership_plans.current_version)',
    ).bind(target.status, target.visibility, updatedAt, planId, creatorId, expectedVersion, target.fromStatus, target.fromVisibility).run()
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  if (Number(updated.meta?.changes ?? 0) !== 1) {
    const raced = await readOwnedPlan()
    if (!raced) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404)
    if (raced.version === expectedVersion + 1 && raced.status === target.status && raced.visibility === target.visibility) {
      return mapMembershipPlan(raced, true)
    }
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  }
  const transitioned = await readOwnedPlan()
  if (!transitioned || transitioned.status !== target.status || transitioned.visibility !== target.visibility ||
      transitioned.version !== expectedVersion + 1 || transitioned.current_version !== current.current_version) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500)
  }
  console.log(JSON.stringify({
    event: action === 'pause' ? 'membership.plan.paused' : action === 'resume' ? 'membership.plan.activated' : 'membership.plan.retired',
    operation: 'transitionMembershipPlanLifecycle', action, planId, creatorId,
    planVersion: transitioned.current_version, version: transitioned.version,
  }))
  return mapMembershipPlan(transitioned, false)
}

/** Owner-scoped plan list for the authenticated creator, including private drafts. */
export async function listCreatorMembershipPlans(
  db: D1Database,
  verifiedCreatorId: string,
  limit = 20,
  cursorValue: string | null = null,
): Promise<{
  docs: ReturnType<typeof mapMembershipPlan>[]
  limit: number
  nextCursor: string | null
  hasMore: boolean
}> {
  const creatorId = validatePrincipal(verifiedCreatorId)
  const safeLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 20
  const cursor = decodePlanListCursor(cursorValue)
  const baseSql =
    'SELECT p.plan_id, p.owner_id, p.current_version, p.status, p.visibility, p.version, p.created_at, p.updated_at, ' +
    'v.name, v.tier, v.billing_interval, v.price_minor, v.currency, v.benefits_json ' +
    'FROM membership_plans AS p INNER JOIN membership_plan_versions AS v ' +
    'ON v.plan_id = p.plan_id AND v.plan_version = p.current_version ' +
    "WHERE p.owner_type = 'CREATOR' AND p.owner_id = ? "
  const statement = cursor
    ? db.prepare(baseSql + 'AND (p.created_at < ? OR (p.created_at = ? AND p.plan_id < ?)) ORDER BY p.created_at DESC, p.plan_id DESC LIMIT ?')
      .bind(creatorId, cursor.createdAt, cursor.createdAt, cursor.planId, safeLimit + 1)
    : db.prepare(baseSql + 'ORDER BY p.created_at DESC, p.plan_id DESC LIMIT ?').bind(creatorId, safeLimit + 1)
  const rows = await statement.all<MembershipPlanStoredRow>()
  const candidates = rows.results ?? []
  const hasMore = candidates.length > safeLimit
  const page = candidates.slice(0, safeLimit)
  const last = page.at(-1)
  return {
    docs: page.map((row) => mapMembershipPlan(row)),
    limit: safeLimit,
    hasMore,
    nextCursor: hasMore && last ? encodePlanListCursor({ createdAt: last.created_at, planId: last.plan_id }) : null,
  }
}

const RESOLVABLE_MEMBERSHIP_PLAN_ID_PATTERN = /^plan_[a-f0-9]{64}$/;

/**
 * Resolve public, active creator membership offers from their authoritative
 * D1-01 plan + immutable current-version rows. This is read-only and deliberately
 * does not create an order, contact a payment provider, or grant an entitlement.
 */
export async function resolvePurchasableMembershipPlanOffers(
  db: D1Database,
  planIds: readonly string[],
): Promise<Array<ReturnType<typeof mapMembershipPlan>>> {
  if (!Array.isArray(planIds) || planIds.length < 1 || planIds.length > 50) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }

  const seen = new Set<string>();
  for (const planId of planIds as readonly unknown[]) {
    if (
      typeof planId !== 'string' ||
      !RESOLVABLE_MEMBERSHIP_PLAN_ID_PATTERN.test(planId) ||
      planId.trim() !== planId
    ) {
      throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
    }
    if (seen.has(planId)) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
    seen.add(planId);
  }

  const placeholders = planIds.map(() => '?').join(', ');
  let result: D1Result<MembershipPlanStoredRow>;
  try {
    result = await db.prepare(
      'SELECT p.plan_id, p.owner_id, p.current_version, p.status, p.visibility, p.version, p.created_at, p.updated_at, ' +
      'v.name, v.tier, v.billing_interval, v.price_minor, v.currency, v.benefits_json ' +
      'FROM membership_plans AS p ' +
      'INNER JOIN membership_plan_versions AS v ON v.plan_id = p.plan_id AND v.plan_version = p.current_version ' +
      "WHERE p.owner_type = 'CREATOR' AND p.status = 'ACTIVE' AND p.visibility = 'PUBLIC' " +
      'AND p.plan_id IN (' + placeholders + ')',
    ).bind(...planIds).all<MembershipPlanStoredRow>();
  } catch {
    // Keep D1/schema failures inside the admitted service error contract. The
    // caller must not log or return provider/database exception details.
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }

  const rows: unknown = result.results ?? [];
  if (!Array.isArray(rows) || rows.length > planIds.length) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  }

  const mappedById = new Map<string, ReturnType<typeof mapMembershipPlan>>();
  for (const candidate of rows as unknown[]) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
    }
    const row = candidate as MembershipPlanStoredRow;
    if (
      typeof row.plan_id !== 'string' ||
      !RESOLVABLE_MEMBERSHIP_PLAN_ID_PATTERN.test(row.plan_id) ||
      !seen.has(row.plan_id) ||
      mappedById.has(row.plan_id) ||
      typeof row.owner_id !== 'string' ||
      row.owner_id.trim() !== row.owner_id ||
      row.owner_id.length < 1 ||
      row.owner_id.length > MAX_ID ||
      row.status !== 'ACTIVE' ||
      row.visibility !== 'PUBLIC'
    ) {
      throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
    }
    mappedById.set(row.plan_id, mapMembershipPlan(row));
  }

  // Do not disclose whether an unavailable reference is private, draft, retired,
  // belongs to a non-creator owner, or simply does not exist.
  if (mappedById.size !== planIds.length) {
    throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
  }

  return planIds.map((planId) => {
    const plan = mappedById.get(planId);
    if (!plan) throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
    return plan;
  });
}

