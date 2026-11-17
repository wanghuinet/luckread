import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  createContent,
  type ContentCreateStore,
} from './content-runtime.js'
import {
  CONTENT_SNOWFLAKE_EPOCH_MS,
  encodeContentSnowflakeId,
} from './content-snowflake-id.js'

const nowMs = Date.UTC(2026, 9, 23, 12, 0, 0)

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

  it('delegates allocation and atomic content creation to the PostgreSQL persistence store', async () => {
    const allocatedAt: number[] = []
    let persisted: Parameters<ContentCreateStore['create']>[0] | undefined
    const store: ContentCreateStore = {
      async loadIdempotency() { return null },
      async allocateContentId(timestampMs) {
        allocatedAt.push(timestampMs)
        return encodeContentSnowflakeId(timestampMs, 7)
      },
      async create(input) {
        persisted = input
      },
    }

    const created = await createContent(
      'user_123',
      { contentType: 'article', title: 'Article', bodyRef: 'body:article', mediaRefs: [], coverRef: null },
      'article-create-key',
      new Date(nowMs),
      'snowflake-postgres-test',
      undefined,
      store,
    )

    expect(created.id).toBe(encodeContentSnowflakeId(nowMs, 7))
    expect(allocatedAt).toEqual([nowMs])
    expect(persisted?.content.id).toBe(created.id)
    expect(persisted?.revision.contentId).toBe(created.id)
    expect(persisted?.operationId).toBe('createContent')
  })

  it('keeps the historical D1 allocator migration without rewriting legacy content IDs', () => {
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
