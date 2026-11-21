import { describe, expect, it } from 'vitest'

import { SocialTargetsReadStoreError } from './social-targets-read-store.js'
import { createPostgresSocialTargetsReadStore } from './social-targets-read-store-postgres.js'

function fakePostgres(options: {
  topicRows?: Array<{ topic_id: string; normalized_name: string; display_name: string }>
  mentionRows?: Array<{ mentioned_user_id: string; handle: string }>
  fail?: boolean
} = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const db = {
    async query<Row>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      if (options.fail) throw new Error('secret-driver-detail')
      return {
        rows: (sql.includes('FROM social_target_topics')
          ? options.topicRows ?? []
          : options.mentionRows ?? []) as Row[],
      }
    },
  }
  return { db, calls }
}

describe('W05 PostgreSQL SocialTargetsReadStore', () => {
  it('reads active topic edges and immutable mention identities with actor-target scoping and bounds', async () => {
    const topicRows = [{
      topic_id: 'topic-reading',
      normalized_name: 'reading',
      display_name: 'Reading',
    }]
    const mentionRows = [{
      mentioned_user_id: 'original-user-id',
      handle: 'alice',
    }]
    const { db, calls } = fakePostgres({ topicRows, mentionRows })
    const result = await createPostgresSocialTargetsReadStore(db)
      .getTargets({ targetType: 'content', targetId: 'content-1' })

    expect(result).toEqual({ topics: topicRows, mentions: mentionRows })
    expect(calls).toHaveLength(2)
    expect(calls[0]?.sql).toContain('st.target_type = $1 AND st.target_id = $2')
    expect(calls[0]?.sql).toContain("t.status = 'ACTIVE'")
    expect(calls[0]?.sql).toContain('ORDER BY st.created_at ASC')
    expect(calls[0]?.sql).toContain('LIMIT 50')
    expect(calls[0]?.values).toEqual(['content', 'content-1'])
    expect(calls[1]?.sql).toContain('target_type = $1 AND target_id = $2')
    expect(calls[1]?.sql).toContain('ORDER BY created_at ASC')
    expect(calls[1]?.sql).toContain('LIMIT 100')
    expect(calls[1]?.values).toEqual(['content', 'content-1'])
    expect(calls.some(({ sql }) => /JOIN\s+(users|profiles)/i.test(sql))).toBe(false)
  })

  it('loads topics and mentions for a bounded content batch with per-content limits', async () => {
    const topicRows = [{ target_id: 'content-1', topic_id: 'topic-1', normalized_name: 'one', display_name: 'One' }]
    const mentionRows = [{ target_id: 'content-2', mentioned_user_id: 'user-2', handle: 'alice' }]
    const { db, calls } = fakePostgres({ topicRows, mentionRows })
    const result = await createPostgresSocialTargetsReadStore(db).getContentTargetsBatch!(['content-1', 'content-2'])
    expect(result).toEqual({
      'content-1': { topics: [{ topic_id: 'topic-1', normalized_name: 'one', display_name: 'One' }], mentions: [] },
      'content-2': { topics: [], mentions: [{ mentioned_user_id: 'user-2', handle: 'alice' }] },
    })
    expect(calls).toHaveLength(2)
    expect(calls[0]?.sql).toContain('PARTITION BY st.target_id')
    expect(calls[0]?.sql).toContain('row_number <= 50')
    expect(calls[1]?.sql).toContain('PARTITION BY target_id')
    expect(calls[1]?.sql).toContain('row_number <= 100')
    expect(calls[0]?.values).toEqual([['content-1', 'content-2']])
    expect(calls[1]?.values).toEqual([['content-1', 'content-2']])
  })

  it('rejects batches larger than 50 IDs before issuing SQL', async () => {
    const { db, calls } = fakePostgres()
    await expect(createPostgresSocialTargetsReadStore(db).getContentTargetsBatch!(
      Array.from({ length: 51 }, (_, index) => 'content-' + index),
    )).rejects.toBeInstanceOf(SocialTargetsReadStoreError)
    expect(calls).toHaveLength(0)
  })

  it('returns empty arrays when no topic or mention rows exist', async () => {
    const { db } = fakePostgres()
    await expect(createPostgresSocialTargetsReadStore(db)
      .getTargets({ targetType: 'comment', targetId: 'comment-1' }))
      .resolves.toEqual({ topics: [], mentions: [] })
  })

  it('maps provider errors to a sanitized service-unavailable error', async () => {
    const { db } = fakePostgres({ fail: true })
    await expect(createPostgresSocialTargetsReadStore(db)
      .getTargets({ targetType: 'content', targetId: 'content-1' }))
      .rejects.toBeInstanceOf(SocialTargetsReadStoreError)
    await expect(createPostgresSocialTargetsReadStore(db).getContentTargetsBatch!(['content-1']))
      .rejects.toBeInstanceOf(SocialTargetsReadStoreError)
  })
})
