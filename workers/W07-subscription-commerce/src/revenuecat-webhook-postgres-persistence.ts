import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js'
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import {
  RevenueCatWebhookPersistenceError,
  type RevenueCatWebhookPersistenceDependencies,
  type RevenueCatWebhookReceiptResult,
  type RevenueCatWebhookReceiptStore,
} from './revenuecat-webhook-persistence.js'
import type { RevenueCatWebhookEvent } from './revenuecat-webhook-signature.js'

type ReceiptRow = Readonly<{ event_row_id: string; payload_sha256: string }>

function timestamp(now: () => Date): string {
  const value = now()
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new RevenueCatWebhookPersistenceError('INTEGRITY_VIOLATION')
  }
  return value.toISOString()
}

function validateInput(event: RevenueCatWebhookEvent, rawBody: ArrayBuffer): void {
  if (
    !(rawBody instanceof ArrayBuffer) || rawBody.byteLength < 2 || rawBody.byteLength > 1024 * 1024 ||
    typeof event.appId !== 'string' || event.appId.length < 1 || event.appId.length > 255 ||
    event.appId.trim() !== event.appId ||
    typeof event.eventId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(event.eventId) ||
    typeof event.eventType !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(event.eventType) ||
    !Number.isSafeInteger(event.eventTimestampMs) || event.eventTimestampMs < 1 ||
    typeof event.apiVersion !== 'string' || event.apiVersion.length < 1 || event.apiVersion.length > 32 ||
    typeof event.eventDataJson !== 'string' ||
    new TextEncoder().encode(event.eventDataJson).byteLength < 2 ||
    new TextEncoder().encode(event.eventDataJson).byteLength > 16 * 1024
  ) throw new RevenueCatWebhookPersistenceError('INTEGRITY_VIOLATION')
  try {
    const parsed: unknown = JSON.parse(event.eventDataJson)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('object required')
  } catch {
    throw new RevenueCatWebhookPersistenceError('INTEGRITY_VIOLATION')
  }
}

async function recordInTransaction(
  pool: W07WebhookPostgresPool,
  event: RevenueCatWebhookEvent,
  payloadHash: string,
  now: string,
  eventRowId: string,
  conflictId: () => string,
): Promise<RevenueCatWebhookReceiptResult> {
  let client: Awaited<ReturnType<W07WebhookPostgresPool['connect']>> | undefined
  let transactionOpen = false
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    transactionOpen = true
    const existingResult = await client.query<ReceiptRow>(
      'SELECT event_row_id, payload_sha256 FROM revenuecat_webhook_events ' +
      'WHERE app_id = $1 AND event_id = $2 LIMIT 1 FOR UPDATE',
      [event.appId, event.eventId],
    )
    let existing = existingResult.rows[0]
    if (!existing) {
      const inserted = await client.query<ReceiptRow>(
        'INSERT INTO revenuecat_webhook_events (' +
        'event_row_id, app_id, event_id, event_type, event_timestamp_ms, api_version, app_user_id, ' +
        'product_id, store, environment, transaction_id, original_transaction_id, event_data_json, ' +
        'payload_sha256, state, received_at, processed_at, outcome_code' +
        ") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'RECEIVED',$15,NULL,NULL) " +
        'ON CONFLICT (app_id,event_id) DO NOTHING RETURNING event_row_id,payload_sha256',
        [
          eventRowId, event.appId, event.eventId, event.eventType, event.eventTimestampMs,
          event.apiVersion, event.appUserId, event.productId, event.store, event.environment,
          event.transactionId, event.originalTransactionId, event.eventDataJson, payloadHash, now,
        ],
      )
      if (inserted.rows[0]) {
        await client.query('COMMIT')
        transactionOpen = false
        return { outcome: 'RECEIVED', eventId: event.eventId, receiptId: inserted.rows[0].event_row_id, payloadSha256: payloadHash }
      }
      // Another delivery won the unique app/event insert; inspect its immutable first receipt.
      const raced = await client.query<ReceiptRow>(
        'SELECT event_row_id, payload_sha256 FROM revenuecat_webhook_events ' +
        'WHERE app_id = $1 AND event_id = $2 LIMIT 1 FOR UPDATE',
        [event.appId, event.eventId],
      )
      existing = raced.rows[0]
    }
    if (!existing) throw new RevenueCatWebhookPersistenceError('SERVICE_UNAVAILABLE')
    if (existing.payload_sha256 === payloadHash) {
      await client.query('COMMIT')
      transactionOpen = false
      return { outcome: 'DUPLICATE', eventId: event.eventId, receiptId: existing.event_row_id, payloadSha256: payloadHash }
    }
    const newConflictId = conflictId()
    if (!/^rcconf_[A-Za-z0-9-]{1,248}$/.test(newConflictId)) {
      throw new RevenueCatWebhookPersistenceError('INTEGRITY_VIOLATION')
    }
    await client.query(
      'INSERT INTO revenuecat_webhook_event_conflicts (' +
      'conflict_id, app_id, event_id, existing_payload_sha256, incoming_payload_sha256, ' +
      'occurrence_count, first_seen_at, last_seen_at' +
      ') VALUES ($1,$2,$3,$4,$5,1,$6,$6) ' +
      'ON CONFLICT (app_id,event_id,incoming_payload_sha256) DO UPDATE SET ' +
      'occurrence_count = revenuecat_webhook_event_conflicts.occurrence_count + 1, ' +
      'last_seen_at = GREATEST(revenuecat_webhook_event_conflicts.last_seen_at, EXCLUDED.last_seen_at) ' +
      'RETURNING conflict_id',
      [newConflictId, event.appId, event.eventId, existing.payload_sha256, payloadHash, now],
    )
    await client.query('COMMIT')
    transactionOpen = false
    return { outcome: 'PAYLOAD_CONFLICT', eventId: event.eventId, receiptId: existing.event_row_id, payloadSha256: payloadHash }
  } catch (error) {
    if (transactionOpen && client) {
      try { await client.query('ROLLBACK') } catch { /* preserve original database failure */ }
    }
    if (error instanceof RevenueCatWebhookPersistenceError) throw error
    throw new RevenueCatWebhookPersistenceError('SERVICE_UNAVAILABLE')
  } finally {
    client?.release()
  }
}

export async function recordRevenueCatWebhookEventPostgres(
  pool: W07WebhookPostgresPool,
  event: RevenueCatWebhookEvent,
  rawBody: ArrayBuffer,
  dependencies: RevenueCatWebhookPersistenceDependencies = {},
): Promise<RevenueCatWebhookReceiptResult> {
  validateInput(event, rawBody)
  let payloadHash: string
  try { payloadHash = await sha256BytesToHex(new Uint8Array(rawBody)) }
  catch { throw new RevenueCatWebhookPersistenceError('SERVICE_UNAVAILABLE') }
  const now = timestamp(dependencies.now ?? (() => new Date()))
  const eventRowId = (dependencies.createEventRowId ?? (() => 'rcevt_' + crypto.randomUUID()))()
  if (!/^rcevt_[A-Za-z0-9-]{1,248}$/.test(eventRowId)) {
    throw new RevenueCatWebhookPersistenceError('INTEGRITY_VIOLATION')
  }
  return recordInTransaction(pool,event,payloadHash,now,eventRowId,
    dependencies.createConflictId ?? (() => 'rcconf_' + crypto.randomUUID()))
}

export function createPostgresRevenueCatWebhookReceiptStore(
  pool: W07WebhookPostgresPool,
): RevenueCatWebhookReceiptStore {
  return { record: (event, rawBody) => recordRevenueCatWebhookEventPostgres(pool, event, rawBody) }
}
