import { describe, expect, it, vi } from 'vitest'
import { createPostgresPollVoteStore } from './poll-vote-store-postgres.js'
import type { PollVotePostgresQueryExecutor } from './poll-vote-store-postgres.js'

describe('W05 PostgreSQL poll vote store', () => {
  it('reads one voter response scoped to the poll and actor', async () => {
    const row = { option_id: 'option-2', created_at: '2026-11-10T12:00:00.000Z' }
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [row] }))
    const store = createPostgresPollVoteStore({ query } as unknown as PollVotePostgresQueryExecutor)

    await expect(store.getVote('poll-1', 'viewer-1')).resolves.toEqual(row)
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('FROM social_poll_votes')
    expect(String(sql)).toContain('poll_id = $1')
    expect(String(sql)).toContain('user_id = $2')
    expect(String(sql)).toContain('AT TIME ZONE \'UTC\'')
    expect(values).toEqual(['poll-1', 'viewer-1'])
  })

  it('inserts only while the poll is open, owner-scoped, unblocked and not already voted', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ option_id: 'option-1' }] }))
    const store = createPostgresPollVoteStore({ query } as unknown as PollVotePostgresQueryExecutor)

    await expect(store.insertVote({
      voteId: 'vote-1',
      pollId: 'poll-1',
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      optionId: 'option-1',
      userId: 'viewer-1',
      createdAt: '2026-11-10T12:00:00.000Z',
    })).resolves.toBeUndefined()

    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('INSERT INTO social_poll_votes')
    expect(String(sql)).toContain('JOIN social_poll_options')
    expect(String(sql)).toContain('poll.ends_at IS NOT NULL')
    expect(String(sql)).toContain('poll.ends_at > $7::timestamptz')
    expect(String(sql)).toContain('poll.poll_id = $8')
    expect(String(sql)).toContain("block_relation.relation_type = 'block'")
    expect(String(sql)).toContain('block_relation.actor_user_id = $2 AND block_relation.target_user_id = $6')
    expect(String(sql)).toContain('block_relation.actor_user_id = $6 AND block_relation.target_user_id = $2')
    expect(String(sql)).toContain('existing.user_id = $2')
    expect(String(sql)).toContain('ON CONFLICT (poll_id, user_id) DO NOTHING')
    expect(values).toEqual([
      'vote-1', 'viewer-1', '2026-11-10T12:00:00.000Z', 'option-1',
      'content-1', 'owner-1', '2026-11-10T12:00:00.000Z', 'poll-1',
    ])
  })

  it('sanitizes PostgreSQL provider failures', async () => {
    const store = createPostgresPollVoteStore({
      query: vi.fn(async (_sql: string, _values?: unknown[]) => { throw new Error('secret host and password') }),
    } as unknown as PollVotePostgresQueryExecutor)

    await expect(store.getVote('poll-1', 'viewer-1'))
      .rejects.toMatchObject({ message: 'POLL_VOTE_STORE_UNAVAILABLE' })
    await expect(store.insertVote({
      voteId: 'vote-1',
      pollId: 'poll-1',
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      optionId: 'option-1',
      userId: 'viewer-1',
      createdAt: '2026-11-10T12:00:00.000Z',
    })).rejects.toMatchObject({ message: 'POLL_VOTE_STORE_UNAVAILABLE' })
  })
})
