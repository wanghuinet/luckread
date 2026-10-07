import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { canTransitionContentState, createContent, decodeCursor, encodeCursor, isState, listContents, transitionContentState, validateInput, validateListFilters } from './content-runtime.js'
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
    const migration = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/migrations/0001_content_core.sql'),
      'utf8',
    )
    expect(migration).toContain('CREATE TABLE content_txn_guard')
    expect(migration).toContain('successful INTEGER NOT NULL CHECK (successful = 1)')
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

  it('resolves a published content request by stable slug in one D1 read', async () => {
    const slug = '中文文章-1234567890abcdef1234567890abcdef'
    const row = {
      id: 'content_slug_123',
      content_type: 'article',
      owner_user_id: 'user_123',
      creator_id: 'user_123',
      ip_id: null,
      state: 'PUBLISHED',
      version: 3,
      revision: 3,
      slug,
      title: '中文文章',
      body_ref: 'https://cdn.example.com/body.json',
      media_refs_json: '[]',
      cover_ref: null,
      etag: 'W/"3"',
      created_at: '2026-10-01T12:00:00.000Z',
      updated_at: '2026-10-03T12:01:00.000Z',
    }
    const queries: string[] = []
    const db = {
      prepare(query: string) {
        queries.push(query)
        return {
          bind: (...bindings: unknown[]) => ({
            first: async () => {
              expect(bindings).toEqual([slug, slug, ''])
              return row
            },
          }),
        }
      },
    } as never

    const response = await w03Worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/contents/' + encodeURIComponent(slug), {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'test-correlation-slug',
        },
      }),
      { D1_02: db },
    )

    expect(response.status).toBe(200)
    expect(queries[0]).toContain('WHERE (id = ? OR slug = ?)')
    await expect(response.json()).resolves.toMatchObject({
      id: row.id,
      slug,
      title: row.title,
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

  it('keeps create idempotency replay byte-stable across retry time', async () => {
    const original = {
      id: 'content_create_123',
      contentType: 'article',
      ownerUserId: 'user_123',
      creatorId: 'user_123',
      ipId: null,
      state: 'DRAFT',
      version: 1,
      revision: 1,
      slug: 'draft-content-abcdef',
      title: 'Draft content',
      bodyRef: 'https://cdn.example.com/body.json',
      mediaRefs: [],
      coverRef: null,
      etag: 'W/"1"',
      createdAt: '2026-10-07T07:00:00.000Z',
      updatedAt: '2026-10-07T07:00:00.000Z',
    }

    const canonicalize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonicalize)
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, nested]) => [key, canonicalize(nested)]),
        )
      }
      return value
    }

    const hashInput = canonicalize({
      operationId: 'createContent',
      input: {
        ownerUserId: 'user_123',
        input: {
          contentType: 'article',
          title: 'Draft content',
          bodyRef: 'https://cdn.example.com/body.json',
          mediaRefs: [],
          coverRef: null,
        },
      },
    })
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(hashInput)),
    )
    const hashHex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')

    const db = {
      prepare() {
        return {
          bind: () => ({
            first: async () => ({
              idem_id: 'idem_123',
              idem_owner_user_id: 'user_123',
              idem_request_hash: hashHex,
              idem_status: 'COMPLETED',
              idem_response_status: 201,
              idem_response_json: JSON.stringify(original),
              idem_expires_at: '2026-10-08T07:00:00.000Z',
            }),
          }),
        }
      },
      batch: async () => {
        throw new Error('batch should not run on an idempotency replay')
      },
    } as never

    const result = await createContent(
      db,
      'user_123',
      {
        contentType: 'article',
        title: 'Draft content',
        bodyRef: 'https://cdn.example.com/body.json',
        mediaRefs: [],
        coverRef: null,
      },
      'create-key',
      new Date('2026-10-07T08:00:00.000Z'),
    )

    expect(result).toEqual(original)
  })

  it('stores the full ContentRecord for update idempotency replay', () => {
    const runtime = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/src/content-runtime.ts'),
      'utf8',
    )
    const start = runtime.indexOf('export async function updateContent')
    const end = runtime.indexOf('\nexport async function deleteContent', start)
    const section = runtime.slice(start, end)
    expect(section).toContain('const idempotencyResponseBody = JSON.stringify(updated)')
    expect(section).toContain(
      'insertCompletedIdempotency(db, principalUserId, operationId, idempotencyKey, hash, 200, idempotencyResponseBody, updatedAt, expiresAt),',
    )
    expect(section).toContain('return updated')
  })




describe('1.1 content revision history', () => {
  it('defines immutable revision persistence with the required audit fields', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/migrations/0004_content_revision_history.sql'),
      'utf8',
    )
    expect(migration).toContain('CREATE TABLE content_revisions')
    expect(migration).toContain('UNIQUE(content_id, revision)')
    expect(migration).toContain('actor_user_id TEXT NOT NULL')
    expect(migration).toContain('source_revision INTEGER')
    expect(migration).toContain('correlation_id TEXT NOT NULL')
    expect(migration).toContain('CREATE INDEX content_revisions_content_created_idx')
    expect(migration).toContain('legacy_backfill')
  })

  it('defines the stable slug migration and trigger payload', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/migrations/0005_content_stable_slug.sql'),
      'utf8',
    )
    expect(migration).toContain('ALTER TABLE contents ADD COLUMN slug TEXT NOT NULL DEFAULT')
    expect(migration).toContain('CREATE UNIQUE INDEX contents_slug_unique_idx')
    expect(migration).toContain('ALTER TABLE content_revisions ADD COLUMN slug TEXT NOT NULL DEFAULT')
    expect(migration).toContain("'slug'")
    expect(migration).toContain('content.created')
  })

  it('keeps the rollback transport path under the revision contract', () => {
    const index = readFileSync(resolve(process.cwd(), 'workers/W03-content/src/index.ts'), 'utf8')
    const w01Detail = readFileSync(resolve(process.cwd(), 'workers/W01-payload/src/app/api/v1/contents/[contentId]/revisions/[revisionId]/route.ts'), 'utf8')
    const w01Rollback = readFileSync(resolve(process.cwd(), 'workers/W01-payload/src/app/api/v1/contents/[contentId]/revisions/[revisionId]/rollback/route.ts'), 'utf8')
    expect(index).toContain('rollbackContentRevision')
    expect(index).toContain('path.rollback')
    expect(w01Detail).toContain('export async function GET')
    expect(w01Detail).not.toContain("export async function POST")
    expect(w01Rollback).toContain("pathname: '/internal/content/contents/' + encodeURIComponent(contentId) + '/revisions/' + encodeURIComponent(revisionId) + '/rollback'")
  })

  it('records create, update and rollback history after the authoritative CAS guard', () => {
    const runtime = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/src/content-runtime.ts'),
      'utf8',
    )
    for (const operation of ["operation: 'CREATE'", "operation: 'UPDATE'", "operation: 'ROLLBACK'"]) {
      expect(runtime).toContain(operation)
    }
    expect(runtime).toContain("'content.revision.rolled_back'")
    for (const marker of ['export async function listContentRevisions', 'export async function getContentRevision', 'export async function rollbackContentRevision']) {
      expect(runtime).toContain(marker)
    }

    const updateIndex = runtime.indexOf('UPDATE contents')
    const updateGuard = runtime.indexOf('atomicGuard(db)', updateIndex)
    const updateRevision = runtime.indexOf("operation: 'UPDATE'", updateIndex)
    expect(updateIndex).toBeGreaterThanOrEqual(0)
    expect(updateGuard).toBeGreaterThan(updateIndex)
    expect(updateRevision).toBeGreaterThan(updateGuard)

    const rollbackIndex = runtime.indexOf('export async function rollbackContentRevision')
    expect(runtime.indexOf('UPDATE contents', rollbackIndex)).toBeGreaterThanOrEqual(rollbackIndex)
    expect(runtime.indexOf("operation: 'ROLLBACK'", rollbackIndex)).toBeGreaterThan(
      runtime.indexOf('atomicGuard(db)', rollbackIndex),
    )
  })
})
