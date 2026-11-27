import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js'
import type { W07WebhookPostgresClient, W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { SubscriptionRuntimeError, validatePrincipal } from './subscription-runtime.js'

export type SubscriptionLifecycleAction = 'cancel' | 'pause' | 'resume'

type LifecycleSubscriptionRow = {
  subscription_id: string
  subscriber_id: string
  status: string
  current_period_start: string
  current_period_end: string
  cancel_at: string | null
  pause_started_at: string | null
  pause_period_end_snapshot: string | null
  pause_remaining_seconds: number | null
  version: number
}

type LifecycleReceiptRow = {
  request_fingerprint: string
  expected_subscription_version: number
  result_status: string
  response_json: string
}

type LifecycleResponse = {
  subscriptionId: string
  status: string
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelAt: string | null
  version: number
  etag: string
  replayed: boolean
  pending?: boolean
  reason?: 'RENEWAL_IN_FLIGHT'
}

type LifecycleResult = {
  data: LifecycleResponse
  status: number
}

const canonicalNow = (value: Date): string => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
  return value.toISOString()
}

const parseExpectedVersion = (value: string | null): number => {
  const match = /^"lr-v([1-9]\d*)"$/.exec(value?.trim() ?? '')
  if (!match || !Number.isSafeInteger(Number(match[1]))) {
    throw new SubscriptionRuntimeError(value ? 'PRECONDITION_FAILED' : 'PRECONDITION_REQUIRED', value ? 412 : 428)
  }
  return Number(match[1])
}

const validateKey = (value: string | null): string => {
  const key = value ?? ''
  if (!key || key.length > 256 || key.trim() !== key || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new SubscriptionRuntimeError('PRECONDITION_REQUIRED', 428)
  }
  return key
}

const hash = async (value: string): Promise<string> =>
  sha256BytesToHex(new TextEncoder().encode(value))

const responseFromRow = (row: LifecycleSubscriptionRow, replayed = false): LifecycleResponse => ({
  subscriptionId: row.subscription_id,
  status: row.status,
  currentPeriodStart: row.current_period_start,
  currentPeriodEnd: row.current_period_end,
  cancelAt: row.cancel_at,
  version: row.version,
  etag: '"lr-v' + String(row.version) + '"',
  replayed,
})

const parseReceiptResponse = (value: string): LifecycleResponse => {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  return parsed as LifecycleResponse
}

async function readLifecycleSubscription(
  client: W07WebhookPostgresClient,
  subscriptionId: string,
  subscriberId: string,
): Promise<LifecycleSubscriptionRow | null> {
  const result = await client.query<LifecycleSubscriptionRow & Record<string, unknown>>(
    'SELECT subscription_id, subscriber_id, status, ' +
    "to_char(current_period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS current_period_start, " +
    "to_char(current_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS current_period_end, " +
    "CASE WHEN cancel_at IS NULL THEN NULL ELSE to_char(cancel_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') END AS cancel_at, " +
    "CASE WHEN pause_started_at IS NULL THEN NULL ELSE to_char(pause_started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') END AS pause_started_at, " +
    "CASE WHEN pause_period_end_snapshot IS NULL THEN NULL ELSE to_char(pause_period_end_snapshot AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') END AS pause_period_end_snapshot, " +
    'pause_remaining_seconds::double precision AS pause_remaining_seconds, version::double precision AS version ' +
    'FROM membership_subscriptions WHERE subscription_id = $1 AND subscriber_id = $2 FOR UPDATE',
    [subscriptionId, subscriberId],
  )
  return result.rows[0] ?? null
}

async function readReceipt(
  client: W07WebhookPostgresClient,
  subscriberId: string,
  idempotencyHash: string,
): Promise<LifecycleReceiptRow | null> {
  const result = await client.query<LifecycleReceiptRow & Record<string, unknown>>(
    'SELECT request_fingerprint, expected_subscription_version, result_status, response_json::text AS response_json ' +
    'FROM membership_subscription_lifecycle_operation_receipts ' +
    'WHERE subscriber_id = $1 AND idempotency_key_hash = $2 FOR UPDATE',
    [subscriberId, idempotencyHash],
  )
  return result.rows[0] ?? null
}

async function insertPendingReceipt(
  client: W07WebhookPostgresClient,
  input: {
    operationId: string
    subscriptionId: string
    subscriberId: string
    operation: string
    idempotencyHash: string
    fingerprint: string
    expectedVersion: number
    now: string
  },
): Promise<void> {
  await client.query(
    'INSERT INTO membership_subscription_lifecycle_operation_receipts ' +
    '(operation_id, subscription_id, subscriber_id, operation, idempotency_key_hash, request_fingerprint, ' +
    'expected_subscription_version, result_subscription_version, result_status, response_json, created_at, completed_at) ' +
    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING','{\"pending\":true}'::jsonb,$9::timestamptz,$9::timestamptz)",
    [
      input.operationId, input.subscriptionId, input.subscriberId, input.operation,
      input.idempotencyHash, input.fingerprint, input.expectedVersion,
      input.expectedVersion + 1, input.now,
    ],
  )
}

async function writeAudit(
  client: W07WebhookPostgresClient,
  input: {
    subscriptionId: string
    subscriberId: string
    operation: string
    fromStatus: string
    toStatus: string
    fromVersion: number
    toVersion: number
    now: string
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  await client.query(
    'INSERT INTO membership_subscription_lifecycle_audit ' +
    '(event_id, subscription_id, subscriber_id, operation, from_status, to_status, ' +
    'from_subscription_version, to_subscription_version, metadata_json, occurred_at) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::timestamptz)',
    [
      'evt_' + crypto.randomUUID(), input.subscriptionId, input.subscriberId,
      input.operation, input.fromStatus, input.toStatus, input.fromVersion,
      input.toVersion, JSON.stringify(input.metadata ?? {}), input.now,
    ],
  )
}

async function completeReceipt(
  client: W07WebhookPostgresClient,
  subscriberId: string,
  idempotencyHash: string,
  response: LifecycleResponse,
  now: string,
): Promise<void> {
  const result = await client.query(
    'UPDATE membership_subscription_lifecycle_operation_receipts SET result_subscription_version = $1, ' +
    'result_status = $2, response_json = $3::jsonb, completed_at = $4::timestamptz ' +
    "WHERE subscriber_id = $5 AND idempotency_key_hash = $6 AND result_status = 'PENDING'",
    [response.version, response.status, JSON.stringify(response), now, subscriberId, idempotencyHash],
  )
  if (result.rowCount !== 1) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
}

async function hasUnresolvedRenewal(
  financeStore: W07WebhookPostgresPool,
  subscriptionId: string,
): Promise<boolean> {
  try {
    const result = await financeStore.query<{ cycle_id: string } & Record<string, unknown>>(
      "SELECT cycle_id FROM subscription_renewal_cycles WHERE subscription_id = $1 AND (" +
      "state IN ('SUBMITTING','SUBMITTED','RECONCILIATION_REQUIRED') OR " +
      "(state = 'SUCCEEDED' AND subscription_sync_state = 'PENDING') OR " +
      "(state = 'FAILED' AND payment_id IS NOT NULL AND (provider_response_status IS NULL OR provider_response_status NOT IN ('failed','cancelled','expired','cancelled_post_capture')))) " +
      'ORDER BY updated_at DESC, cycle_id ASC LIMIT 1',
      [subscriptionId],
    )
    return result.rows.length > 0
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

async function beginLifecycleOperation(
  membershipStore: W07WebhookPostgresPool,
  input: {
    action: SubscriptionLifecycleAction
    subscriptionId: string
    subscriberId: string
    idempotencyHash: string
    operationId: string
    fingerprint: string
    expectedVersion: number
    now: string
  },
): Promise<{ row: LifecycleSubscriptionRow; pending: boolean; completed?: LifecycleResponse }> {
  const client = await membershipStore.connect()
  let transaction = false
  try {
    await client.query('BEGIN')
    transaction = true
    const existing = await readReceipt(client, input.subscriberId, input.idempotencyHash)
    if (existing) {
      if (existing.request_fingerprint !== input.fingerprint ||
          Number(existing.expected_subscription_version) !== input.expectedVersion) {
        throw new SubscriptionRuntimeError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 409)
      }
      if (existing.result_status !== 'PENDING') {
        const cached = parseReceiptResponse(existing.response_json)
        await client.query('COMMIT')
        transaction = false
        return {
          row: {
            subscription_id: cached.subscriptionId,
            subscriber_id: input.subscriberId,
            status: cached.status,
            current_period_start: cached.currentPeriodStart,
            current_period_end: cached.currentPeriodEnd,
            cancel_at: cached.cancelAt,
            pause_started_at: null,
            pause_period_end_snapshot: null,
            pause_remaining_seconds: null,
            version: cached.version,
          },
          pending: false,
          completed: { ...cached, replayed: true },
        }
      }
    }

    const row = await readLifecycleSubscription(client, input.subscriptionId, input.subscriberId)
    if (!row) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404)
    if (!existing && row.status === 'PAUSING') {
      throw new SubscriptionRuntimeError('CONFLICT', 409)
    }
    if (!existing && row.version !== input.expectedVersion) {
      throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
    }
    if (!existing) {
      await insertPendingReceipt(client, {
        operationId: input.operationId,
        subscriptionId: input.subscriptionId,
        subscriberId: input.subscriberId,
        operation: input.action.toUpperCase(),
        idempotencyHash: input.idempotencyHash,
        fingerprint: input.fingerprint,
        expectedVersion: input.expectedVersion,
        now: input.now,
      })
    }
    await client.query('COMMIT')
    transaction = false
    return { row, pending: !!existing }
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => undefined)
    if (error instanceof SubscriptionRuntimeError) throw error
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : ''
    if (code === '23505') throw new SubscriptionRuntimeError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 409)
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  } finally {
    client.release()
  }
}

async function updateLifecycleFence(
  membershipStore: W07WebhookPostgresPool,
  input: {
    action: SubscriptionLifecycleAction
    row: LifecycleSubscriptionRow
    subscriberId: string
    idempotencyHash: string
    now: string
  },
): Promise<LifecycleSubscriptionRow> {
  const client = await membershipStore.connect()
  let transaction = false
  try {
    await client.query('BEGIN')
    transaction = true
    const row = await readLifecycleSubscription(client, input.row.subscription_id, input.subscriberId)
    if (!row) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404)
    if (input.action === 'pause' && row.status === 'PAUSING') {
      await client.query('COMMIT')
      transaction = false
      return row
    }
    if (input.action === 'pause') {
      if (row.status !== 'ACTIVE' || row.cancel_at !== null) {
        throw new SubscriptionRuntimeError('CONFLICT', 409)
      }
      const nextVersion = row.version + 1
      const result = await client.query<LifecycleSubscriptionRow & Record<string, unknown>>(
        'UPDATE membership_subscriptions SET status = $1, pause_started_at = $2::timestamptz, ' +
        'pause_period_end_snapshot = current_period_end, ' +
        'pause_remaining_seconds = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (current_period_end - $2::timestamptz)))::bigint), ' +
        'updated_at = $2::timestamptz, version = version + 1 ' +
        "WHERE subscription_id = $3 AND subscriber_id = $4 AND status = 'ACTIVE' AND cancel_at IS NULL AND version = $5 " +
        'RETURNING subscription_id, subscriber_id, status, ' +
        "to_char(current_period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS current_period_start, " +
        "to_char(current_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS current_period_end, " +
        "CASE WHEN cancel_at IS NULL THEN NULL ELSE to_char(cancel_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') END AS cancel_at, " +
        "to_char(pause_started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS pause_started_at, " +
        "to_char(pause_period_end_snapshot AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS pause_period_end_snapshot, " +
        'pause_remaining_seconds::double precision AS pause_remaining_seconds, version::double precision AS version',
        ['PAUSING', input.now, row.subscription_id, input.subscriberId, row.version],
      )
      const updated = result.rows[0]
      if (!updated) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
      await writeAudit(client, {
        subscriptionId: row.subscription_id, subscriberId: input.subscriberId,
        operation: 'PAUSE', fromStatus: row.status, toStatus: 'PAUSING',
        fromVersion: row.version, toVersion: nextVersion, now: input.now,
      })
      await client.query('COMMIT')
      transaction = false
      return updated
    }
    throw new SubscriptionRuntimeError('CONFLICT', 409)
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => undefined)
    if (error instanceof SubscriptionRuntimeError) throw error
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  } finally {
    client.release()
  }
}

async function finalizePause(
  membershipStore: W07WebhookPostgresPool,
  input: {
    row: LifecycleSubscriptionRow
    subscriberId: string
    idempotencyHash: string
    now: string
    deferReceiptCompletion?: boolean
  },
): Promise<LifecycleResponse> {
  const client = await membershipStore.connect()
  let transaction = false
  try {
    await client.query('BEGIN')
    transaction = true
    const row = await readLifecycleSubscription(client, input.row.subscription_id, input.subscriberId)
    if (!row || row.status !== 'PAUSING' || !row.pause_started_at ||
        !row.pause_period_end_snapshot || row.pause_remaining_seconds === null) {
      throw new SubscriptionRuntimeError('CONFLICT', 409)
    }
    const updated = await client.query<LifecycleSubscriptionRow & Record<string, unknown>>(
      'UPDATE membership_subscriptions SET status = $1, updated_at = $2::timestamptz, version = version + 1 ' +
      "WHERE subscription_id = $3 AND subscriber_id = $4 AND status = 'PAUSING' AND version = $5 " +
      'RETURNING subscription_id, subscriber_id, status, ' +
      "to_char(current_period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS current_period_start, " +
      "to_char(current_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS current_period_end, " +
      'NULL::text AS cancel_at, ' +
      "to_char(pause_started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS pause_started_at, " +
      "to_char(pause_period_end_snapshot AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS pause_period_end_snapshot, " +
      'pause_remaining_seconds::double precision AS pause_remaining_seconds, version::double precision AS version',
      ['PAUSED', input.now, row.subscription_id, input.subscriberId, row.version],
    )
    const next = updated.rows[0]
    if (!next) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
    await writeAudit(client, {
      subscriptionId: row.subscription_id, subscriberId: input.subscriberId,
      operation: 'PAUSE', fromStatus: 'PAUSING', toStatus: 'PAUSED',
      fromVersion: row.version, toVersion: next.version, now: input.now,
      metadata: { remainingSeconds: row.pause_remaining_seconds },
    })
    const response = responseFromRow(next)
    await completeReceipt(client, input.subscriberId, input.idempotencyHash, response, input.now)
    await client.query('COMMIT')
    transaction = false
    return response
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => undefined)
    if (error instanceof SubscriptionRuntimeError) throw error
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  } finally {
    client.release()
  }
}

async function revertPauseFence(
  membershipStore: W07WebhookPostgresPool,
  row: LifecycleSubscriptionRow,
  subscriberId: string,
  now: string,
): Promise<void> {
  const client = await membershipStore.connect()
  let transaction = false
  try {
    await client.query('BEGIN')
    transaction = true
    const current = await readLifecycleSubscription(client, row.subscription_id, subscriberId)
    if (current?.status === 'PAUSING') {
      const updated = await client.query(
        'UPDATE membership_subscriptions SET status = $1, pause_started_at = NULL, ' +
        'pause_period_end_snapshot = NULL, pause_remaining_seconds = NULL, updated_at = $2::timestamptz, ' +
        'version = version + 1 WHERE subscription_id = $3 AND subscriber_id = $4 AND status = $5 AND version = $6',
        ['ACTIVE', now, row.subscription_id, subscriberId, 'PAUSING', current.version],
      )
      if (updated.rowCount !== 1) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
      await writeAudit(client, {
        subscriptionId: row.subscription_id, subscriberId,
        operation: 'PAUSE_RECONCILIATION', fromStatus: 'PAUSING', toStatus: 'ACTIVE',
        fromVersion: current.version, toVersion: current.version + 1, now,
        metadata: { reason: 'RENEWAL_IN_FLIGHT' },
      })
    }
    await client.query('COMMIT')
    transaction = false
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => undefined)
    if (error instanceof SubscriptionRuntimeError) throw error
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  } finally {
    client.release()
  }
}

async function finishCancel(
  membershipStore: W07WebhookPostgresPool,
  input: {
    subscriptionId: string
    subscriberId: string
    idempotencyHash: string
    now: string
  },
): Promise<LifecycleResponse> {
  const client = await membershipStore.connect()
  let transaction = false
  try {
    await client.query('BEGIN')
    transaction = true
    const row = await readLifecycleSubscription(client, input.subscriptionId, input.subscriberId)
    if (!row) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404)
    const response = responseFromRow(row)
    await completeReceipt(client, input.subscriberId, input.idempotencyHash, response, input.now)
    await client.query('COMMIT')
    transaction = false
    return response
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => undefined)
    if (error instanceof SubscriptionRuntimeError) throw error
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  } finally {
    client.release()
  }
}

async function applySimpleLifecycle(
  membershipStore: W07WebhookPostgresPool,
  input: {
    action: SubscriptionLifecycleAction
    row: LifecycleSubscriptionRow
    subscriberId: string
    idempotencyHash: string
    now: string
  },
): Promise<LifecycleResponse> {
  const client = await membershipStore.connect()
  let transaction = false
  try {
    await client.query('BEGIN')
    transaction = true
    const row = await readLifecycleSubscription(client, input.row.subscription_id, input.subscriberId)
    if (!row) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404)
    let updated: LifecycleSubscriptionRow | undefined
    if (input.action === 'cancel') {
      if (row.status === 'PAUSING') throw new SubscriptionRuntimeError('CONFLICT', 409)
      if (row.status === 'PAUSED') {
        const result = await client.query<LifecycleSubscriptionRow & Record<string, unknown>>(
          'UPDATE membership_subscriptions SET status = $1, cancel_at = current_period_end, ' +
          'pause_started_at = NULL, pause_period_end_snapshot = NULL, pause_remaining_seconds = NULL, ' +
          'updated_at = $2::timestamptz, version = version + 1 ' +
          "WHERE subscription_id = $3 AND subscriber_id = $4 AND status = 'PAUSED' AND version = $5 " +
          'RETURNING subscription_id, subscriber_id, status, ' +
          "to_char(current_period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS current_period_start, " +
          "to_char(current_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS current_period_end, " +
          "to_char(current_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS cancel_at, " +
          'NULL::text AS pause_started_at, NULL::text AS pause_period_end_snapshot, NULL::double precision AS pause_remaining_seconds, ' +
          'version::double precision AS version',
          ['CANCELED', input.now, row.subscription_id, input.subscriberId, row.version],
        )
        updated = result.rows[0]
      } else if (['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(row.status)) {
        const result = await client.query<LifecycleSubscriptionRow & Record<string, unknown>>(
          'UPDATE membership_subscriptions SET cancel_at = current_period_end, updated_at = $1::timestamptz, ' +
          'version = CASE WHEN cancel_at IS NULL THEN version + 1 ELSE version END ' +
          'WHERE subscription_id = $2 AND subscriber_id = $3 AND status = $4 AND version = $5 ' +
          'RETURNING subscription_id, subscriber_id, status, ' +
          "to_char(current_period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS current_period_start, " +
          "to_char(current_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS current_period_end, " +
          "to_char(cancel_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS cancel_at, " +
          'NULL::text AS pause_started_at, NULL::text AS pause_period_end_snapshot, NULL::double precision AS pause_remaining_seconds, ' +
          'version::double precision AS version',
          [input.now, row.subscription_id, input.subscriberId, row.status, row.version],
        )
        updated = result.rows[0]
      } else if (row.status === 'CANCELED' || row.status === 'EXPIRED') {
        updated = row
      } else {
        throw new SubscriptionRuntimeError('CONFLICT', 409)
      }
    } else if (input.action === 'resume') {
      if (row.status !== 'PAUSED' || row.cancel_at !== null || row.pause_remaining_seconds === null ||
          !Number.isSafeInteger(Number(row.pause_remaining_seconds)) || Number(row.pause_remaining_seconds) < 0) {
        throw new SubscriptionRuntimeError('CONFLICT', 409)
      }
      const nextEnd = new Date(Date.parse(input.now) + Number(row.pause_remaining_seconds) * 1000).toISOString()
      const result = await client.query<LifecycleSubscriptionRow & Record<string, unknown>>(
        'UPDATE membership_subscriptions SET status = $1, current_period_start = $2::timestamptz, ' +
        'current_period_end = $3::timestamptz, pause_started_at = NULL, pause_period_end_snapshot = NULL, ' +
        'pause_remaining_seconds = NULL, updated_at = $2::timestamptz, version = version + 1 ' +
        "WHERE subscription_id = $4 AND subscriber_id = $5 AND status = 'PAUSED' AND cancel_at IS NULL AND version = $6 " +
        'RETURNING subscription_id, subscriber_id, status, ' +
        "to_char(current_period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS current_period_start, " +
        "to_char(current_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS current_period_end, " +
        'NULL::text AS cancel_at, NULL::text AS pause_started_at, NULL::text AS pause_period_end_snapshot, ' +
        'NULL::double precision AS pause_remaining_seconds, version::double precision AS version',
        ['ACTIVE', input.now, nextEnd, row.subscription_id, input.subscriberId, row.version],
      )
      updated = result.rows[0]
    } else {
      throw new SubscriptionRuntimeError('CONFLICT', 409)
    }
    if (!updated) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412)
    if (updated.version !== row.version) {
      await writeAudit(client, {
        subscriptionId: row.subscription_id, subscriberId: input.subscriberId,
        operation: input.action.toUpperCase(), fromStatus: row.status, toStatus: updated.status,
        fromVersion: row.version, toVersion: updated.version, now: input.now,
      })
    }
    const response = responseFromRow(updated)
    if (!input.deferReceiptCompletion) {
      await completeReceipt(client, input.subscriberId, input.idempotencyHash, response, input.now)
    }
    await client.query('COMMIT')
    transaction = false
    return response
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => undefined)
    if (error instanceof SubscriptionRuntimeError) throw error
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  } finally {
    client.release()
  }
}

export async function transitionSubscriptionLifecycle(
  membershipStore: W07WebhookPostgresPool,
  financeStore: W07WebhookPostgresPool,
  input: {
    action: SubscriptionLifecycleAction
    subscriptionId: string
    subscriberId: string
    idempotencyKey: string | null
    ifMatch: string | null
    now?: Date
  },
): Promise<LifecycleResult> {
  const subscriberId = validatePrincipal(input.subscriberId)
  const subscriptionId = input.subscriptionId.trim()
  if (!subscriptionId || subscriptionId.length > 256) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
  const idempotencyKey = validateKey(input.idempotencyKey)
  const expectedVersion = parseExpectedVersion(input.ifMatch)
  const now = canonicalNow(input.now ?? new Date())
  const idempotencyHash = await hash(idempotencyKey)
  const fingerprint = await hash(JSON.stringify({
    action: input.action.toUpperCase(),
    subscriptionId,
    expectedVersion,
  }))
  const operationId = 'subop_' + (await hash('subscription-lifecycle-v1\u0000' + subscriberId + '\u0000' + idempotencyKey))
  const started = await beginLifecycleOperation(membershipStore, {
    action: input.action, subscriptionId, subscriberId, idempotencyHash,
    operationId, fingerprint, expectedVersion, now,
  })
  if (started.completed) return { data: started.completed, status: 200 }

  if (input.action === 'pause') {
    let fenced = started.row
    if (fenced.status === 'ACTIVE') {
      fenced = await updateLifecycleFence(membershipStore, {
        action: 'pause', row: fenced, subscriberId, idempotencyHash, now,
      })
    } else if (fenced.status !== 'PAUSING' && fenced.status !== 'PAUSED') {
      throw new SubscriptionRuntimeError('CONFLICT', 409)
    }
    if (fenced.status === 'PAUSED') {
      const result = await finishCancel(membershipStore, {
        subscriptionId, subscriberId, idempotencyHash, now,
      })
      return { data: result, status: 200 }
    }
    if (await hasUnresolvedRenewal(financeStore, subscriptionId)) {
      await revertPauseFence(membershipStore, fenced, subscriberId, now)
      return {
        data: { ...responseFromRow({ ...fenced, status: 'ACTIVE', pause_started_at: null,
          pause_period_end_snapshot: null, pause_remaining_seconds: null, version: fenced.version + 1 }),
          replayed: false, pending: true, reason: 'RENEWAL_IN_FLIGHT' },
        status: 409,
      }
    }
    return { data: await finalizePause(membershipStore, {
      row: fenced, subscriberId, idempotencyHash, now,
    }), status: 200 }
  }

  if (input.action === 'cancel') {
    const deferReceiptCompletion = !['PAUSED', 'CANCELED', 'EXPIRED'].includes(started.row.status)
    const result = await applySimpleLifecycle(membershipStore, {
      action: 'cancel', row: started.row, subscriberId, idempotencyHash, now,
      deferReceiptCompletion,
    })
    if (result.status === 'CANCELED' || result.cancelAt === null) {
      return { data: result, status: 200 }
    }
    if (await hasUnresolvedRenewal(financeStore, subscriptionId)) {
      return { data: { ...result, replayed: false, pending: true, reason: 'RENEWAL_IN_FLIGHT' }, status: 202 }
    }
    return { data: await finishCancel(membershipStore, {
      subscriptionId, subscriberId, idempotencyHash, now,
    }), status: 200 }
  }

  return { data: await applySimpleLifecycle(membershipStore, {
    action: 'resume', row: started.row, subscriberId, idempotencyHash, now,
  }), status: 200 }
}
