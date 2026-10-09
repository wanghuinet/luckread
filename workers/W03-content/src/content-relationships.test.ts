import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  listContentRelationships,
} from './content-relationships.js'
import w03Worker from './index.js'

describe('W03 content relationship foundation', () => {
  it('defines constrained authoritative relationship persistence', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/migrations/0006_content_relationships.sql'),
      'utf8',
    )
    expect(migration).toContain('CREATE TABLE content_relationships')
    expect(migration).toContain("source_type TEXT NOT NULL CHECK (source_type = 'content')")
    expect(migration).toContain("relation_type TEXT NOT NULL CHECK (relation_type = 'reference')")
    expect(migration).toContain("status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED', 'SUPERSEDED'))")
    expect(migration).toContain('CREATE UNIQUE INDEX content_relationships_active_unique_idx')
    expect(migration).toContain('content.relationship.created')
    expect(migration).toContain('content.relationship.revoked')
  })

  it('lists only active relationships between published content in one bounded D1 read', async () => {
    const row = {
      relationship_id: 'rel_123',
      relation_type: 'reference',
      created_at: '2026-10-07T00:00:00.000Z',
      related_id: 'content_2',
      related_slug: 'other-content-abcdef',
      related_type: 'article',
      related_title: 'Other content',
      relation_direction: 'out',
    }
    const queries: string[] = []
    const db = {
      prepare(query: string) {
        queries.push(query)
        expect(query).toContain("r.status = 'ACTIVE'")
        expect(query).toContain("s.state = 'PUBLISHED'")
        expect(query).toContain("t.state = 'PUBLISHED'")
        expect(query).toContain('LIMIT ?')
        return {
          bind: () => ({
            all: async () => ({ results: [row] }),
          }),
        }
      },
    } as never

    const result = await listContentRelationships(db, 'content_1', 'out', null, 10)
    expect(queries).toHaveLength(1)
    expect(result.items).toEqual([{
      relationshipId: 'rel_123',
      relationType: 'reference',
      direction: 'out',
      relatedContent: {
        id: 'content_2',
        slug: 'other-content-abcdef',
        contentType: 'article',
        title: 'Other content',
      },
      createdAt: '2026-10-07T00:00:00.000Z',
    }])
  })

  it('binds relationship cursors to content ID and direction', async () => {
    const row = {
      relationship_id: 'rel_123',
      relation_type: 'reference',
      created_at: '2026-10-07T00:00:00.000Z',
      related_id: 'content_2',
      related_slug: 'other-content-abcdef',
      related_type: 'article',
      related_title: 'Other content',
      relation_direction: 'out',
    }
    const prepare = () => ({
      bind: () => ({ all: async () => ({ results: [row, { ...row, relationship_id: 'rel_124' }] }) }),
    })
    const db = { prepare } as never
    const first = await listContentRelationships(db, 'content_1', 'out', null, 1)
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toEqual(expect.any(String))
    await expect(listContentRelationships(db, 'content_2', 'out', first.nextCursor, 1)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
    await expect(listContentRelationships(db, 'content_1', 'in', first.nextCursor, 1)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
  })

  it('bounds and validates direction before the D1 read', async () => {
    const db = {
      prepare() {
        throw new Error('database should not be reached')
      },
    } as never

    await expect(listContentRelationships(db, 'content_1', 'invalid' as never)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    })
  })

  it('keeps create and revoke mutations behind idempotency and the D1 fail-closed guard', () => {
    const runtime = readFileSync(
      resolve(process.cwd(), 'workers/W03-content/src/content-relationships.ts'),
      'utf8',
    )
    expect(runtime).toContain('export async function createContentRelationship')
    expect(runtime).toContain('export async function revokeContentRelationship')
    expect(runtime).toContain('Idempotency-Key')
    expect(runtime).toContain('content_txn_guard')
    expect(runtime).toContain('INSERT OR REPLACE INTO content_txn_guard')
    expect(runtime).toContain('WHERE r.relationship_id = ? AND r.source_id = ?')
    expect(runtime).toContain("relationshipHash(operationId, { ownerUserId, relationshipId })")
  })

  it('keeps relationship transport behind W01 caller authentication', async () => {
    const db = {
      prepare() {
        throw new Error('database should not be reached')
      },
    } as never
    const response = await w03Worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/contents/content_1/relationships', {
        headers: {
          'X-LuckRead-Caller': 'external',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'relationship-test',
        },
      }),
      { D1_02: db },
    )
    expect(response.status).toBe(403)
  })

  it('routes public relationship reads without requiring a creator principal', async () => {
    const db = {
      prepare() {
        return {
          bind: () => ({
            all: async () => ({ results: [] }),
          }),
        }
      },
    } as never
    const response = await w03Worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/contents/content_1/relationships?direction=both&limit=10', {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'relationship-public',
        },
      }),
      { D1_02: db },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { items: [], hasMore: false, nextCursor: null },
    })
  })
})
