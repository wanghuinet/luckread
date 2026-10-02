/// <reference types="@cloudflare/workers-types" />

export type SubscriptionStatus = 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELED' | 'EXPIRED'

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

export const validateIfMatch = (value: string | null): string => {
  const normalized = value?.trim() ?? ''
  if (!normalized || normalized.length > 256) {
    throw new SubscriptionRuntimeError('PRECONDITION_REQUIRED', 428)
  }
  if (normalized === '*') throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  return normalized
}

export const etagForUpdatedAt = (updatedAt: string): string => '"lr-' + updatedAt + '"'

const updatedAtFromEtag = (etag: string): string => {
  const match = /^"lr-(.+)"$/.exec(etag)
  if (!match?.[1]) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  return match[1]
}

const nowIso = () => new Date().toISOString()

const subscriptionIdFromIdempotency = async (subscriberId: string, idempotencyKey: string): Promise<string> => {
  const material = new TextEncoder().encode('subscription-create\\0' + subscriberId + '\\0' + idempotencyKey)
  const digest = await crypto.subtle.digest('SHA-256', material)
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return 'sub_' + hex
}

const toPublic = (row: SubscriptionRow) => ({
  subscriptionId: row.subscription_id
  subscriberId: row.subscriber_id
  planId: row.plan_id
  planVersion: row.plan_version
  creatorId: row.creator_id
  status: row.status
  startedAt: row.started_at
  currentPeriodStart: row.current_period_start
  currentPeriodEnd: row.current_period_end
  cancelAt: row.cancel_at
  createdAt: row.created_at
  updatedAt: row.updated_at
  etag: etagForUpdatedAt(row.updated_at),
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
  const existing = await db.prepare('SELECT * FROM membership_subscriptions WHERE subscription_id = ? LIMIT 1').bind(subscriptionId).first<SubscriptionRow>()
  if (existing) {
    if (existing.subscriber_id !== subscriber || existing.plan_id !== planId) throw new SubscriptionRuntimeError('CONFLICT', 409)
    return toPublic(existing)
  }
  const now = nowIso()
  try {
    await db.prepare('INSERT INTO membership_subscriptions (subscription_id, subscriber_id, plan_id, plan_version, creator_id, status, started_at, current_period_start, current_period_end, cancel_at, entitlement_snapshot_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(subscriptionId, subscriber, planId, 1, null, 'PENDING', now, now, now, null, null, now, now).run()
  } catch (error) {
    if (!(error instanceof Error) || !error.message.toLowerCase().includes('unique')) throw error
  }
  const row = await readSubscriptionRow(db, subscriptionId, subscriber)
  console.log(JSON.stringify({ event: 'membership.subscription.created', operation: 'createSubscription', subscriptionId: row.subscription_id, subscriberId: row.subscriber_id, status: row.status }))
  return toPublic(row)
}

export async function getSubscription(db: D1Database, subscriberId: string, subscriptionId: string): Promise<ReturnType<typeof toPublic>> {
  return toPublic(await readSubscriptionRow(db, subscriptionId, validatePrincipal(subscriberId)))
}

const transitionTargets: Record<'cancel' | 'pause' | 'resume', SubscriptionStatus[]> = { cancel: ['ACTIVE', 'PAST_DUE', 'PAUSED'], pause: ['ACTIVE'], resume: ['PAUSED'] }
const nextState = (operation: 'cancel' | 'pause' | 'resume'): SubscriptionStatus => ({ cancel: 'CANCELED', pause: 'PAUSED', resume: 'ACTIVE' })[operation]

export async function transitionSubscription(db: D1Database, subscriberId: string, subscriptionId: string, operation: 'cancel' | 'pause' | 'resume', ifMatch: string): Promise<ReturnType<typeof toPublic>> {
  const subscriber = validatePrincipal(subscriberId)
  const etag = validateIfMatch(ifMatch)
  const expectedUpdatedAt = updatedAtFromEtag(etag)
  const row = await readSubscriptionRow(db, subscriptionId, subscriber)
  if (etagForUpdatedAt(row.updated_at) !== etag) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  if (!transitionTargets[operation].includes(row.status)) throw new SubscriptionRuntimeError('INVALID_STATE', 409)
  const updatedAt = nowIso()
  const result = await db.prepare('UPDATE membership_subscriptions SET status = ?, cancel_at = ?, updated_at = ? WHERE subscription_id = ? AND subscriber_id = ? AND updated_at = ?')
    .bind(nextState(operation), operation === 'cancel' ? updatedAt : row.cancel_at, updatedAt, row.subscription_id, subscriber, expectedUpdatedAt).run()
  if (Number(result.meta?.changes ?? 0) !== 1) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  const updated = await readSubscriptionRow(db, row.subscription_id, subscriber)
  console.log(JSON.stringify({ event: 'membership.subscription.transitioned', operation: operation + 'Subscription', subscriptionId: updated.subscription_id, subscriberId: updated.subscriber_id, from: row.status, to: updated.status }))
  return toPublic(updated)
}

export async function changeSubscriptionPlan(db: D1Database, subscriberId: string, subscriptionId: string, planId: string, ifMatch: string): Promise<ReturnType<typeof toPublic>> {
  const subscriber = validatePrincipal(subscriberId)
  const nextPlanId = ensureId(planId)
  const etag = validateIfMatch(ifMatch)
  const expectedUpdatedAt = updatedAtFromEtag(etag)
  const row = await readSubscriptionRow(db, subscriptionId, subscriber)
  if (etagForUpdatedAt(row.updated_at) !== etag) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  if (!['ACTIVE', 'PAUSED', 'PAST_DUE'].includes(row.status)) throw new SubscriptionRuntimeError('INVALID_STATE', 409)
  if (row.plan_id === nextPlanId) return toPublic(row)
  const updatedAt = nowIso()
  const result = await db.prepare('UPDATE membership_subscriptions SET plan_id = ?, plan_version = ?, updated_at = ? WHERE subscription_id = ? AND subscriber_id = ? AND updated_at = ?')
    .bind(nextPlanId, 1, updatedAt, row.subscription_id, subscriber, expectedUpdatedAt).run()
  if (Number(result.meta?.changes ?? 0) !== 1) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  const updated = await readSubscriptionRow(db, row.subscription_id, subscriber)
  console.log(JSON.stringify({ event: 'membership.subscription.plan_changed', operation: 'changeSubscriptionPlan', subscriptionId: updated.subscription_id, subscriberId: updated.subscriber_id, previousPlanId: row.plan_id, planId: updated.plan_id }))
  return toPublic(updated)
}
