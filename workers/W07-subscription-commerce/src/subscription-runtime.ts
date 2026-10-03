/// <reference types="@cloudflare/workers-types" />

export type SubscriptionStatus = 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELED' | 'EXPIRED'

export type SubscriptionRow = {
  subscription_id: string
  subscriber_id: string
  version: number
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
const MAX_CURSOR = 1024
const CURSOR_TTL_MS = 24 * 60 * 60 * 1000

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

const representationHash = (value: string): string => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

const publicRepresentation = (row: SubscriptionRow): string => JSON.stringify({
  subscriptionId: row.subscription_id,
  subscriberId: row.subscriber_id,
  version: row.version,
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
})

export const etagForSubscription = (row: SubscriptionRow): string =>
  '"v' + String(row.version) + '-r1-' + representationHash(publicRepresentation(row)) + '"'

const expectedVersionFromEtag = (etag: string): number => {
  const match = /^"v([1-9]\d*)-r1-[A-Za-z0-9_-]{1,64}"$/.exec(etag)
  if (!match?.[1]) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  const version = Number(match[1])
  if (!Number.isSafeInteger(version) || version < 1) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  return version
}

const nowIso = () => new Date().toISOString()

const nextUpdatedAt = (previous: string): string => {
  const previousMs = Date.parse(previous)
  const nowMs = Date.now()
  const nextMs = Number.isFinite(previousMs) ? Math.max(nowMs, previousMs + 1) : nowMs
  return new Date(nextMs).toISOString()
}

const nextSubscriptionVersion = (version: number): number => {
  if (!Number.isSafeInteger(version) || version < 1 || version >= Number.MAX_SAFE_INTEGER) {
    throw new SubscriptionRuntimeError('CONFLICT', 409)
  }
  return version + 1
}

const encodeCursorBytes = (value: string): string => {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const decodeCursorBytes = (value: string): string => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  try {
    return new TextDecoder().decode(bytes)
  } catch {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
}

type SubscriptionCursor = {
  v: 1
  endpoint: 'membership.subscriptions'
  scope: string
  createdAt: string
  id: string
  exp: number
}

export const encodeSubscriptionCursor = (cursor: Pick<SubscriptionCursor, 'scope' | 'createdAt' | 'id' | 'exp'>): string =>
  encodeCursorBytes(JSON.stringify({ v: 1, endpoint: 'membership.subscriptions', ...cursor }))

export const decodeSubscriptionCursor = (value: string): SubscriptionCursor => {
  if (!value || value.length > MAX_CURSOR) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeCursorBytes(value))
  } catch {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)

  const data = parsed as Partial<SubscriptionCursor>
  if (
    data.v !== 1 ||
    data.endpoint !== 'membership.subscriptions' ||
    typeof data.scope !== 'string' ||
    !data.scope ||
    typeof data.createdAt !== 'string' ||
    !data.createdAt.trim() ||
    !Number.isFinite(Date.parse(data.createdAt)) ||
    typeof data.id !== 'string' ||
    !data.id.trim() ||
    data.id.length > MAX_ID ||
    typeof data.exp !== 'number' ||
    !Number.isSafeInteger(data.exp)
  ) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }

  if (data.exp <= Date.now()) throw new SubscriptionRuntimeError('CURSOR_EXPIRED', 400)
  if (data.exp > Date.now() + CURSOR_TTL_MS) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)

  return {
    v: 1,
    endpoint: 'membership.subscriptions',
    scope: data.scope.trim(),
    createdAt: data.createdAt.trim(),
    id: data.id.trim(),
    exp: data.exp,
  }
}

const subscriptionCursorScope = (subscriberId: string): string =>
  representationHash('membership.subscriptions\0' + subscriberId + '\0created_at DESC,subscription_id DESC')

const subscriptionIdFromIdempotency = async (subscriberId: string, idempotencyKey: string): Promise<string> => {
  const material = new TextEncoder().encode('subscription-create\0' + subscriberId + '\0' + idempotencyKey)
  const digest = await crypto.subtle.digest('SHA-256', material)
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return 'sub_' + hex
}

const toPublic = (row: SubscriptionRow) => ({
  subscriptionId: row.subscription_id,
  subscriberId: row.subscriber_id,
  version: row.version,
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
  etag: etagForSubscription(row),
})

const readSubscriptionRow = async (db: D1Database, subscriptionId: string, subscriberId?: string): Promise<SubscriptionRow> => {
  const id = ensureId(subscriptionId)
  const sql = subscriberId === undefined
    ? 'SELECT * FROM membership_subscriptions WHERE subscription_id = ? LIMIT 1'
    : 'SELECT * FROM membership_subscriptions WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1'
  const args = subscriberId === undefined ? [id] : [id, ensureId(subscriberId)]
  const row = await db.prepare(sql).bind(...args).first<SubscriptionRow>()
  if (!row) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404)
  return row
}

export async function createSubscription(
  db: D1Database,
  subscriberId: string,
  input: { planId: string; idempotencyKey: string },
): Promise<ReturnType<typeof toPublic>> {
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
    await db.prepare(
      'INSERT INTO membership_subscriptions (subscription_id, subscriber_id, version, plan_id, plan_version, creator_id, status, started_at, current_period_start, current_period_end, cancel_at, entitlement_snapshot_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(subscriptionId, subscriber, 1, planId, 1, null, 'PENDING', now, now, now, null, null, now, now).run()
  } catch (error) {
    if (!(error instanceof Error) || !error.message.toLowerCase().includes('unique')) throw error
  }

  const row = await readSubscriptionRow(db, subscriptionId, subscriber)
  console.log(JSON.stringify({
    event: 'membership.subscription.created',
    operation: 'createSubscription',
    subscriptionId: row.subscription_id,
    subscriberId: row.subscriber_id,
    status: row.status,
    version: row.version,
  }))
  return toPublic(row)
}

export async function getSubscription(
  db: D1Database,
  subscriberId: string,
  subscriptionId: string,
): Promise<ReturnType<typeof toPublic>> {
  return toPublic(await readSubscriptionRow(db, subscriptionId, validatePrincipal(subscriberId)))
}

export async function listSubscriptions(
  db: D1Database,
  subscriberId: string,
  cursor: string | null = null,
  limit = 20,
): Promise<{
  items: ReturnType<typeof toPublic>[]
  limit: number
  nextCursor: string | null
  hasMore: boolean
}> {
  const subscriber = validatePrincipal(subscriberId)
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 50) : 20
  const scope = subscriptionCursorScope(subscriber)
  const decodedCursor = cursor ? decodeSubscriptionCursor(cursor) : null

  if (decodedCursor && decodedCursor.scope !== scope) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }

  let statement: D1PreparedStatement
  if (decodedCursor) {
    statement = db.prepare(
      'SELECT * FROM membership_subscriptions WHERE subscriber_id = ? AND (created_at < ? OR (created_at = ? AND subscription_id < ?)) ORDER BY created_at DESC, subscription_id DESC LIMIT ?',
    ).bind(subscriber, decodedCursor.createdAt, decodedCursor.createdAt, decodedCursor.id, safeLimit + 1)
  } else {
    statement = db.prepare(
      'SELECT * FROM membership_subscriptions WHERE subscriber_id = ? ORDER BY created_at DESC, subscription_id DESC LIMIT ?',
    ).bind(subscriber, safeLimit + 1)
  }

  const rows = await statement.all<SubscriptionRow>()
  const rawRows = rows.results ?? []
  const pageRows = rawRows.slice(0, safeLimit)
  const items = pageRows.map(toPublic)
  const hasMore = rawRows.length > safeLimit
  const last = items.at(-1)

  return {
    items,
    limit: safeLimit,
    nextCursor: hasMore && last
      ? encodeSubscriptionCursor({
          scope,
          createdAt: last.createdAt,
          id: last.subscriptionId,
          exp: Date.now() + CURSOR_TTL_MS,
        })
      : null,
    hasMore,
  }
}

const transitionTargets: Record<'cancel' | 'pause' | 'resume', SubscriptionStatus[]> = {
  cancel: ['ACTIVE', 'PAST_DUE', 'PAUSED'],
  pause: ['ACTIVE'],
  resume: ['PAUSED'],
}
const nextStates: Record<'cancel' | 'pause' | 'resume', SubscriptionStatus> = {
  cancel: 'CANCELED',
  pause: 'PAUSED',
  resume: 'ACTIVE',
}

export async function transitionSubscription(
  db: D1Database,
  subscriberId: string,
  subscriptionId: string,
  operation: 'cancel' | 'pause' | 'resume',
  ifMatch: string,
): Promise<ReturnType<typeof toPublic>> {
  const subscriber = validatePrincipal(subscriberId)
  const etag = validateIfMatch(ifMatch)
  const expectedVersion = expectedVersionFromEtag(etag)
  const row = await readSubscriptionRow(db, subscriptionId, subscriber)
  if (row.version !== expectedVersion) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  if (!transitionTargets[operation].includes(row.status)) throw new SubscriptionRuntimeError('INVALID_STATE', 409)

  const version = nextSubscriptionVersion(row.version)
  const updatedAt = nextUpdatedAt(row.updated_at)
  const result = await db.prepare(
    'UPDATE membership_subscriptions SET status = ?, cancel_at = ?, version = ?, updated_at = ? WHERE subscription_id = ? AND subscriber_id = ? AND version = ?',
  ).bind(
    nextStates[operation],
    operation === 'cancel' ? updatedAt : row.cancel_at,
    version,
    updatedAt,
    row.subscription_id,
    subscriber,
    expectedVersion,
  ).run()

  if (Number(result.meta?.changes ?? 0) !== 1) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)

  const updated = await readSubscriptionRow(db, row.subscription_id, subscriber)
  console.log(JSON.stringify({
    event: 'membership.subscription.transitioned',
    operation: operation + 'Subscription',
    subscriptionId: updated.subscription_id,
    subscriberId: updated.subscriber_id,
    from: row.status,
    to: updated.status,
    version: updated.version,
  }))
  return toPublic(updated)
}

export async function changeSubscriptionPlan(
  db: D1Database,
  subscriberId: string,
  subscriptionId: string,
  planId: string,
  ifMatch: string,
): Promise<ReturnType<typeof toPublic>> {
  const subscriber = validatePrincipal(subscriberId)
  const nextPlanId = ensureId(planId)
  const etag = validateIfMatch(ifMatch)
  const expectedVersion = expectedVersionFromEtag(etag)
  const row = await readSubscriptionRow(db, subscriptionId, subscriber)
  if (row.version !== expectedVersion) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
  if (!['ACTIVE', 'PAUSED', 'PAST_DUE'].includes(row.status)) throw new SubscriptionRuntimeError('INVALID_STATE', 409)
  if (row.plan_id === nextPlanId) return toPublic(row)

  const version = nextSubscriptionVersion(row.version)
  const updatedAt = nextUpdatedAt(row.updated_at)
  const result = await db.prepare(
    'UPDATE membership_subscriptions SET plan_id = ?, plan_version = ?, version = ?, updated_at = ? WHERE subscription_id = ? AND subscriber_id = ? AND version = ?',
  ).bind(nextPlanId, 1, version, updatedAt, row.subscription_id, subscriber, expectedVersion).run()

  if (Number(result.meta?.changes ?? 0) !== 1) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)

  const updated = await readSubscriptionRow(db, row.subscription_id, subscriber)
  console.log(JSON.stringify({
    event: 'membership.subscription.plan_changed',
    operation: 'changeSubscriptionPlan',
    subscriptionId: updated.subscription_id,
    subscriberId: updated.subscriber_id,
    previousPlanId: row.plan_id,
    planId: updated.plan_id,
    version: updated.version,
  }))
  return toPublic(updated)
}
