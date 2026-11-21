import { describe, expect, it, vi } from 'vitest'
import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js'
import type { W07WebhookPostgresClient, W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { createPostgresRevenueCatWebhookReceiptStore, recordRevenueCatWebhookEventPostgres } from './revenuecat-webhook-postgres-persistence.js'
import { parseRevenueCatWebhookEnvelope } from './revenuecat-webhook-signature.js'

const json = JSON.stringify({
  api_version: '1.0',
  event: {
    id: 'evt_0000000000000000000001', type: 'INITIAL_PURCHASE',
    app_id: 'app_luckread_android', event_timestamp_ms: 1793300000000,
    app_user_id: 'user_1', product_id: 'creator.gold:monthly-v1',
    store: 'PLAY_STORE', environment: 'SANDBOX',
  },
})
const encoded = new TextEncoder().encode(json)
const rawBody = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
const event = parseRevenueCatWebhookEnvelope(rawBody, new Set(['app_luckread_android']))
const receivedAt = '2026-10-30T00:00:00.000Z'

function fakePool(options: {
  existing?: { event_row_id: string; payload_sha256: string } | null
  inserted?: { event_row_id: string; payload_sha256: string } | null
  failQuery?: boolean
} = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const client = {
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      if (options.failQuery && !['BEGIN', 'ROLLBACK'].includes(sql)) throw new Error('db unavailable')
      if (sql.startsWith('SELECT event_row_id')) return { rows: options.existing ? [options.existing] : [] }
      if (sql.startsWith('INSERT INTO revenuecat_webhook_events')) return { rows: options.inserted ? [options.inserted] : [] }
      if (sql.startsWith('INSERT INTO revenuecat_webhook_event_conflicts')) return { rows: [{ conflict_id: 'rcconf_fixed' }] }
      return { rows: [] }
    },
    release: vi.fn(),
  } as unknown as W07WebhookPostgresClient
  const pool = { query: vi.fn(), connect: vi.fn(async () => client) } as unknown as W07WebhookPostgresPool
  return { pool, client, calls }
}
const dependencies = {
  now: () => new Date(receivedAt),
  createEventRowId: () => 'rcevt_fixed',
  createConflictId: () => 'rcconf_fixed',
}

describe('RevenueCat PostgreSQL durable inbox', () => {
  it('inserts the sanitized first receipt in one transaction', async () => {
    const hash = await sha256BytesToHex(new Uint8Array(rawBody))
    const { pool, calls, client } = fakePool({ inserted: { event_row_id: 'rcevt_fixed', payload_sha256: hash } })
    const result = await recordRevenueCatWebhookEventPostgres(pool, event, rawBody, dependencies)
    expect(result).toMatchObject({ outcome: 'RECEIVED', eventId: event.eventId, receiptId: 'rcevt_fixed', payloadSha256: hash })
    expect(calls[0]?.sql).toBe('BEGIN')
    const insert = calls.find(call => call.sql.includes('INSERT INTO revenuecat_webhook_events'))
    expect(insert?.values).toHaveLength(15)
    expect(insert?.values[12]).toBe(event.eventDataJson)
    expect(insert?.values).not.toContain(rawBody)
    expect(calls.at(-1)?.sql).toBe('COMMIT')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('returns duplicate for the identical immutable first receipt without inserting', async () => {
    const hash = await sha256BytesToHex(new Uint8Array(rawBody))
    const { pool, calls } = fakePool({ existing: { event_row_id: 'rcevt_existing', payload_sha256: hash } })
    const result = await recordRevenueCatWebhookEventPostgres(pool, event, rawBody, dependencies)
    expect(result.outcome).toBe('DUPLICATE')
    expect(result.receiptId).toBe('rcevt_existing')
    expect(calls.some(call => call.sql.includes('INSERT INTO revenuecat_webhook_events'))).toBe(false)
    expect(calls.at(-1)?.sql).toBe('COMMIT')
  })

  it('stores changed payload hashes separately and increments repeat conflicts atomically', async () => {
    const { pool, calls } = fakePool({ existing: { event_row_id: 'rcevt_existing', payload_sha256: 'b'.repeat(64) } })
    const result = await recordRevenueCatWebhookEventPostgres(pool, event, rawBody, dependencies)
    const conflict = calls.find(call => call.sql.includes('INSERT INTO revenuecat_webhook_event_conflicts'))
    expect(result.outcome).toBe('PAYLOAD_CONFLICT')
    expect(result.receiptId).toBe('rcevt_existing')
    expect(conflict?.sql).toContain('occurrence_count = revenuecat_webhook_event_conflicts.occurrence_count + 1')
    expect(conflict?.sql).toContain('GREATEST(')
    expect(conflict?.values).toEqual([
      'rcconf_fixed', event.appId, event.eventId, 'b'.repeat(64),
      await sha256BytesToHex(new Uint8Array(rawBody)), receivedAt,
    ])
    expect(calls.at(-1)?.sql).toBe('COMMIT')
  })

  it('rolls back and fails closed when the PostgreSQL inbox is unavailable', async () => {
    const { pool, calls, client } = fakePool({ failQuery: true })
    await expect(recordRevenueCatWebhookEventPostgres(pool, event, rawBody, dependencies))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
    expect(calls.at(-1)?.sql).toBe('ROLLBACK')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('rejects a missing app identity before opening a transaction', async () => {
    const { pool } = fakePool()
    const invalidEvent = { ...event, appId: null }
    await expect(recordRevenueCatWebhookEventPostgres(pool, invalidEvent, rawBody, dependencies))
      .rejects.toMatchObject({ code: 'INTEGRITY_VIOLATION' })
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('exposes the Store contract used by the HTTP runtime', async () => {
    const hash = await sha256BytesToHex(new Uint8Array(rawBody))
    const { pool } = fakePool({ inserted: { event_row_id: 'rcevt_fixed', payload_sha256: hash } })
    const store = createPostgresRevenueCatWebhookReceiptStore(pool)
    expect((await store.record(event, rawBody)).outcome).toBe('RECEIVED')
  })
})
