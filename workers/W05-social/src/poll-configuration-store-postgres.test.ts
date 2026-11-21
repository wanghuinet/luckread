import { describe, expect, it, vi } from 'vitest'
import { createPostgresPollConfigurationStore } from './poll-configuration-store-postgres.js'
import type { PollConfigurationPostgresQueryExecutor } from './poll-configuration-store-postgres.js'

const option = (optionId: string, text: string, position: number) => ({ optionId, text, position })

describe('W05 PostgreSQL poll configuration store', () => {
  it('reads the poll by canonical content id using UTC millisecond timestamps', async () => {
    const row = {
      poll_id: 'poll-1',
      content_id: 'content-1',
      owner_user_id: 'owner-1',
      duration_minutes: 90,
      ends_at: null,
      created_at: '2026-11-10T10:00:00.000Z',
      updated_at: '2026-11-10T10:00:00.000Z',
    }
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [row] }))
    const store = createPostgresPollConfigurationStore({ query } as unknown as PollConfigurationPostgresQueryExecutor)

    await expect(store.getPoll('content-1')).resolves.toEqual(row)
    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('FROM social_polls')
    expect(String(sql)).toContain('AT TIME ZONE \'UTC\'')
    expect(values).toEqual(['content-1'])
  })

  it('lists options in stable position order and normalizes bigint vote counts', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ option_text: 'Yes' }, { option_text: 'No' }] })
      .mockResolvedValueOnce({ rows: [{ count: '12' }] })
    const store = createPostgresPollConfigurationStore({ query } as unknown as PollConfigurationPostgresQueryExecutor)

    await expect(store.listOptionTexts('poll-1')).resolves.toEqual(['Yes', 'No'])
    await expect(store.countVotes('poll-1')).resolves.toBe(12)
    expect(String(query.mock.calls[0]?.[0])).toContain('ORDER BY position ASC')
    expect(query.mock.calls[0]?.[1]).toEqual(['poll-1'])
    expect(String(query.mock.calls[1]?.[0])).toContain('COUNT(*) AS count')
    expect(query.mock.calls[1]?.[1]).toEqual(['poll-1'])
  })

  it('creates a poll and all options in one PostgreSQL statement', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] }))
    const store = createPostgresPollConfigurationStore({ query } as unknown as PollConfigurationPostgresQueryExecutor)

    await expect(store.createDraftPoll({
      pollId: 'poll-1',
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      durationHours: 24,
      durationMinutes: 90,
      createdAt: '2026-11-10T10:00:00.000Z',
      options: [option('option-1', 'Yes', 0), option('option-2', 'No', 1)],
    })).resolves.toBeUndefined()

    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('ON CONFLICT (content_id) DO NOTHING')
    expect(String(sql)).toContain('CROSS JOIN unnest')
    expect(values).toEqual([
      'poll-1', 'content-1', 'owner-1', 24, 90, '2026-11-10T10:00:00.000Z',
      ['option-1', 'option-2'], ['Yes', 'No'], [0, 1],
    ])
  })

  it('replaces a draft configuration atomically and guards the owner and existing votes', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ updated: true, inserted_option_count: 2 }] }))
    const store = createPostgresPollConfigurationStore({ query } as unknown as PollConfigurationPostgresQueryExecutor)

    await expect(store.updateDraftPoll({
      pollId: 'poll-1',
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      durationHours: 72,
      durationMinutes: 4320,
      updatedAt: '2026-11-10T10:05:00.000Z',
      options: [option('option-3', 'Maybe', 0), option('option-4', 'Later', 1)],
    })).resolves.toBeUndefined()

    const [sql, values] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('WITH eligible_poll AS MATERIALIZED')
    expect(String(sql)).toContain('FOR UPDATE')
    expect(String(sql)).toContain('owner_user_id = $3')
    expect(String(sql)).toContain('NOT EXISTS')
    expect(String(sql)).toContain('DELETE FROM social_poll_options')
    expect(String(sql)).toContain('INSERT INTO social_poll_options')
    expect(values).toEqual([
      'poll-1', 'content-1', 'owner-1', 72, 4320, '2026-11-10T10:05:00.000Z',
      ['option-3', 'option-4'], ['Maybe', 'Later'], [0, 1],
    ])
  })

  it('sanitizes PostgreSQL provider errors for every operation', async () => {
    const store = createPostgresPollConfigurationStore({
      query: vi.fn(async (_sql: string, _values?: unknown[]) => { throw new Error('private host and password') }),
    } as unknown as PollConfigurationPostgresQueryExecutor)

    await expect(store.getPoll('content-1')).rejects.toMatchObject({ message: 'POLL_CONFIGURATION_STORE_UNAVAILABLE' })
    await expect(store.listOptionTexts('poll-1')).rejects.toMatchObject({ message: 'POLL_CONFIGURATION_STORE_UNAVAILABLE' })
    await expect(store.countVotes('poll-1')).rejects.toMatchObject({ message: 'POLL_CONFIGURATION_STORE_UNAVAILABLE' })
    await expect(store.createDraftPoll({
      pollId: 'poll-1',
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      durationHours: 24,
      durationMinutes: 1440,
      createdAt: '2026-11-10T10:00:00.000Z',
      options: [option('option-1', 'Yes', 0), option('option-2', 'No', 1)],
    })).rejects.toMatchObject({ message: 'POLL_CONFIGURATION_STORE_UNAVAILABLE' })
    await expect(store.updateDraftPoll({
      pollId: 'poll-1',
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      durationHours: 24,
      durationMinutes: 1440,
      updatedAt: '2026-11-10T10:00:00.000Z',
      options: [option('option-1', 'Yes', 0), option('option-2', 'No', 1)],
    })).rejects.toMatchObject({ message: 'POLL_CONFIGURATION_STORE_UNAVAILABLE' })
  })
})
