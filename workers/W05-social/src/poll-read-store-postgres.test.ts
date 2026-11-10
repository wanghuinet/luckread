import { describe, expect, it, vi } from 'vitest'
import { createPostgresPollReadStore } from './poll-read-store-postgres.js'
import type { PollReadPostgresQueryExecutor } from './poll-read-store-postgres.js'

describe('W05 PostgreSQL poll read store', () => {
  it('checks Block in both directions and returns a boolean', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ blocked: true }] }))
    const store = createPostgresPollReadStore({ query } as unknown as PollReadPostgresQueryExecutor)

    await expect(store.isBlocked('viewer-1', 'owner-1')).resolves.toBe(true)
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain("relation_type = 'block'")
    expect(String(sql)).toContain('actor_user_id = $1 AND target_user_id = $2')
    expect(String(sql)).toContain('actor_user_id = $2 AND target_user_id = $1')
    expect(values).toEqual(['viewer-1', 'owner-1'])
  })

  it('reads the poll with stable UTC millisecond timestamps', async () => {
    const row = {
      poll_id: 'poll-1',
      content_id: 'content-1',
      owner_user_id: 'owner-1',
      duration_minutes: 5,
      ends_at: '2026-11-10T12:05:00.123Z',
      created_at: '2026-11-10T12:00:00.000Z',
      updated_at: '2026-11-10T12:00:00.000Z',
    }
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [row] }))
    const store = createPostgresPollReadStore({ query } as unknown as PollReadPostgresQueryExecutor)

    await expect(store.getPoll('content-1')).resolves.toEqual(row)
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('FROM social_polls')
    expect(String(sql)).toContain('to_char(ends_at AT TIME ZONE')
    expect(values).toEqual(['content-1'])
  })

  it('sets a missing ends_at once without overwriting an existing value', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] }))
    const store = createPostgresPollReadStore({ query } as unknown as PollReadPostgresQueryExecutor)

    await expect(store.setEndsAtIfUnset('poll-1', '2026-11-10T12:05:00.000Z')).resolves.toBeUndefined()
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('ends_at = NULL')
    expect(String(sql)).toContain('ends_at = $1::timestamptz')
    expect(values).toEqual(['2026-11-10T12:05:00.000Z', 'poll-1'])
  })

  it('aggregates option votes in stable position order', async () => {
    const rows = [
      { option_id: 'option-1', option_text: 'Yes', position: 0, votes: 3 },
      { option_id: 'option-2', option_text: 'No', position: 1, votes: 2 },
    ]
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows }))
    const store = createPostgresPollReadStore({ query } as unknown as PollReadPostgresQueryExecutor)

    await expect(store.listOptionsWithVoteCounts('poll-1')).resolves.toEqual(rows)
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('COUNT(v.vote_id)::integer AS votes')
    expect(String(sql)).toContain('LEFT JOIN social_poll_votes')
    expect(String(sql)).toContain('ORDER BY o.position ASC')
    expect(values).toEqual(['poll-1'])
  })

  it('reads the viewer vote scoped to the poll and user', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ option_id: 'option-2' }] }))
    const store = createPostgresPollReadStore({ query } as unknown as PollReadPostgresQueryExecutor)

    await expect(store.getViewerOptionId('poll-1', 'viewer-1')).resolves.toBe('option-2')
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('poll_id = $1')
    expect(String(sql)).toContain('user_id = $2')
    expect(values).toEqual(['poll-1', 'viewer-1'])
  })

  it('sanitizes PostgreSQL provider failures', async () => {
    const store = createPostgresPollReadStore({
      query: vi.fn(async (_sql: string, _values?: unknown[]) => { throw new Error('secret host and password') }),
    } as unknown as PollReadPostgresQueryExecutor)

    await expect(store.isBlocked('viewer-1', 'owner-1')).rejects.toMatchObject({ message: 'POLL_READ_STORE_UNAVAILABLE' })
    await expect(store.getPoll('content-1')).rejects.toMatchObject({ message: 'POLL_READ_STORE_UNAVAILABLE' })
    await expect(store.setEndsAtIfUnset('poll-1', '2026-11-10T12:05:00.000Z')).rejects.toMatchObject({ message: 'POLL_READ_STORE_UNAVAILABLE' })
    await expect(store.listOptionsWithVoteCounts('poll-1')).rejects.toMatchObject({ message: 'POLL_READ_STORE_UNAVAILABLE' })
    await expect(store.getViewerOptionId('poll-1', 'viewer-1')).rejects.toMatchObject({ message: 'POLL_READ_STORE_UNAVAILABLE' })
  })
})
