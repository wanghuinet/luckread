import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { actorKindForLayer, canTransitionContentState, createContent, decodeCursor, encodeCursor, isState, listContents, publishDueScheduledContent, transitionContentState, updateContent, validateInput, validateListFilters } from './content-runtime.js'
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

  it('rejects update requests that change the immutable content type', async () => {
    const row = {
      id: 'content_type_guard_123',
      content_type: 'article',
      owner_user_id: 'user_type_guard',
      creator_id: 'user_type_guard',
      ip_id: null,
      state: 'DRAFT',
      version: 1,
      revision: 1,
      slug: 'original-slug',
      title: 'Original article',
      body_ref: 'https://cdn.example.com/body.txt',
      media_refs_json: '[]',
      cover_ref: null,
      etag: 'W/"1"',
      created_at: '2026-10-07T12:00:00.000Z',
      updated_at: '2026-10-07T12:00:00.000Z',
      idem_id: null,
      idem_owner_user_id: null,
      idem_request_hash: null,
      idem_status: null,
      idem_response_status: null,
      idem_response_json: null,
      idem_expires_at: null,
    }
    let prepareCount = 0
    const db = {
      prepare() {
        prepareCount += 1
        return {
          bind: () => ({
            first: async () => row,
          }),
        }
      },
    } as never

    await expect(
      updateContent(
        db,
        'user_type_guard',
        'content_type_guard_123',
        {
          contentType: 'video',
          title: 'Attempted type change',
          bodyRef: 'https://cdn.example.com/video-body.txt',
          mediaRefs: ['https://cdn.example.com/video.mp4'],
          coverRef: null,
        },
        'W/"1"',
        'content-type-guard-idem',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    expect(prepareCount).toBe(1)
  })

  it('allows only the contracted creator and moderator transitions', () => {
    expect(canTransitionContentState('DRAFT', 'PENDING_REVIEW', 'CREATOR', true)).toBe(true)
    expect(canTransitionContentState('DRAFT', 'PUBLISHED', 'CREATOR', true)).toBe(false)
    expect(canTransitionContentState('PENDING_REVIEW', 'APPROVED', 'MODERATOR', false)).toBe(true)
    expect(canTransitionContentState('PENDING_REVIEW', 'REJECTED', 'MODERATOR', false)).toBe(true)
    expect(canTransitionContentState('APPROVED', 'SCHEDULED', 'CREATOR', true)).toBe(true)
    expect(canTransitionContentState('SCHEDULED', 'DRAFT', 'CREATOR', true)).toBe(true)
    expect(canTransitionContentState('SCHEDULED', 'PUBLISHED', 'CREATOR', true)).toBe(false)
    expect(canTransitionContentState('PENDING_REVIEW', 'APPROVED', 'CREATOR', true)).toBe(false)
    expect(canTransitionContentState('PUBLISHED', 'PENDING_REVIEW', 'CREATOR', true, 'material_edit_requires_review')).toBe(true)
    expect(canTransitionContentState('PUBLISHED', 'PENDING_REVIEW', 'CREATOR', true, 'other')).toBe(false)
  })


  it('requires a future timestamp before scheduling an approved content item', async () => {
    const db = {
      prepare() {
        throw new Error('database should not be reached for invalid scheduledAt')
      },
    } as never

    await expect(
      transitionContentState(
        db,
        'user_schedule',
        'L3',
        'content_schedule_123',
        'SCHEDULED',
        undefined,
        'W/"1"',
        'schedule-idem',
        new Date('2026-10-08T12:00:00.000Z'),
        { scheduledAt: '2026-10-08T11:59:59.000Z' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })

  it('publishes only due scheduled rows and converges concurrent execution safely', async () => {
    const statements: Array<{ query: string; bindings: unknown[] }> = []
    const dueRows = [
      { id: 'scheduled_due_1', version: 4, scheduled_at: '2026-10-08T12:00:00.000Z' },
      { id: 'scheduled_due_2', version: 7, scheduled_at: '2026-10-08T12:01:00.000Z' },
    ]
    const db = {
      prepare(query: string) {
        if (query.includes('FROM contents')) {
          return {
            bind: (...bindings: unknown[]) => ({
              all: async () => ({ results: dueRows }),
              first: async () => undefined,
              bindings,
            }),
          }
        }
        return {
          bind: (...bindings: unknown[]) => {
            statements.push({ query, bindings })
            return { query, bindings }
          },
        }
      },
      batch: async (items: Array<{ query: string }>) => items.map(() => ({ meta: { changes: 1 } })),
    } as never

    await expect(
      publishDueScheduledContent(db, new Date('2026-10-08T12:02:00.000Z'), 50),
    ).resolves.toEqual({ scanned: 2, published: 2 })

    expect(statements).toHaveLength(2)
    expect(statements[0]?.query).toContain("SET state = 'PUBLISHED', scheduled_at = NULL")
    expect(statements[0]?.query).toContain("WHERE id = ? AND state = 'SCHEDULED'")
    expect(statements[0]?.bindings).toEqual([
      5,
      'W/"5"',
      '2026-10-08T12:02:00.000Z',
      'scheduled_due_1',
      '2026-10-08T12:00:00.000Z',
      4,
    ])
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

  it('keeps creator state-transition actor mapping aligned with L3-L8 permissions', () => {
    expect(actorKindForLayer('L3')).toBe('CREATOR')
    expect(actorKindForLayer('L4')).toBe('CREATOR')
    expect(actorKindForLayer('L8')).toBe('CREATOR')
    expect(actorKindForLayer('L2')).toBeNull()
    expect(actorKindForLayer('L9')).toBeNull()
    expect(actorKindForLayer('creator')).toBeNull()
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

  it('defines scheduled publication persistence and trigger wiring', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/migrations/0011_content_scheduled_publish.sql'),
      'utf8',
    )
    expect(migration).toContain('ALTER TABLE contents ADD COLUMN scheduled_at TEXT')
    expect(migration).toContain('CREATE INDEX contents_scheduled_due_idx')
    const wrangler = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/wrangler.jsonc'),
      'utf8',
    )
    expect(wrangler).toContain('"crons": ["* * * * *"]')
    const runtime = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/src/index.ts'),
      'utf8',
    )
    expect(runtime).toContain('async scheduled(controller: ScheduledController, env: Env)')
    expect(runtime).toContain('publishDueScheduledContent')
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


it('maps an authoritative D1 CAS guard failure to HTTP 412', async () => {
  const row = {
    id: 'content_cas_412_123',
    content_type: 'article',
    owner_user_id: 'user_cas_412',
    creator_id: 'user_cas_412',
    ip_id: null,
    state: 'DRAFT',
    version: 2,
    revision: 2,
    slug: 'cas-412',
    title: 'CAS guard test',
    body_ref: 'https://cdn.example.com/body.txt',
    media_refs_json: '[]',
    cover_ref: null,
    etag: 'W/"2"',
    created_at: '2026-10-07T12:00:00.000Z',
    updated_at: '2026-10-07T12:01:00.000Z',
    idem_id: null,
    idem_owner_user_id: null,
    idem_request_hash: null,
    idem_status: null,
    idem_response_status: null,
    idem_response_json: null,
    idem_expires_at: null,
  }
  const db = {
    prepare() {
      return { bind: (...bindings: unknown[]) => ({ first: async () => { expect(bindings).toContain('content_cas_412_123'); return row } }) }
    },
    batch: async () => { throw new Error('CHECK constraint failed: successful') },
  } as never
  await expect(updateContent(
    db,
    'user_cas_412',
    'content_cas_412_123',
    { contentType: 'article', title: 'Updated title', bodyRef: 'https://cdn.example.com/body-v2.txt', mediaRefs: [], coverRef: null },
    'W/"2"',
    'content-cas-412-idem',
  )).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', status: 412 })
})

it('does not misclassify unrelated UNIQUE violations as idempotency conflicts', async () => {
  const row = {
    id: 'content_unique_123',
    content_type: 'article',
    owner_user_id: 'user_unique',
    creator_id: 'user_unique',
    ip_id: null,
    state: 'DRAFT',
    version: 1,
    revision: 1,
    slug: 'unique-test',
    title: 'Unique test',
    body_ref: 'https://cdn.example.com/body.txt',
    media_refs_json: '[]',
    cover_ref: null,
    etag: 'W/"1"',
    created_at: '2026-10-07T12:00:00.000Z',
    updated_at: '2026-10-07T12:00:00.000Z',
    idem_id: null,
    idem_owner_user_id: null,
    idem_request_hash: null,
    idem_status: null,
    idem_response_status: null,
    idem_response_json: null,
    idem_expires_at: null,
  }
  const db = {
    prepare() {
      return { bind: (...bindings: unknown[]) => ({ first: async () => { expect(bindings).toContain('content_unique_123'); return row } }) }
    },
    batch: async () => { throw new Error('UNIQUE constraint failed: contents.body_ref') },
  } as never
  await expect(updateContent(
    db,
    'user_unique',
    'content_unique_123',
    { contentType: 'article', title: 'Updated title', bodyRef: 'https://cdn.example.com/body-v2.txt', mediaRefs: [], coverRef: null },
    'W/"1"',
    'content-unique-idem',
  )).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
})

it('locks content edits while moderation review is pending', async () => {
  const row = {
    id: 'content_review_lock_123',
    content_type: 'article',
    owner_user_id: 'user_review_lock',
    creator_id: 'user_review_lock',
    ip_id: null,
    state: 'PENDING_REVIEW',
    version: 2,
    revision: 2,
    slug: 'review-lock',
    title: 'Under review article',
    body_ref: 'https://cdn.example.com/body.txt',
    media_refs_json: '[]',
    cover_ref: null,
    etag: 'W/"2"',
    created_at: '2026-10-07T12:00:00.000Z',
    updated_at: '2026-10-07T12:01:00.000Z',
    idem_id: null,
    idem_owner_user_id: null,
    idem_request_hash: null,
    idem_status: null,
    idem_response_status: null,
    idem_response_json: null,
    idem_expires_at: null,
  }
  let batchCalled = false
  const db = {
    prepare() {
      return { bind: () => ({ first: async () => row }) }
    },
    batch: async () => { batchCalled = true },
  } as never
  await expect(updateContent(
    db,
    'user_review_lock',
    'content_review_lock_123',
    { contentType: 'article', title: 'Attempted edit during review', bodyRef: 'https://cdn.example.com/body-v2.txt', mediaRefs: [], coverRef: null },
    'W/"2"',
    'review-lock-idem',
  )).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
  expect(batchCalled).toBe(false)
})

it('returns 409 for an owned but invalid lifecycle transition', async () => {
  const content = {
    id: 'content_123',
    content_type: 'article',
    owner_user_id: 'user_123',
    creator_id: 'user_123',
    ip_id: null,
    state: 'DRAFT',
    version: 1,
    revision: 1,
    slug: 'draft-content-abcdef',
    title: 'Draft content',
    body_ref: 'https://cdn.example.com/body.json',
    media_refs_json: '[]',
    cover_ref: null,
    etag: 'W/"1"',
    created_at: '2026-10-07T00:00:00.000Z',
    updated_at: '2026-10-07T00:00:00.000Z',
  }
  const db = {
    prepare() { return { bind: () => ({ first: async () => content }) } },
    batch: async () => { throw new Error('batch should not run for an invalid transition') },
  } as never
  await expect(transitionContentState(
    db,
    'user_123',
    'L3',
    'content_123',
    'PUBLISHED',
    undefined,
    'W/"1"',
    'transition-invalid-state',
  )).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
})

it('blocks moderator layers from the generic state-transition path', async () => {
  const db = {
    prepare() { throw new Error('generic moderator transition must not reach D1') },
  } as never
  for (const layer of ['L6', 'L7', 'L8']) {
    await expect(transitionContentState(
      db,
      'moderator_123',
      layer,
      'content_123',
      'APPROVED',
      undefined,
      'W/"2"',
      'moderation-bypass-test-' + layer,
    )).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
  }
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
    batch: async () => { throw new Error('batch should not run on an idempotency replay') },
  } as never
  const result = await createContent(
    db,
    'user_123',
    { contentType: 'article', title: 'Draft content', bodyRef: 'https://cdn.example.com/body.json', mediaRefs: [], coverRef: null },
    'create-key',
    new Date('2026-10-07T08:00:00.000Z'),
  )
  expect(result).toEqual(original)
})

describe('1.1 content lifecycle idempotency', () => {
  it('replays a duplicate publish transition without advancing the content version', async () => {
    const contentId = 'content_publish_retry_123'
    const idempotencyKey = 'publish-retry-key'
    const ifMatch = 'W/"4"'
    const result = {
      from: 'APPROVED',
      to: 'PUBLISHED',
      version: 5,
      etag: 'W/"5"',
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
      operationId: 'transitionContentState',
      input: {
        contentId,
        to: 'PUBLISHED',
        reason: null,
        ifMatch: '4',
      },
    })
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(hashInput)),
    )
    const requestHash = Array.from(
      new Uint8Array(digest),
      byte => byte.toString(16).padStart(2, '0'),
    ).join('')

    let batchCalled = false
    const db = {
      prepare() {
        return {
          bind: () => ({
            first: async () => ({
              id: contentId,
              content_type: 'article',
              owner_user_id: 'user_publish_retry',
              creator_id: 'user_publish_retry',
              ip_id: null,
              state: 'APPROVED',
              version: 4,
              revision: 4,
              slug: 'publish-retry',
              title: 'Retry-safe publish',
              body_ref: 'https://cdn.example.com/body.json',
              media_refs_json: '[]',
              cover_ref: null,
              etag: ifMatch,
              created_at: '2026-10-08T00:00:00.000Z',
              updated_at: '2026-10-08T00:01:00.000Z',
              idem_id: 'idem_publish_retry',
              idem_owner_user_id: 'user_publish_retry',
              idem_request_hash: requestHash,
              idem_status: 'COMPLETED',
              idem_response_status: 200,
              idem_response_json: JSON.stringify(result),
              idem_expires_at: '2026-10-09T00:00:00.000Z',
            }),
          }),
        }
      },
      batch: async () => {
        batchCalled = true
        throw new Error('duplicate publish must not write a second transition')
      },
    } as never

    await expect(
      transitionContentState(
        db,
        'user_publish_retry',
        'L3',
        contentId,
        'PUBLISHED',
        undefined,
        ifMatch,
        idempotencyKey,
        new Date('2026-10-08T00:02:00.000Z'),
      ),
    ).resolves.toEqual(result)

    expect(batchCalled).toBe(false)
  })
})
