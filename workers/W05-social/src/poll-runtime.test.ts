/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { castContentPollVote, configureContentPoll, deleteContentPoll, getContentPoll } from './poll-runtime.js'
import type { PublishedContentSocialContext } from './w03-content-context-client.js'

const noDatabase = () => ({
  prepare: vi.fn(() => { throw new Error('unexpected database access') }),
  batch: vi.fn(async () => []),
}) as unknown as D1Database

const publishedPollContext = (
  ownerUserId: string | null = 'author-1',
  updatedAt = '2026-10-17T04:00:00.000Z',
): PublishedContentSocialContext => ({
  contentId: 'content-1',
  ownerUserId,
  contentType: 'post',
  state: 'PUBLISHED',
  updatedAt,
})

type PollDbScenario = {
  content?: { id: string; content_type: string; state: string; owner_user_id: string; updated_at: string }
  poll?: { poll_id: string; content_id: string; owner_user_id: string; duration_hours: number; ends_at: string | null; created_at: string; updated_at: string }
  options?: Array<{ option_id: string; option_text: string; position: number; votes: number }>
  viewerOptionId?: string | null
  voteCreatedAt?: string
}

const pollDb = (scenario: PollDbScenario) => {
  const current = {
    ...scenario,
    options: [...(scenario.options ?? [])],
    viewerOptionId: scenario.viewerOptionId ?? null,
    voteCreatedAt: scenario.voteCreatedAt ?? '2026-10-17T05:00:00.000Z',
  }
  const prepare = vi.fn((sql: string) => ({
    bind: (...args: unknown[]) => ({
      first: async () => {
        if (sql.includes('FROM contents WHERE id = ?')) return current.content ?? null
        if (sql.includes('FROM social_user_interactions')) return null
        if (sql.includes('FROM social_polls') && sql.includes('WHERE content_id = ?')) return current.poll ?? null
        if (sql.includes('FROM social_polls p JOIN contents')) return current.poll ?? null
        if (sql.includes('FROM social_poll_votes WHERE poll_id = ? AND user_id = ?')) {
          return current.viewerOptionId ? { option_id: current.viewerOptionId, created_at: current.voteCreatedAt } : null
        }
        if (sql.includes('COUNT(*) AS count FROM social_poll_votes')) return { count: current.viewerOptionId ? 1 : 0 }
        return null
      },
      all: async () => {
        if (sql.includes('SELECT o.option_id, o.option_text')) {
          return { results: current.options.map(option => ({ ...option, votes: option.votes + (option.option_id === current.viewerOptionId ? 1 : 0) })) }
        }
        if (sql.includes('SELECT option_text FROM social_poll_options')) {
          return { results: current.options.map(option => ({ option_text: option.option_text })) }
        }
        return { results: [] }
      },
      run: async () => {
        if (sql.includes('UPDATE social_polls SET ends_at') && current.poll && current.poll.ends_at === null) {
          current.poll.ends_at = String(args[0])
        }
        if (sql.includes('INSERT OR IGNORE INTO social_poll_votes') && current.poll) {
          current.viewerOptionId = String(args[3])
          const index = current.options.findIndex(option => option.option_id === current.viewerOptionId)
          if (index >= 0) current.options[index].votes += 1
        }
        return { success: true, meta: { changes: 1 } }
      },
    }),
  }))
  const batch = vi.fn(async () => [{ success: true, meta: { changes: 1 } }])
  return { db: { prepare, batch } as unknown as D1Database, prepare, batch }
}

describe('W05 poll runtime', () => {
  it('rejects duplicated or too-short options before touching D1', async () => {
    const db = noDatabase()
    await expect(configureContentPoll(db, 'author-1', 'content-1', ['同一', ' 同一 '], 24))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(configureContentPoll(db, 'author-1', 'content-1', ['只有一项'], 24))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect((db as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('returns public poll results and the current viewer vote', async () => {
    const { db } = pollDb({
      content: {
        id: 'content-1', content_type: 'post', state: 'PUBLISHED',
        owner_user_id: 'author-1', updated_at: '2026-10-17T04:00:00.000Z',
      },
      poll: {
        poll_id: 'poll-1', content_id: 'content-1', owner_user_id: 'author-1',
        duration_hours: 24, ends_at: '2026-10-18T04:00:00.000Z',
        created_at: '2026-10-17T04:00:00.000Z', updated_at: '2026-10-17T04:00:00.000Z',
      },
      options: [
        { option_id: 'option-1', option_text: '选项一', position: 0, votes: 3 },
        { option_id: 'option-2', option_text: '选项二', position: 1, votes: 2 },
      ],
      viewerOptionId: 'option-2',
    })
    await expect(getContentPoll(db, 'content-1', 'viewer-1', publishedPollContext())).resolves.toMatchObject({
      pollId: 'poll-1',
      contentId: 'content-1',
      totalVotes: 6,
      viewerOptionId: 'option-2',
      closed: false,
      options: [
        { optionId: 'option-1', text: '选项一', votes: 3 },
        { optionId: 'option-2', text: '选项二', votes: 3 },
      ],
    })
  })

  it('starts the vote window from the published post time when first read', async () => {
    const { db } = pollDb({
      content: {
        id: 'content-1', content_type: 'post', state: 'PUBLISHED',
        owner_user_id: 'author-1', updated_at: '2026-10-17T04:00:00.000Z',
      },
      poll: {
        poll_id: 'poll-1', content_id: 'content-1', owner_user_id: 'author-1',
        duration_hours: 24, ends_at: null,
        created_at: '2026-10-16T04:00:00.000Z', updated_at: '2026-10-16T04:00:00.000Z',
      },
      options: [
        { option_id: 'option-1', option_text: 'Yes', position: 0, votes: 0 },
        { option_id: 'option-2', option_text: 'No', position: 1, votes: 0 },
      ],
    })
    await expect(getContentPoll(db, 'content-1', null, publishedPollContext('author-1', '2026-10-17T04:00:00.000Z'))).resolves.toMatchObject({
      endsAt: '2026-10-18T04:00:00.000Z',
      totalVotes: 0,
    })
  })

  it('fails closed when owner context is missing and denies a mismatched owner before touching D1', async () => {
    const db = noDatabase()
    await expect(configureContentPoll(db, 'author-1', 'content-1', ['Yes', 'No'], 24))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    const context = {
      contentId: 'content-1',
      ownerUserId: 'author-1',
      contentType: 'post',
      state: 'DRAFT',
      updatedAt: '2026-10-17T04:00:00.000Z',
    } as const
    await expect(configureContentPoll(db, 'attacker-1', 'content-1', ['Yes', 'No'], 24, context))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(deleteContentPoll(db, 'attacker-1', 'content-1', context))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(deleteContentPoll(db, 'author-1', 'content-1'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    expect((db as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('configures a draft poll from W03 owner context without reading canonical contents', async () => {
    const queries: string[] = []
    let pollRead = 0
    const optionRows = [
      { option_id: 'option-1', option_text: 'Yes', position: 0, votes: 0 },
      { option_id: 'option-2', option_text: 'No', position: 1, votes: 0 },
    ]
    const pollRow = {
      poll_id: 'poll-1',
      content_id: 'content-1',
      owner_user_id: 'author-1',
      duration_hours: 24,
      ends_at: null,
      created_at: '2026-10-17T04:00:00.000Z',
      updated_at: '2026-10-17T04:00:00.000Z',
    }
    const prepare = vi.fn((sql: string) => {
      queries.push(sql)
      return {
        bind: (..._args: unknown[]) => ({
          first: async () => {
            if (sql.includes('FROM social_polls') && sql.includes('WHERE content_id = ?')) {
              pollRead += 1
              return pollRead === 1 ? null : pollRow
            }
            return null
          },
          all: async () => sql.includes('SELECT o.option_id, o.option_text')
            ? { results: optionRows }
            : { results: [] },
          run: async () => ({ success: true, meta: { changes: 1 } }),
        }),
      }
    })
    const batch = vi.fn(async () => [{ success: true, meta: { changes: 1 } }])
    const db = { prepare, batch } as unknown as D1Database
    const context = {
      contentId: 'content-1',
      ownerUserId: 'author-1',
      contentType: 'post',
      state: 'DRAFT',
      updatedAt: '2026-10-17T04:00:00.000Z',
    } as const

    await expect(configureContentPoll(db, 'author-1', 'content-1', ['Yes', 'No'], 24, context))
      .resolves.toMatchObject({
        pollId: 'poll-1',
        contentId: 'content-1',
        options: [{ text: 'Yes' }, { text: 'No' }],
        durationHours: 24,
      })
    expect(batch).toHaveBeenCalledTimes(1)
    expect(queries.some(sql => /(?:FROM|JOIN)\s+contents/i.test(sql))).toBe(false)
  })

  it('deletes a draft poll with owner context without reading canonical contents', async () => {
    const queries: string[] = []
    const prepare = vi.fn((sql: string) => {
      queries.push(sql)
      return {
        bind: (..._args: unknown[]) => ({
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({ success: true, meta: { changes: 1 } }),
        }),
      }
    })
    const batch = vi.fn(async () => [{ success: true, meta: { changes: 1 } }])
    const db = { prepare, batch } as unknown as D1Database
    const context = {
      contentId: 'content-1',
      ownerUserId: 'author-1',
      contentType: 'post',
      state: 'DRAFT',
      updatedAt: '2026-10-17T04:00:00.000Z',
    } as const
    await expect(deleteContentPoll(db, 'author-1', 'content-1', context)).resolves.toBeUndefined()
    expect(batch).not.toHaveBeenCalled()
    expect(queries.some(sql => /(?:FROM|JOIN)\s+contents/i.test(sql))).toBe(false)
  })

  it('uses W03 preflight context and retains the atomic canonical publication guard for vote writes', async () => {
    const { db, prepare } = pollDb({
      content: {
        id: 'content-1', content_type: 'post', state: 'PUBLISHED',
        owner_user_id: 'author-1', updated_at: '2099-10-17T04:00:00.000Z',
      },
      poll: {
        poll_id: 'poll-1', content_id: 'content-1', owner_user_id: 'author-1',
        duration_hours: 24, ends_at: '2099-10-18T04:00:00.000Z',
        created_at: '2099-10-17T04:00:00.000Z', updated_at: '2099-10-17T04:00:00.000Z',
      },
      options: [
        { option_id: 'option-1', option_text: 'Yes', position: 0, votes: 0 },
        { option_id: 'option-2', option_text: 'No', position: 1, votes: 0 },
      ],
    })
    await expect(castContentPollVote(
      db, 'viewer-1', 'content-1', 'option-1', publishedPollContext('author-1', '2099-10-17T04:00:00.000Z'),
    )).resolves.toMatchObject({ pollId: 'poll-1', viewerOptionId: 'option-1' })

    const voteInsert = prepare.mock.calls.map(([sql]) => String(sql)).find(sql => sql.includes('INSERT OR IGNORE INTO social_poll_votes'))
    expect(voteInsert).toContain('JOIN contents c ON c.id = p.content_id')
    expect(voteInsert).toContain("c.state = 'PUBLISHED'")
    expect(voteInsert).toContain("c.content_type = 'post'")
    expect(voteInsert).toContain("b.relation_type = 'block'")
  })

  it('prevents voting on a closed poll', async () => {
    const { db } = pollDb({
      content: {
        id: 'content-1', content_type: 'post', state: 'PUBLISHED',
        owner_user_id: 'author-1', updated_at: '2026-10-15T04:00:00.000Z',
      },
      poll: {
        poll_id: 'poll-1', content_id: 'content-1', owner_user_id: 'author-1',
        duration_hours: 24, ends_at: '2026-10-16T04:00:00.000Z',
        created_at: '2026-10-15T04:00:00.000Z', updated_at: '2026-10-15T04:00:00.000Z',
      },
      options: [
        { option_id: 'option-1', option_text: 'Yes', position: 0, votes: 0 },
        { option_id: 'option-2', option_text: 'No', position: 1, votes: 0 },
      ],
    })
    await expect(castContentPollVote(
      db,
      'viewer-1',
      'content-1',
      'option-1',
      publishedPollContext('author-1', '2026-10-15T04:00:00.000Z'),
    )).rejects.toMatchObject({ code: 'POLL_CLOSED', status: 409 })
  })
})
