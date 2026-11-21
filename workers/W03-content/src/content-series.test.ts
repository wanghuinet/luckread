import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { getSeries, listCreatorSeries } from './content-series.js'

describe('W03 series foundation', () => {
  it('defines authoritative series persistence and lifecycle event triggers', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/migrations/0007_content_series.sql'),
      'utf8',
    )
    expect(migration).toContain('CREATE TABLE content_series')
    expect(migration).toContain('creator_id TEXT NOT NULL')
    expect(migration).toContain("state IN ('DRAFT','PENDING_REVIEW','REJECTED','APPROVED','SCHEDULED'")
    expect(migration).toContain('CREATE INDEX content_series_owner_updated_idx')
    expect(migration).toContain("'series.created'")
    expect(migration).toContain("'series.updated'")
    expect(migration).toContain("'series.deleted'")
  })

  it('binds creator series cursors to the owning user', async () => {
    const row = {
      id: 'series_1',
      owner_user_id: 'user_1',
      creator_id: 'user_1',
      ip_id: null,
      state: 'DRAFT',
      version: 1,
      title: 'Series 1',
      description: 'desc',
      cover_ref: null,
      etag: 'W/"1"',
      created_at: '2026-10-07T00:00:00.000Z',
      updated_at: '2026-10-07T00:00:00.000Z',
    }
    let prepareCalls = 0
    const db = {
      prepare() {
        prepareCalls += 1
        return { bind: () => ({ all: async () => ({ results: [row, { ...row, id: 'series_2' }] }) }) }
      },
    } as never
    const first = await listCreatorSeries(db, 'user_1', null, 1)
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)
    await expect(listCreatorSeries(db, 'user_2', first.nextCursor, 1)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
    expect(prepareCalls).toBe(1)
  })

  it('uses the injected Neon reader for owner-scoped series detail reads', async () => {
    const series = {
      id: 'series_1',
      ownerUserId: 'user_1',
      creatorId: 'user_1',
      ipId: null,
      state: 'DRAFT' as const,
      version: 1,
      title: 'Series 1',
      description: 'desc',
      coverRef: null,
      etag: 'W/"1"',
      createdAt: '2026-10-07T00:00:00.000Z',
      updatedAt: '2026-10-07T00:00:00.000Z',
    }
    const db = { prepare() { throw new Error('Neon reader must be used instead of D1') } } as never
    const readStore = { async getSeries(ownerUserId: string, seriesId: string) {
      expect(ownerUserId).toBe('user_1')
      expect(seriesId).toBe('series_1')
      return series
    }, async listCreatorSeries() { return [] } }

    await expect(getSeries(db, 'user_1', 'series_1', readStore)).resolves.toEqual(series)
    await expect(getSeries(db, 'user_2', 'series_1', {
      ...readStore, async getSeries() { return null },
    })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })

  it('uses the injected Neon reader for the bounded creator series list', async () => {
    const calls: unknown[][] = []
    const series = {
      id: 'series_1',
      ownerUserId: 'user_1',
      creatorId: 'user_1',
      ipId: null,
      state: 'DRAFT' as const,
      version: 1,
      title: 'Series 1',
      description: 'desc',
      coverRef: null,
      etag: 'W/"1"',
      createdAt: '2026-10-07T00:00:00.000Z',
      updatedAt: '2026-10-07T00:00:00.000Z',
    }
    const db = { prepare() { throw new Error('Neon reader must be used instead of D1') } } as never
    const readStore = {
      async getSeries() { return null },
      async listCreatorSeries(ownerUserId: string, cursor: { updatedAt: string; id: string } | null, limit: number) {
        calls.push([ownerUserId, cursor, limit])
        return [series, { ...series, id: 'series_2' }]
      },
    }

    const result = await listCreatorSeries(db, 'user_1', null, 1, readStore)
    expect(calls).toEqual([['user_1', null, 2]])
    expect(result.items).toEqual([series])
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toEqual(expect.any(String))
  })

  it('lists creator-owned series with one bounded D1 read and cursor pagination', async () => {
    const queries: string[] = []
    const db = {
      prepare(query: string) {
        queries.push(query)
        expect(query).toContain('FROM content_series')
        expect(query).toContain('WHERE owner_user_id = ?')
        expect(query).toContain('ORDER BY updated_at DESC, id DESC')
        expect(query).toContain('LIMIT ?')
        return {
          bind: () => ({
            all: async () => ({
              results: [{
                id: 'series_1',
                owner_user_id: 'user_1',
                creator_id: 'user_1',
                ip_id: null,
                state: 'DRAFT',
                version: 1,
                title: 'Series 1',
                description: 'desc',
                cover_ref: null,
                etag: 'W/"1"',
                created_at: '2026-10-07T00:00:00.000Z',
                updated_at: '2026-10-07T00:00:00.000Z',
              }],
            }),
          }),
        }
      },
    } as never

    const result = await listCreatorSeries(db, 'user_1', null, 10)
    expect(queries).toHaveLength(1)
    expect(result).toMatchObject({
      items: [{
        id: 'series_1',
        ownerUserId: 'user_1',
        creatorId: 'user_1',
        state: 'DRAFT',
        title: 'Series 1',
      }],
      hasMore: false,
      nextCursor: null,
    })
  })
})
