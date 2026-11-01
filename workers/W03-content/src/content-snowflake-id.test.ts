import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createContent } from './content-runtime.js'
import {
  allocateContentSnowflakeId,
  CONTENT_SNOWFLAKE_EPOCH_MS,
  encodeContentSnowflakeId,
} from './content-snowflake-id.js'

const nowMs = Date.UTC(2026, 9, 23, 12, 0, 0)

const makeAllocatorDb = (initial = { last_timestamp_ms: -1, sequence: 4095 }) => {
  const state = { ...initial }
  let allocationCount = 0
  const queries: string[] = []
  const db = {
    prepare(query: string) {
      queries.push(query)
      return {
        bind(...values: unknown[]) {
          return {
            first: async <T = unknown>() => {
              if (!query.includes('UPDATE content_id_snowflake_state')) return null
              allocationCount += 1
              const requestedMs = values[0]
              if (typeof requestedMs !== 'number') return null
              if (requestedMs > state.last_timestamp_ms) {
                state.last_timestamp_ms = requestedMs
                state.sequence = 0
              } else if (state.sequence < 4095) {
                state.sequence += 1
              } else {
                return null
              }
              return { ...state } as T
            },
          }
        },
      }
    },
  }
  return {
    db: db as never,
    queries,
    allocationCount: () => allocationCount,
    state: () => ({ ...state }),
  }
}

const makeCreateContentDb = () => {
  const state = { last_timestamp_ms: -1, sequence: 4095 }
  let allocationCount = 0
  const batches: Array<Array<{ query: string; values: unknown[] }>> = []
  const db = {
    prepare(query: string) {
      let values: unknown[] = []
      return {
        query,
        bind(...bound: unknown[]) {
          values = bound
          return {
            query,
            values,
            first: async <T = unknown>() => {
              if (query.startsWith('SELECT id AS idem_id')) return null
              if (!query.includes('UPDATE content_id_snowflake_state')) return null
              allocationCount += 1
              const requestedMs = values[0]
              if (typeof requestedMs !== 'number') return null
              if (requestedMs > state.last_timestamp_ms) {
                state.last_timestamp_ms = requestedMs
                state.sequence = 0
              } else if (state.sequence < 4095) {
                state.sequence += 1
              } else {
                return null
              }
              return { ...state } as T
            },
          }
        },
      }
    },
    async batch(statements: Array<{ query: string; values: unknown[] }>) {
      batches.push(statements)
      return []
    },
  }
  return { db: db as never, batches, allocationCount: () => allocationCount }
}

describe('W03 Snowflake content IDs', () => {
  it('uses the 42-bit timestamp + 10-bit node + 12-bit sequence layout and exact decimal strings', () => {
    const timestampDeltaMs = 500_000_000_000
    const timestampMs = CONTENT_SNOWFLAKE_EPOCH_MS + timestampDeltaMs
    const id = encodeContentSnowflakeId(timestampMs, 7)
    const expected = ((BigInt(timestampDeltaMs) << BigInt(22)) | (BigInt(1) << BigInt(12)) | BigInt(7)).toString(10)

    expect(id).toBe(expected)
    expect(id).toMatch(/^\d{18,20}$/)
    expect(BigInt(id).toString(10)).toBe(id)
  })

  it('rejects timestamps before the epoch, values outside 42 timestamp bits, and invalid sequences', () => {
    expect(() => encodeContentSnowflakeId(CONTENT_SNOWFLAKE_EPOCH_MS - 1, 0)).toThrow(
      'CONTENT_SNOWFLAKE_TIMESTAMP_OUT_OF_RANGE',
    )
    expect(() => encodeContentSnowflakeId(CONTENT_SNOWFLAKE_EPOCH_MS + Number((BigInt(1) << BigInt(42)).toString()), 0)).toThrow(
      'CONTENT_SNOWFLAKE_TIMESTAMP_OUT_OF_RANGE',
    )
    expect(() => encodeContentSnowflakeId(CONTENT_SNOWFLAKE_EPOCH_MS, -1)).toThrow(
      'CONTENT_SNOWFLAKE_SEQUENCE_OUT_OF_RANGE',
    )
    expect(() => encodeContentSnowflakeId(CONTENT_SNOWFLAKE_EPOCH_MS, 4096)).toThrow(
      'CONTENT_SNOWFLAKE_SEQUENCE_OUT_OF_RANGE',
    )
  })

  it('uses an atomic shared D1 update and allocates increasing IDs under same-millisecond calls', async () => {
    const fake = makeAllocatorDb()
    const ids = await Promise.all(
      Array.from({ length: 256 }, () => allocateContentSnowflakeId(fake.db, nowMs)),
    )

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => /^\d+$/.test(id))).toBe(true)
    expect(fake.allocationCount()).toBe(256)
    expect(fake.queries.every((query) => query.includes('UPDATE content_id_snowflake_state'))).toBe(true)
    expect(fake.queries.every((query) => query.includes('RETURNING last_timestamp_ms, sequence'))).toBe(true)
  })

  it('keeps the sequence monotonic when the caller clock moves backward', async () => {
    const fake = makeAllocatorDb()
    const first = await allocateContentSnowflakeId(fake.db, nowMs)
    const second = await allocateContentSnowflakeId(fake.db, nowMs - 1)

    expect(BigInt(second)).toBeGreaterThan(BigInt(first))
    expect(fake.state().last_timestamp_ms).toBe(nowMs)
  })

  it('fails closed when the shared 12-bit sequence is exhausted before the clock advances', async () => {
    const fake = makeAllocatorDb({ last_timestamp_ms: nowMs, sequence: 4095 })

    await expect(allocateContentSnowflakeId(fake.db, nowMs)).rejects.toThrow(
      'CONTENT_SNOWFLAKE_SEQUENCE_EXHAUSTED',
    )
  })

  it('assigns Snowflake IDs to article, video, and post creation', async () => {
    const articleFake = makeCreateContentDb()
    const article = await createContent(
      articleFake.db,
      'user_123',
      { contentType: 'article', title: 'Article', bodyRef: 'body:article', mediaRefs: [], coverRef: null },
      'article-create-key',
      new Date(nowMs),
      'snowflake-article-test',
    )
    const articleInsert = articleFake.batches.flat().find((statement) => statement.query.includes('INSERT INTO contents'))
    expect(article.id).toBe(encodeContentSnowflakeId(nowMs, 0))
    expect(articleInsert?.values[0]).toBe(article.id)
    expect(articleFake.allocationCount()).toBe(1)

    const videoFake = makeCreateContentDb()
    const video = await createContent(
      videoFake.db,
      'user_123',
      { contentType: 'video', title: 'Video', bodyRef: 'body:video', mediaRefs: ['https://video.luckread.com/media/test.mp4'], coverRef: null },
      'video-create-key',
      new Date(nowMs),
      'snowflake-video-test',
    )
    expect(video.id).toBe(encodeContentSnowflakeId(nowMs, 0))
    expect(videoFake.allocationCount()).toBe(1)

    const postFake = makeCreateContentDb()
    const post = await createContent(
      postFake.db,
      'user_123',
      { contentType: 'post', title: 'Post', bodyRef: 'body:post', mediaRefs: [], coverRef: null },
      'post-create-key',
      new Date(nowMs),
      'snowflake-post-test',
    )
    expect(post.id).toBe(encodeContentSnowflakeId(nowMs, 0))
    expect(post.id).toMatch(/^\d{18,20}$/)
    expect(postFake.allocationCount()).toBe(1)
  })

  it('defines the D1-02 single-row allocator table without rewriting legacy IDs', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/migrations/0012_content_snowflake_id_allocator.sql'),
      'utf8',
    )

    expect(migration).toContain('CREATE TABLE content_id_snowflake_state')
    expect(migration).toContain('sequence BETWEEN 0 AND 4095')
    expect(migration).toContain('VALUES (1, -1, 4095)')
    expect(migration).not.toContain('UPDATE contents')
  })
})
