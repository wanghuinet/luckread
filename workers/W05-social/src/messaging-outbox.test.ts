import { describe, expect, it, vi } from 'vitest'
import { dispatchMessagingOutboxBatch, pruneDeliveredMessagingOutbox } from './messaging-outbox.js'

const event = {
  event_id: '8e0a4a7c-3d32-4d8e-a0d2-2b9b2a0bcb18',
  conversation_id: 'conversation-1',
  actor_user_id: 'user-a',
  event_type: 'message.created' as const,
  payload: { message_id: 'message-1', conversation_id: 'conversation-1', sender_user_id: 'user-a', sequence: '1', body: 'hello', created_at: '2026-11-22T00:00:00.000Z' },
  created_at: '2026-11-22T00:00:00.000Z',
  occurred_at: 1795305600000,
  attempt_count: 1,
}

function database(rows = [event], rowCount = 1) {
  const db = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('WITH candidates')) return { rows }
      return { rows: [], rowCount }
    }),
    connect: vi.fn(),
  }
  return db
}

describe('messaging transactional outbox dispatcher', () => {
  it('claims and delivers durable events to the conversation hub then marks them delivered', async () => {
    const db = database()
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ broadcast: true }), { status: 200 }))
    const hub = { idFromName: vi.fn(() => 'room-id'), get: vi.fn(() => ({ fetch })) }
    await expect(dispatchMessagingOutboxBatch(db as never, hub as never))
      .resolves.toEqual({ claimed: 1, delivered: 1, retried: 0 })
    expect(fetch).toHaveBeenCalledOnce()
    const request = fetch.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body))
    expect(body).toMatchObject({ type: 'message.created', conversationId: 'conversation-1', actorUserId: 'user-a', eventId: event.event_id })
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('SET delivered_at = CURRENT_TIMESTAMP'))).toBe(true)
  })

  it('releases failed deliveries with a bounded retry schedule', async () => {
    const db = database()
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('unavailable', { status: 503 }))
    const hub = { idFromName: vi.fn(() => 'room-id'), get: vi.fn(() => ({ fetch })) }
    await expect(dispatchMessagingOutboxBatch(db as never, hub as never))
      .resolves.toEqual({ claimed: 1, delivered: 0, retried: 1 })
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('make_interval'))).toBe(true)
  })

  it('does not claim work when the realtime namespace is not configured', async () => {
    const db = database()
    await expect(dispatchMessagingOutboxBatch(db as never, undefined))
      .resolves.toEqual({ claimed: 0, delivered: 0, retried: 0 })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('bounds cleanup and deletes only delivered events older than seven days', async () => {
    const db = database([], 3)
    await expect(pruneDeliveredMessagingOutbox(db as never, 10000)).resolves.toBe(3)
    expect(db.query.mock.calls[0]?.[1]).toEqual([500])
    expect(String(db.query.mock.calls[0]?.[0])).toContain("INTERVAL '7 days'")
  })
})
