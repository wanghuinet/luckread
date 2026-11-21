import { describe, expect, it, vi } from 'vitest'
import { createPostgresPollDeleteStore } from './poll-delete-store-postgres.js'
import type { PollDeletePostgresQueryExecutor } from './poll-delete-store-postgres.js'

describe('W05 PostgreSQL poll delete store', () => {
  it('reads a poll by its canonical content id', async () => {
    const row = { poll_id: 'poll-1', content_id: 'content-1', owner_user_id: 'owner-1' }
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [row] }))
    const store = createPostgresPollDeleteStore({ query } as unknown as PollDeletePostgresQueryExecutor)

    await expect(store.getPoll('content-1')).resolves.toEqual(row)
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('FROM social_polls')
    expect(values).toEqual(['content-1'])
  })

  it('counts votes for the poll and normalizes PostgreSQL bigint output', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ count: '7' }] }))
    const store = createPostgresPollDeleteStore({ query } as unknown as PollDeletePostgresQueryExecutor)

    await expect(store.countVotes('poll-1')).resolves.toBe(7)
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('COUNT(*) AS count')
    expect(values).toEqual(['poll-1'])
  })

  it('deletes options and the owner-scoped draft poll only when it has no votes', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ deleted: true }] }))
    const store = createPostgresPollDeleteStore({ query } as unknown as PollDeletePostgresQueryExecutor)

    await expect(store.deleteDraftPoll({
      pollId: 'poll-1',
      actorUserId: 'owner-1',
      contentId: 'content-1',
    })).resolves.toBe(true)
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('WITH eligible_poll AS MATERIALIZED')
    expect(String(sql)).toContain('owner_user_id = $2')
    expect(String(sql)).toContain('NOT EXISTS')
    expect(String(sql)).toContain('DELETE FROM social_poll_options')
    expect(String(sql)).toContain('DELETE FROM social_polls')
    expect(values).toEqual(['poll-1', 'owner-1', 'content-1'])
  })

  it('returns false when a vote prevents draft poll deletion', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ deleted: false }] }))
    const store = createPostgresPollDeleteStore({ query } as unknown as PollDeletePostgresQueryExecutor)

    await expect(store.deleteDraftPoll({
      pollId: 'poll-1',
      actorUserId: 'owner-1',
      contentId: 'content-1',
    })).resolves.toBe(false)
  })

  it('sanitizes PostgreSQL provider failures', async () => {
    const store = createPostgresPollDeleteStore({
      query: vi.fn(async (_sql: string, _values?: unknown[]) => { throw new Error('secret host and password') }),
    } as unknown as PollDeletePostgresQueryExecutor)

    await expect(store.getPoll('content-1')).rejects.toMatchObject({ message: 'POLL_DELETE_STORE_UNAVAILABLE' })
    await expect(store.countVotes('poll-1')).rejects.toMatchObject({ message: 'POLL_DELETE_STORE_UNAVAILABLE' })
    await expect(store.deleteDraftPoll({
      pollId: 'poll-1',
      actorUserId: 'owner-1',
      contentId: 'content-1',
    })).rejects.toMatchObject({ message: 'POLL_DELETE_STORE_UNAVAILABLE' })
  })
})
