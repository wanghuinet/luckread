import type { D1Database } from '@cloudflare/workers-types'
import {
  MembershipAccessStateError,
  type CreateSubscriptionInput,
  type TransitionInput,
  validateCreateSubscription,
  validateTransition,
} from './access-state-transition.js'

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000
const now = () => new Date().toISOString()

type IdempotencyRow = {
  ownerUserId: string
  requestHash: string
  status: 'IN_PROGRESS' | 'COMPLETED'
  responseStatus: number | null
  responseJson: string | null
  expiresAt: string
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    )
  }
  return value
}

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

const requestHash = async (operationId: string, input: unknown): Promise<string> =>
  sha256Hex(JSON.stringify(canonicalize({ operationId, input })))

const readIdempotency = async (
  db: D1Database,
  ownerUserId: string,
  operationId: string,
  idempotencyKey: string,
  nowIso: string,
): Promise<IdempotencyRow | null> => {
  const row = await db.prepare(
    `SELECT owner_user_id AS ownerUserId,
            request_hash AS requestHash,
            status,
            response_status AS responseStatus,
            response_json AS responseJson,
            expires_at AS expiresAt
       FROM membership_mutation_idempotency
      WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ?
      ORDER BY created_at DESC
      LIMIT 1`,
  ).bind(ownerUserId, operationId, idempotencyKey).first<IdempotencyRow>()

  if (!row || Date.parse(row.expiresAt) <= Date.parse(nowIso)) return null
  return row
}

const parseReplay = (
  row: IdempotencyRow,
  ownerUserId: string,
  expectedHash: string,
): unknown => {
  if (row.ownerUserId !== ownerUserId || row.requestHash !== expectedHash) {
    throw new MembershipAccessStateError('IDEMPOTENCY_KEY_REUSE_CONFLICT')
  }
  if (row.status === 'IN_PROGRESS') {
    throw new MembershipAccessStateError('IDEMPOTENCY_IN_PROGRESS')
  }
  if (!row.responseJson || !Number.isSafeInteger(row.responseStatus)) {
    throw new MembershipAccessStateError('IDEMPOTENCY_REPLAY_CORRUPTED')
  }
  try {
    return JSON.parse(row.responseJson)
  } catch {
    throw new MembershipAccessStateError('IDEMPOTENCY_REPLAY_CORRUPTED')
  }
}

const idempotencyInsert = (
  db: D1Database,
  ownerUserId: string,
  operationId: string,
  idempotencyKey: string,
  requestHashValue: string,
  responseStatus: number,
  response: unknown,
  nowIso: string,
  expiresAt: string,
) => db.prepare(
  `INSERT INTO membership_mutation_idempotency
    (id, owner_user_id, operation_id, idempotency_key, request_hash, status, response_status, response_json, created_at, expires_at)
   VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?)`,
).bind(
  crypto.randomUUID(),
  ownerUserId,
  operationId,
  idempotencyKey,
  requestHashValue,
  responseStatus,
  JSON.stringify(response),
  nowIso,
  expiresAt,
)

const idempotencyInsertFromGuard = (
  db: D1Database,
  ownerUserId: string,
  operationId: string,
  idempotencyKey: string,
  requestHashValue: string,
  responseStatus: number,
  subscriptionId: string,
  status: string,
  version: number,
  nowIso: string,
  expiresAt: string,
) => db.prepare(
  `INSERT INTO membership_mutation_idempotency
    (id, owner_user_id, operation_id, idempotency_key, request_hash, status, response_status, response_json, created_at, expires_at)
   SELECT ?, ?, ?, ?, ?, 'COMPLETED', ?, json_object(
      'subscriptionId', ?,
      'status', ?,
      'version', ?,
      'entitlementChanged', entitlement_changed
   ), ?, ?
     FROM membership_txn_guard
    WHERE id = 1 AND successful = 1`,
).bind(
  crypto.randomUUID(),
  ownerUserId,
  operationId,
  idempotencyKey,
  requestHashValue,
  responseStatus,
  subscriptionId,
  status,
  version,
  nowIso,
  expiresAt,
)

const expireIdempotency = (
  db: D1Database,
  ownerUserId: string,
  operationId: string,
  idempotencyKey: string,
  nowIso: string,
) => db.prepare(
  `DELETE FROM membership_mutation_idempotency
    WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ? AND expires_at <= ?`,
).bind(ownerUserId, operationId, idempotencyKey, nowIso)

const txnGuard = (db: D1Database) => db.prepare(
  `INSERT OR REPLACE INTO membership_txn_guard(id, successful, entitlement_changed)
   VALUES (1, changes(), 0)`,
)

const txnEntitlementGuard = (db: D1Database) => db.prepare(
  `UPDATE membership_txn_guard
      SET entitlement_changed = changes()
    WHERE id = 1`,
)

const isUniqueConstraint = (error: unknown): boolean =>
  /unique constraint|UNIQUE constraint|constraint failed/i.test(
    error instanceof Error ? error.message : String(error),
  )

const isTxnGuardFailure = (error: unknown): boolean =>
  /membership_txn_guard|CHECK constraint failed/i.test(
    error instanceof Error ? error.message : String(error),
  )

const nowPlusTtl = (nowDate: Date): string =>
  new Date(nowDate.getTime() + IDEMPOTENCY_TTL_MS).toISOString()

export async function createSubscription(
  db: D1Database,
  input: CreateSubscriptionInput,
): Promise<{ subscriptionId: string; created: boolean; version: number }> {
  validateCreateSubscription(input)

  const operationId = 'createSubscription'
  const current = new Date()
  const nowIso = current.toISOString()
  const hash = await requestHash(operationId, {
    subscriberId: input.subscriberId,
    planId: input.planId,
    planVersion: input.planVersion,
    startedAt: input.startedAt,
    currentPeriodStart: input.currentPeriodStart,
    currentPeriodEnd: input.currentPeriodEnd,
  })
  const existingIdempotency = await readIdempotency(
    db,
    input.actorUserId,
    operationId,
    input.idempotencyKey,
    nowIso,
  )
  if (existingIdempotency) {
    const replay = parseReplay(existingIdempotency, input.actorUserId, hash) as {
      subscriptionId?: unknown
      created?: unknown
      version?: unknown
    }
    if (
      replay &&
      replay.subscriptionId === input.subscriptionId &&
      typeof replay.created === 'boolean' &&
      Number.isSafeInteger(replay.version) &&
      replay.version >= 1
    ) {
      return replay as { subscriptionId: string; created: boolean; version: number }
    }
    throw new MembershipAccessStateError('IDEMPOTENCY_REPLAY_CORRUPTED')
  }

  const expiresAt = nowPlusTtl(current)
  const response = {
    subscriptionId: input.subscriptionId,
    created: true,
    version: 1,
  }

  try {
    await db.batch([
      expireIdempotency(db, input.actorUserId, operationId, input.idempotencyKey, nowIso),
      idempotencyInsert(
        db,
        input.actorUserId,
        operationId,
        input.idempotencyKey,
        hash,
        201,
        response,
        nowIso,
        expiresAt,
      ),
      db.prepare(
        `INSERT INTO membership_subscriptions
          (subscription_id, subscriber_id, plan_id, plan_version, status, version, started_at, current_period_start, current_period_end, cancel_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'PENDING', 1, ?, ?, ?, NULL, ?, ?)`,
      ).bind(
        input.subscriptionId,
        input.subscriberId,
        input.planId,
        input.planVersion,
        input.startedAt,
        input.currentPeriodStart,
        input.currentPeriodEnd,
        nowIso,
        nowIso,
      ),
    ])
    return response
  } catch (error) {
    const replayRow = await readIdempotency(
      db,
      input.actorUserId,
      operationId,
      input.idempotencyKey,
      new Date().toISOString(),
    )
    if (replayRow) {
      const replay = parseReplay(replayRow, input.actorUserId, hash)
      return replay as { subscriptionId: string; created: boolean; version: number }
    }
    if (isUniqueConstraint(error)) {
      throw new MembershipAccessStateError('SUBSCRIPTION_ID_CONFLICT')
    }
    throw new MembershipAccessStateError('SERVICE_UNAVAILABLE')
  }
}

export async function transitionSubscription(
  db: D1Database,
  input: TransitionInput,
): Promise<{ subscriptionId: string; status: string; version: number; entitlementChanged: boolean }> {
  validateTransition(input)

  const operationId = 'transitionSubscription'
  const current = new Date()
  const nowIso = current.toISOString()
  const expiresAt = nowPlusTtl(current)
  const hash = await requestHash(operationId, {
    subscriptionId: input.subscriptionId,
    from: input.from,
    to: input.to,
    expectedVersion: input.expectedVersion,
    actor: input.actor,
    entitlementAction: input.entitlementAction,
    entitlementId: input.entitlementId ?? null,
    entitlementType: input.entitlementType ?? null,
    scopeType: input.scopeType ?? null,
    scopeId: input.scopeId ?? null,
    sourcePlanVersion: input.sourcePlanVersion ?? null,
    effectiveAt: input.effectiveAt ?? null,
    expiresAt: input.expiresAt ?? null,
  })

  const existingIdempotency = await readIdempotency(
    db,
    input.actorUserId,
    operationId,
    input.idempotencyKey,
    nowIso,
  )
  if (existingIdempotency) {
    return parseReplay(existingIdempotency, input.actorUserId, hash) as {
      subscriptionId: string; status: string; version: number; entitlementChanged: boolean
    }
  }

  const nextVersion = input.expectedVersion + 1
  const timestamp = nowIso
  const statements = [
    expireIdempotency(db, input.actorUserId, operationId, input.idempotencyKey, timestamp),
    db.prepare(
      `UPDATE membership_subscriptions
          SET status = ?, version = version + 1, updated_at = ?, cancel_at = CASE WHEN ? IN ('CANCELED','EXPIRED') THEN ? ELSE cancel_at END
        WHERE subscription_id = ?
          AND status = ?
          AND version = ?
          AND (? != 'user' OR subscriber_id = ?)`,
    ).bind(
      input.to,
      timestamp,
      input.to,
      input.to === 'CANCELED' ? timestamp : null,
      input.subscriptionId,
      input.from,
      input.expectedVersion,
      input.actor,
      input.actorUserId,
    ),
    txnGuard(db),
  ]

  if (input.entitlementAction === 'GRANT') {
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO membership_entitlement_grants
          (entitlement_id, subscription_id, entitlement_type, scope_type, scope_id, status, effective_at, expires_at, source_plan_version, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM membership_subscriptions
              WHERE subscription_id = ? AND status = 'ACTIVE' AND version = ?
           )`,
      ).bind(
        input.entitlementId,
        input.subscriptionId,
        input.entitlementType,
        input.scopeType,
        input.scopeId,
        input.effectiveAt ?? timestamp,
        input.expiresAt ?? null,
        input.sourcePlanVersion,
        timestamp,
        timestamp,
        input.subscriptionId,
        nextVersion,
      ),
    )
  }

  if (input.entitlementAction === 'REVOKE') {
    statements.push(
      db.prepare(
        `UPDATE membership_entitlement_grants
            SET status = 'REVOKED', updated_at = ?
          WHERE subscription_id = ?
            AND status = 'ACTIVE'
            AND EXISTS (
              SELECT 1 FROM membership_subscriptions
               WHERE subscription_id = ? AND status = ? AND version = ?
            )`,
      ).bind(
        timestamp,
        input.subscriptionId,
        input.subscriptionId,
        input.to,
        nextVersion,
      ),
    )
  }

  if (input.entitlementAction !== 'NONE') {
    statements.push(txnEntitlementGuard(db))
  }

  const guardIndex = 2
  const entitlementStatementIndex = input.entitlementAction === 'NONE' ? -1 : 3
  const resultIdempotency = idempotencyInsertFromGuard(
    db,
    input.actorUserId,
    operationId,
    input.idempotencyKey,
    hash,
    200,
    input.subscriptionId,
    input.to,
    nextVersion,
    timestamp,
    expiresAt,
  )

  try {
    const results = await db.batch([
      ...statements,
      resultIdempotency,
    ])
    if ((results[guardIndex]?.meta?.changes ?? 0) !== 1) {
      throw new MembershipAccessStateError('VERSION_CONFLICT')
    }

    const entitlementChanged =
      entitlementStatementIndex >= 0
        ? (results[entitlementStatementIndex]?.meta?.changes ?? 0) > 0
        : false

    return {
      subscriptionId: input.subscriptionId,
      status: input.to,
      version: nextVersion,
      entitlementChanged,
    }
  } catch (error) {
    const replayRow = await readIdempotency(
      db,
      input.actorUserId,
      operationId,
      input.idempotencyKey,
      new Date().toISOString(),
    )
    if (replayRow) {
      return parseReplay(replayRow, input.actorUserId, hash) as {
        subscriptionId: string; status: string; version: number; entitlementChanged: boolean
      }
    }
    if (error instanceof MembershipAccessStateError) throw error
    if (isTxnGuardFailure(error)) throw new MembershipAccessStateError('VERSION_CONFLICT')
    if (isUniqueConstraint(error)) throw new MembershipAccessStateError('IDEMPOTENCY_IN_PROGRESS')
    throw new MembershipAccessStateError('SERVICE_UNAVAILABLE')
  }
}
