import { describe, expect, it, vi } from 'vitest'
import { createPostgresMessageRequestStore } from './message-request-store-postgres.js'
type Row = Record<string, unknown>
function executor(clientRows: Array<{ rows: Row[]; rowCount?: number }> = [], directRows: Array<{ rows: Row[]; rowCount?: number }> = []) {
  const client = { query: vi.fn(async (..._args: unknown[]) => clientRows.shift() ?? { rows: [] }), release: vi.fn() }
  const db = { query: vi.fn(async (..._args: unknown[]) => directRows.shift() ?? { rows: [] }), connect: vi.fn(async () => client) }
  return { db, client }
}
const pending = {
  request_id: 'request-1', sender_user_id: 'user-a', recipient_user_id: 'user-b',
  initial_message: 'Hello', status: 'pending', conversation_id: null,
  created_at: '2026-11-21T00:00:00.000Z', responded_at: null,
}
describe('W05 PostgreSQL message request store', () => {
  it('creates a bounded first-contact request after block and mutual-follow checks', async () => {
    const { db, client } = executor([
      { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [{ count: 2 }] }, { rows: [pending] }, { rows: [] },
    ])
    const store = createPostgresMessageRequestStore(db as never)
    await expect(store.createRequest('user-a', 'user-b', 'request-key-1', 'Hello')).resolves.toEqual(pending)
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("relation_type = 'block'"))).toBe(true)
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('social_follow_relationships'))).toBe(true)
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("INTERVAL '24 hours'"))).toBe(true)
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('social_message_request_audit'))).toBe(true)
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
  })
  it('rejects blocked recipients without inserting a request', async () => {
    const { db, client } = executor([{ rows: [] }, { rows: [{ blocked: 1 }] }, { rows: [] }])
    const store = createPostgresMessageRequestStore(db as never)
    await expect(store.createRequest('user-a', 'user-b', 'request-key-1', 'Hello')).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO social_message_requests'))).toBe(false)
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
  })
  it('enforces the daily outgoing request quota', async () => {
    const { db, client } = executor([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [{ count: 10 }] }, { rows: [] }])
    const store = createPostgresMessageRequestStore(db as never)
    await expect(store.createRequest('user-a', 'user-b', 'request-key-2', 'Hello')).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 })
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO social_message_requests'))).toBe(false)
  })
  it('lists only the caller-owned direction and excludes blocked counterparties', async () => {
    const { db } = executor([], [{ rows: [pending] }])
    const store = createPostgresMessageRequestStore(db as never)
    await expect(store.listRequests('user-b', 'incoming', null, 20)).resolves.toMatchObject({ items: [pending], hasMore: false })
    expect(db.query.mock.calls[0]?.[0]).toContain('recipient_user_id = $1')
    expect(db.query.mock.calls[0]?.[0]).toContain('social_user_interactions')
  })
  it('accepts atomically, creates conversation memberships, and persists the first message', async () => {
    const { db, client } = executor([
      { rows: [] }, { rows: [pending] }, { rows: [] }, { rows: [{ conversation_id: 'conversation-1' }] },
      { rows: [] }, { rows: [{ last_sequence: '1' }] }, { rows: [] }, { rows: [] }, { rows: [] },
    ])
    const store = createPostgresMessageRequestStore(db as never)
    await expect(store.respondRequest('user-b', 'request-1', 'accept')).resolves.toEqual({ status: 'accepted', conversationId: 'conversation-1' })
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('FOR UPDATE'))).toBe(true)
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('social_conversation_memberships'))).toBe(true)
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO social_messages'))).toBe(true)
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('social_message_request_audit'))).toBe(true)
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
  })
  it('does not allow the sender to accept another user’s request', async () => {
    const { db, client } = executor([{ rows: [] }, { rows: [pending] }, { rows: [] }])
    const store = createPostgresMessageRequestStore(db as never)
    await expect(store.respondRequest('user-a', 'request-1', 'accept')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO social_messages'))).toBe(false)
  })
})
