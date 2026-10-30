import { describe, expect, it } from 'vitest'
import { recordRevenueCatWebhookEvent, RevenueCatWebhookPersistenceError } from './revenuecat-webhook-persistence.js'
import { parseRevenueCatWebhookEnvelope } from './revenuecat-webhook-signature.js'

type EventRow = { event_row_id: string; payload_sha256: string; [key: string]: unknown }
type ConflictRow = { conflict_id: string; occurrence_count: number; last_seen_at: string; [key: string]: unknown }

function fakeDb(options: { failSelect?: boolean } = {}) {
  const events = new Map<string, EventRow>()
  const conflicts = new Map<string, ConflictRow>()
  const db = {
    prepare(sql: string) {
      let values: unknown[] = []
      const statement = {
        bind(...next: unknown[]) { values = next; return statement },
        async first<T>() {
          if (options.failSelect) throw new Error('database unavailable')
          if (sql.includes('FROM revenuecat_webhook_events')) {
            const row = events.get(String(values[0]) + ':' + String(values[1]))
            return (row ? { ...row } : null) as T | null
          }
          if (sql.includes('FROM revenuecat_webhook_event_conflicts')) {
            const row = conflicts.get(String(values[0]) + ':' + String(values[1]) + ':' + String(values[2]))
            return (row ? { conflict_id: row.conflict_id } : null) as T | null
          }
          return null
        },
        async run<T>() {
          if (sql.includes('INSERT INTO revenuecat_webhook_events')) {
            const key = String(values[1]) + ':' + String(values[2])
            if (!events.has(key)) {
              events.set(key, {
                event_row_id: String(values[0]),
                app_id: values[1],
                event_id: values[2],
                payload_sha256: String(values[13]),
                state: 'RECEIVED',
              })
            }
            return { success: true, meta: { changes: 1 } } as T
          }
          if (sql.includes('INSERT INTO revenuecat_webhook_event_conflicts')) {
            const key = String(values[1]) + ':' + String(values[2]) + ':' + String(values[4])
            const prior = conflicts.get(key)
            if (prior) {
              prior.occurrence_count += 1
              prior.last_seen_at = String(values[6])
            } else {
              conflicts.set(key, {
                conflict_id: String(values[0]),
                existing_payload_sha256: String(values[3]),
                incoming_payload_sha256: String(values[4]),
                occurrence_count: 1,
                last_seen_at: String(values[6]),
              })
            }
            return { success: true, meta: { changes: 1 } } as T
          }
          return { success: true, meta: { changes: 0 } } as T
        },
      }
      return statement
    },
  }
  return { db: db as unknown as D1Database, events, conflicts }
}

function makeEvent(bodyText: string) {
  const raw = new TextEncoder().encode(bodyText)
  const body = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
  return {
    body,
    event: parseRevenueCatWebhookEnvelope(body, new Set(['app_luckread_android'])),
  }
}

const base = JSON.stringify({
  api_version: '1.0',
  event: {
    id: 'evt_0000000000000000000001',
    type: 'INITIAL_PURCHASE',
    app_id: 'app_luckread_android',
    event_timestamp_ms: 1793300000000,
    app_user_id: 'user_1',
    product_id: 'creator.gold:monthly-v1',
    store: 'PLAY_STORE',
    environment: 'SANDBOX',
  },
})

describe('RevenueCat webhook durable inbox', () => {
  it('stores once, recognizes identical redelivery and records changed-payload conflicts separately', async () => {
    const { db, events, conflicts } = fakeDb()
    const first = makeEvent(base)
    const dependencies = {
      now: () => new Date('2026-10-30T00:00:00.000Z'),
      createEventRowId: () => 'rcevt_fixed',
      createConflictId: () => 'rcconf_fixed',
    }
    const received = await recordRevenueCatWebhookEvent(db, first.event, first.body, dependencies)
    expect(received.outcome).toBe('RECEIVED')
    expect(events.size).toBe(1)

    const duplicate = await recordRevenueCatWebhookEvent(db, first.event, first.body, dependencies)
    expect(duplicate.outcome).toBe('DUPLICATE')
    expect(events.size).toBe(1)

    const changed = makeEvent(base.replace('INITIAL_PURCHASE', 'CANCELLATION'))
    const conflict = await recordRevenueCatWebhookEvent(db, changed.event, changed.body, dependencies)
    expect(conflict.outcome).toBe('PAYLOAD_CONFLICT')
    expect(events.size).toBe(1)
    expect(conflicts.size).toBe(1)

    const repeatedConflict = await recordRevenueCatWebhookEvent(db, changed.event, changed.body, dependencies)
    expect(repeatedConflict.outcome).toBe('PAYLOAD_CONFLICT')
    expect(conflicts.values().next().value?.occurrence_count).toBe(2)
  })

  it('fails closed when durable receipt storage is unavailable', async () => {
    const { db } = fakeDb({ failSelect: true })
    const first = makeEvent(base)
    await expect(recordRevenueCatWebhookEvent(db, first.event, first.body))
      .rejects.toBeInstanceOf(RevenueCatWebhookPersistenceError)
  })
})
