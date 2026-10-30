/// <reference types="@cloudflare/workers-types" />

import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js';
import type { RevenueCatWebhookEvent } from './revenuecat-webhook-signature.js';

type RevenueCatWebhookReceiptRow = Readonly<{
  event_row_id: string;
  payload_sha256: string;
}>;

export type RevenueCatWebhookReceiptResult = Readonly<{
  outcome: 'RECEIVED' | 'DUPLICATE' | 'PAYLOAD_CONFLICT';
  eventId: string;
  receiptId: string;
  payloadSha256: string;
}>;

export class RevenueCatWebhookPersistenceError extends Error {
  constructor(readonly code: 'SERVICE_UNAVAILABLE' | 'INTEGRITY_VIOLATION') {
    super(code);
    this.name = 'RevenueCatWebhookPersistenceError';
  }
}

export type RevenueCatWebhookPersistenceDependencies = Readonly<{
  now?: () => Date;
  createEventRowId?: () => string;
  createConflictId?: () => string;
}>;

function timestamp(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new RevenueCatWebhookPersistenceError('INTEGRITY_VIOLATION');
  }
  return value.toISOString();
}

/**
 * Durable inbox only: no payment, subscription, or entitlement state is
 * modified here. D1-04 stores a sanitized allowlist, never the raw body or
 * subscriber_attributes. Event identity is (RevenueCat app_id, event.id).
 */
export async function recordRevenueCatWebhookEvent(
  db: D1Database,
  event: RevenueCatWebhookEvent,
  rawBody: ArrayBuffer,
  dependencies: RevenueCatWebhookPersistenceDependencies = {},
): Promise<RevenueCatWebhookReceiptResult> {
  if (!(rawBody instanceof ArrayBuffer) || rawBody.byteLength > 1024 * 1024 ||
      event.eventDataJson.length < 2 || event.eventDataJson.length > 16 * 1024) {
    throw new RevenueCatWebhookPersistenceError('INTEGRITY_VIOLATION');
  }

  let payloadHash: string;
  try {
    payloadHash = await sha256BytesToHex(new Uint8Array(rawBody));
  } catch {
    throw new RevenueCatWebhookPersistenceError('SERVICE_UNAVAILABLE');
  }

  const now = timestamp(dependencies.now ?? (() => new Date()));
  const createEventRowId = dependencies.createEventRowId ?? (() => 'rcevt_' + crypto.randomUUID());
  const createConflictId = dependencies.createConflictId ?? (() => 'rcconf_' + crypto.randomUUID());
  const eventRowId = createEventRowId();

  let existing: RevenueCatWebhookReceiptRow | null;
  try {
    existing = await db.prepare(
      'SELECT event_row_id, payload_sha256 FROM revenuecat_webhook_events WHERE app_id = ? AND event_id = ? LIMIT 1',
    ).bind(event.appId, event.eventId).first<RevenueCatWebhookReceiptRow>();
  } catch {
    throw new RevenueCatWebhookPersistenceError('SERVICE_UNAVAILABLE');
  }
  if (existing?.payload_sha256 === payloadHash) {
    return { outcome: 'DUPLICATE', eventId: event.eventId, receiptId: existing.event_row_id, payloadSha256: payloadHash };
  }
  if (existing && existing.payload_sha256 !== payloadHash) {
    await persistConflict(db, event, existing, payloadHash, now, createConflictId());
    return { outcome: 'PAYLOAD_CONFLICT', eventId: event.eventId, receiptId: existing.event_row_id, payloadSha256: payloadHash };
  }

  try {
    await db.prepare(
      'INSERT INTO revenuecat_webhook_events(' +
      'event_row_id,app_id,event_id,event_type,event_timestamp_ms,api_version,app_user_id,product_id,store,environment,' +
      'transaction_id,original_transaction_id,event_data_json,payload_sha256,state,received_at,processed_at,outcome_code' +
      ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'RECEIVED',?,NULL,NULL) " +
      'ON CONFLICT(app_id,event_id) DO NOTHING',
    ).bind(
      eventRowId,
      event.appId,
      event.eventId,
      event.eventType,
      event.eventTimestampMs,
      event.apiVersion,
      event.appUserId,
      event.productId,
      event.store,
      event.environment,
      event.transactionId,
      event.originalTransactionId,
      event.eventDataJson,
      payloadHash,
      now,
    ).run();
  } catch {
    throw new RevenueCatWebhookPersistenceError('SERVICE_UNAVAILABLE');
  }

  // Re-read after INSERT ... ON CONFLICT to close the concurrent first-delivery race.
  try {
    existing = await db.prepare(
      'SELECT event_row_id, payload_sha256 FROM revenuecat_webhook_events WHERE app_id = ? AND event_id = ? LIMIT 1',
    ).bind(event.appId, event.eventId).first<RevenueCatWebhookReceiptRow>();
  } catch {
    throw new RevenueCatWebhookPersistenceError('SERVICE_UNAVAILABLE');
  }
  if (!existing) throw new RevenueCatWebhookPersistenceError('SERVICE_UNAVAILABLE');
  if (existing.payload_sha256 === payloadHash) {
    return { outcome: 'RECEIVED', eventId: event.eventId, receiptId: existing.event_row_id, payloadSha256: payloadHash };
  }

  await persistConflict(db, event, existing, payloadHash, now, createConflictId());
  return { outcome: 'PAYLOAD_CONFLICT', eventId: event.eventId, receiptId: existing.event_row_id, payloadSha256: payloadHash };
}

async function persistConflict(
  db: D1Database,
  event: RevenueCatWebhookEvent,
  existing: RevenueCatWebhookReceiptRow,
  incomingHash: string,
  now: string,
  conflictId: string,
): Promise<void> {
  try {
    await db.prepare(
      'INSERT INTO revenuecat_webhook_event_conflicts(' +
      'conflict_id,app_id,event_id,existing_payload_sha256,incoming_payload_sha256,occurrence_count,first_seen_at,last_seen_at' +
      ') VALUES(?,?,?,?,?,1,?,?) ' +
      'ON CONFLICT(app_id,event_id,incoming_payload_sha256) DO UPDATE SET ' +
      'occurrence_count = revenuecat_webhook_event_conflicts.occurrence_count + 1, ' +
      'last_seen_at = CASE WHEN excluded.last_seen_at > revenuecat_webhook_event_conflicts.last_seen_at ' +
      'THEN excluded.last_seen_at ELSE revenuecat_webhook_event_conflicts.last_seen_at END',
    ).bind(
      conflictId,
      event.appId,
      event.eventId,
      existing.payload_sha256,
      incomingHash,
      now,
      now,
    ).run();
    const conflict = await db.prepare(
      'SELECT conflict_id FROM revenuecat_webhook_event_conflicts ' +
      'WHERE app_id = ? AND event_id = ? AND incoming_payload_sha256 = ? LIMIT 1',
    ).bind(event.appId, event.eventId, incomingHash).first<{ conflict_id: string }>();
    if (!conflict) throw new Error('RevenueCat payload conflict was not durable');
  } catch {
    throw new RevenueCatWebhookPersistenceError('SERVICE_UNAVAILABLE');
  }
}
