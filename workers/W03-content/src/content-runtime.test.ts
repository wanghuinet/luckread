import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { canTransitionContentState, decodeCursor, encodeCursor, isState, listContents, validateInput, validateListFilters } from './content-runtime.js'
import w03Worker, { hasCreatorContentPermission, parseListLimit } from './index.js'

describe('W03 content contract core', () => {
  it('accepts the canonical lifecycle vocabulary and cursor round-trip', () => {
    expect(isState('DRAFT')).toBe(true)
    expect(isState('APPROVED')).toBe(true)
    expect(isState('RESTORED')).toBe(true)
    expect(isState('REVIEW_PENDING')).toBe(false)

    const cursor = encodeCursor('2026-09-29T12:00:00.000Z', 'content_123')
    expect(decodeCursor(cursor)).toEqual({
      updatedAt: '2026-09-29T12:00:00.000Z',
      id: 'content_123',
    })
  })

  it('allows only the contracted creator and moderator transitions', () => {
    expect(canTransitionContentState('DRAFT', 'PENDING_REVIEW', 'CREATOR', true)).toBe(true)
    expect(canTransitionContentState('DRAFT', 'PUBLISHED', 'CREATOR', true)).toBe(false)
    expect(canTransitionContentState('PENDING_REVIEW', 'APPROVED', 'MODERATOR', false)).toBe(true)
    expect(canTransitionContentState('PENDING_REVIEW', 'REJECTED', 'MODERATOR', false)).toBe(true)
    expect(canTransitionContentState('PENDING_REVIEW', 'APPROVED', 'CREATOR', true)).toBe(false)
    expect(canTransitionContentState('PUBLISHED', 'PENDING_REVIEW', 'CREATOR', true, 'material_edit_requires_review')).toBe(true)
    expect(canTransitionContentState('PUBLISHED', 'PENDING_REVIEW', 'CREATOR', true, 'other')).toBe(false)
  })


  it('requires at least one media reference for video content', () => {
    expect(() =>
      validateInput({
        contentType: 'video',
        title: 'Video without media',
        bodyRef: 'https://cdn.example.com/body.txt',
        mediaRefs: [],
      }),
    ).toThrow()

    expect(validateInput({
      contentType: 'video',
      title: 'Video with media',
      bodyRef: 'https://cdn.example.com/body.txt',
      mediaRefs: ['https://cdn.example.com/video.mp4'],
    }).contentType).toBe('video')
  })

  it('rejects malformed and out-of-range public pagination limits', () => {
    expect(parseListLimit(null)).toBe(20)
    expect(parseListLimit('1')).toBe(1)
    expect(parseListLimit('50')).toBe(50)
    expect(() => parseListLimit('0')).toThrow()
    expect(() => parseListLimit('51')).toThrow()
    expect(() => parseListLimit('1.5')).toThrow()
    expect(() => parseListLimit('abc')).toThrow()
  })

  it('rejects invalid public content pagination at the worker boundary', async () => {
    const db = {
      prepare() {
        throw new Error('database should not be reached for invalid pagination')
      },
    } as never

    for (const limit of ['0', '51', '1.5', 'abc']) {
      const response = await w03Worker.fetch(
        new Request('https://luckread-w03.internal/internal/content/contents?limit=' + limit, {
          headers: {
            'X-LuckRead-Caller': 'W01',
            'X-LuckRead-Transport-Version': '1.0',
            'X-LuckRead-Correlation-Id': 'test-correlation-' + limit,
          },
        }),
        { D1_02: db },
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'VALIDATION_FAILED' },
      })
    }
  })


  it('filters public content by content type', async () => {
    const preparedQueries: string[] = []
    const row = {
      id: 'content_video_123',
      content_type: 'video',
      owner_user_id: 'user_123',
      creator_id: 'user_123',
      ip_id: null,
      state: 'PUBLISHED',
      version: 1,
      revision: 1,
      title: 'Published video',
      body_ref: 'https://cdn.example.com/body.txt',
      media_refs_json: '[]',
      cover_ref: null,
      etag: 'W/"1"',
      created_at: '2026-10-02T12:00:00.000Z',
      updated_at: '2026-10-02T12:01:00.000Z',
    }

    const db = {
      prepare(query: string) {
        preparedQueries.push(query)
        return {
          bind: () => ({
            all: async () => ({ results: [row] }),
          }),
        }
      },
    } as never

    const page = await listContents(db, null, 20, null, 'video')

    expect(page.items[0]?.contentType).toBe('video')
    expect(preparedQueries[0]).toContain("WHERE state = 'PUBLISHED' AND content_type = ?")
  })

  it('requires L3 or higher for creator content operations', () => {
    expect(hasCreatorContentPermission('L3')).toBe(true)
    expect(hasCreatorContentPermission('L8')).toBe(true)
    expect(hasCreatorContentPermission('L2')).toBe(false)
    expect(hasCreatorContentPermission('')).toBe(false)
    expect(hasCreatorContentPermission('creator')).toBe(false)
  })

  it('validates creator content list filters', () => {
    expect(validateListFilters('DRAFT', 'video')).toEqual({ status: 'DRAFT', contentType: 'video' })
    expect(validateListFilters(null, null)).toEqual({})
    expect(() => validateListFilters('UNKNOWN', null)).toThrow()
    expect(() => validateListFilters(null, 'audio')).toThrow()
  })

  it('rejects invalid cursors and forbidden direct publication transitions', () => {
    expect(() => decodeCursor('not-a-valid-cursor')).toThrow()
    expect(canTransitionContentState('DRAFT', 'PUBLISHED', 'CREATOR', true)).toBe(false)
    expect(canTransitionContentState('DELETED', 'PUBLISHED', 'CREATOR', true)).toBe(false)
    expect(canTransitionContentState('ARCHIVED', 'PUBLISHED', 'CREATOR', true)).toBe(false)
    expect(canTransitionContentState('DELETED', 'RESTORED', 'CREATOR', true)).toBe(true)
    expect(canTransitionContentState('RESTORED', 'DRAFT', 'CREATOR', true)).toBe(true)
    expect(canTransitionContentState('RESTORED', 'PENDING_REVIEW', 'CREATOR', true)).toBe(false)
  })

  it('keeps the D1 batch fail-closed CAS guard on every content mutation', () => {
    const runtime = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/src/content-runtime.ts'),
      'utf8',
    )

    for (const functionName of [
      'createContent',
      'updateContent',
      'deleteContent',
      'transitionContentState',
      'applyModerationContentTransition',
    ]) {
      const start = runtime.indexOf('export async function ' + functionName)
      expect(start).toBeGreaterThanOrEqual(0)
      const end = runtime.indexOf('\nexport ', start + 10)
      const section = runtime.slice(start, end >= 0 ? end : runtime.length)
      expect(section).toContain('await batchMutation(db, [')
      expect(section).toContain('atomicGuard(db)')
    }

    expect(runtime).toContain('INSERT OR REPLACE INTO content_txn_guard')
    expect(runtime).toContain('VALUES (1, changes())')
    expect(runtime).toContain("successful INTEGER NOT NULL CHECK (successful = 1)")
    expect(readFileSync(resolve(process.cwd(), 'workers/W03-content/migrations/0001_content_core.sql'), 'utf8')).toContain(
      'CREATE TABLE content_txn_guard',
    )
  })

  it('returns media references from the public listing query', async () => {
    const preparedQueries: string[] = []
    const row = {
      id: 'content_123',
      content_type: 'article',
      owner_user_id: 'user_123',
      creator_id: 'user_123',
      ip_id: null,
      state: 'PUBLISHED',
      version: 2,
      revision: 2,
      title: 'Published article',
      body_ref: 'https://cdn.example.com/body.txt',
      media_refs_json: '["https://cdn.example.com/image.jpg"]',
      cover_ref: 'https://cdn.example.com/image.jpg',
      etag: 'W/"2"',
      created_at: '2026-10-01T12:00:00.000Z',
      updated_at: '2026-10-01T12:01:00.000Z',
    }

    const db = {
      prepare(query: string) {
        preparedQueries.push(query)
        return {
          bind: () => ({
            all: async () => ({ results: [row] }),
          }),
        }
      },
    } as never

    const page = await listContents(db, null, 20)

    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.mediaRefs).toEqual(['https://cdn.example.com/image.jpg'])
    expect(preparedQueries[0]).toContain('media_refs_json')
    expect(preparedQueries[0]).toContain('cover_ref')
  })



  it('filters public content by creator while keeping only published rows', async () => {
    const preparedQueries: string[] = []
    const row = {
      id: 'creator_content_123',
      content_type: 'article',
      owner_user_id: 'user_123',
      creator_id: 'user_123',
      ip_id: null,
      state: 'PUBLISHED',
      version: 1,
      revision: 1,
      title: 'Creator article',
      body_ref: 'https://cdn.example.com/body.txt',
      media_refs_json: '[]',
      cover_ref: null,
      etag: 'W/"1"',
      created_at: '2026-10-02T12:00:00.000Z',
      updated_at: '2026-10-02T12:01:00.000Z',
    }

    const db = {
      prepare(query: string) {
        preparedQueries.push(query)
        return {
          bind: () => ({
            all: async () => ({ results: [row] }),
          }),
        }
      },
    } as never

    const page = await listContents(db, null, 6, 'user_123')

    expect(page.items[0]?.creatorId).toBe('user_123')
    expect(preparedQueries[0]).toContain("WHERE state = 'PUBLISHED' AND creator_id = ?")
  })

  it('serves published content detail without a creator principal', async () => {
    const row = {
      id: 'content_public_123',
      content_type: 'article',
      owner_user_id: 'user_123',
      creator_id: 'user_123',
      ip_id: null,
      state: 'PUBLISHED',
      version: 2,
      revision: 2,
      title: 'Public article',
      body_ref: 'https://cdn.example.com/body.txt',
      media_refs_json: '[]',
      cover_ref: null,
      etag: 'W/"2"',
      created_at: '2026-10-01T12:00:00.000Z',
      updated_at: '2026-10-01T12:01:00.000Z',
    }

    const db = {
      prepare(query: string) {
        expect(query).toContain("AND (state = 'PUBLISHED' OR owner_user_id = ?)")
        return {
          bind: () => ({
            first: async () => row,
          }),
        }
      },
    } as never

    const response = await w03Worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/contents/content_public_123', {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'test-correlation-public',
        },
      }),
      { D1_02: db },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      id: 'content_public_123',
      creatorId: 'user_123',
      state: 'PUBLISHED',
      title: 'Public article',
    })
  })

  it('does not expose non-published content to an anonymous detail request', async () => {
    const db = {
      prepare(query: string) {
        expect(query).toContain("AND (state = 'PUBLISHED' OR owner_user_id = ?)")
        return {
          bind: () => ({
            first: async () => undefined,
          }),
        }
      },
    } as never

    const response = await w03Worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/contents/content_private_123', {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'test-correlation-private',
        },
      }),
      { D1_02: db },
    )

    expect(response.status).toBe(404)
  })

})
