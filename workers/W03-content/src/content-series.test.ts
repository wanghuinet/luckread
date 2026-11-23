import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { getSeries, listCreatorSeries } from './content-series.js'

const makeSeries = (id = 'series_1') => ({
  id,
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
})

describe('W03 series foundation', () => {
  it('preserves historical series schema and lifecycle event provenance', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/migrations/0007_content_series.sql'),
      'utf8',
    )
    expect(migration).toContain('CREATE TABLE content_series')
    expect(migration).toContain('creator_id TEXT NOT NULL')
    expect(migration).toContain('CREATE INDEX content_series_owner_updated_idx')
    expect(migration).toContain("'series.created'")
    expect(migration).toContain("'series.updated'")
    expect(migration).toContain("'series.deleted'")
  })

  it('binds creator-series cursors to the owning user before querying Neon', async () => {
    const calls: unknown[][] = []
    const store = {
      async getSeries() { return null },
      async listCreatorSeries(ownerUserId: string, cursor: { updatedAt: string; id: string } | null, limit: number) {
        calls.push([ownerUserId, cursor, limit])
        return [makeSeries(), makeSeries('series_2')]
      },
    }
    const first = await listCreatorSeries(store, 'user_1', null, 1)
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)
    await expect(listCreatorSeries(store, 'user_2', first.nextCursor, 1)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
    expect(calls).toEqual([['user_1', null, 2]])
  })

  it('uses Neon for owner-scoped series detail reads and hides missing rows', async () => {
    const series = makeSeries()
    const calls: unknown[][] = []
    const store = {
      async getSeries(ownerUserId: string, seriesId: string) {
        calls.push([ownerUserId, seriesId])
        return ownerUserId === 'user_1' && seriesId === 'series_1' ? series : null
      },
      async listCreatorSeries() { return [] },
    }
    await expect(getSeries(store, 'user_1', 'series_1')).resolves.toEqual(series)
    await expect(getSeries(store, 'user_2', 'series_1')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(calls).toEqual([['user_1', 'series_1'], ['user_2', 'series_1']])
  })

  it('uses a bounded Neon read for creator pagination', async () => {
    const calls: unknown[][] = []
    const series = makeSeries()
    const store = {
      async getSeries() { return null },
      async listCreatorSeries(ownerUserId: string, cursor: { updatedAt: string; id: string } | null, limit: number) {
        calls.push([ownerUserId, cursor, limit])
        return [series, makeSeries('series_2')]
      },
    }
    const result = await listCreatorSeries(store, 'user_1', null, 1)
    expect(calls).toEqual([['user_1', null, 2]])
    expect(result.items).toEqual([series])
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toEqual(expect.any(String))
  })
})
