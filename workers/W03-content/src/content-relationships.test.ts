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


describe('W03 native social post thread authority', () => {
  it('adds ordered links only between the same owner public social posts', async () => {
    const statements: string[] = [];
    const db = {
      prepare(query: string) {
        statements.push(query);
        return {
          bind: (...values: unknown[]) => ({
            first: async () => {
              if (query.includes('AS source_owner_user_id')) {
                return {
                  source_id: 'post_root',
                  source_owner_user_id: 'user_1',
                  source_content_type: 'post',
                  source_state: 'DRAFT',
                  source_access_mode: 'PUBLIC',
                  target_id: 'post_next',
                  target_owner_user_id: 'user_1',
                  target_content_type: 'post',
                  target_state: 'DRAFT',
                  target_access_mode: 'PUBLIC',
                  idem_id: null,
                  idem_owner_user_id: null,
                  idem_request_hash: null,
                  idem_status: null,
                  idem_response_json: null,
                  idem_expires_at: null,
                };
              }
              return {
                previous_count: 1,
                next_count: 1,
                would_cycle: 0,
                source_has_next: 0,
                target_has_previous: 0,
              };
            },
          }),
        };
      },
      batch: async (batch: unknown[]) => { expect(batch).toHaveLength(4); return []; },
    } as never;

    const relation = await appendPostThreadNext(db, 'user_1', 'post_root', 'post_next', 'thread-link-1');
    expect(relation).toMatchObject({
      sourceId: 'post_root',
      targetId: 'post_next',
      relationType: 'thread-next',
      status: 'ACTIVE',
    });
    expect(statements[1]).toContain('WITH RECURSIVE');
    expect(statements[2]).toContain('NOT EXISTS (SELECT 1 FROM descendants WHERE id = s.id)');
    expect(statements[2]).toContain("r.relation_type = 'thread-next'");
  });

  it('rejects malformed IDs before any D1 access', async () => {
    const db = { prepare() { throw new Error('database should not be reached'); } } as never;
    await expect(appendPostThreadNext(db, 'user_1', '../root', 'post_next', 'idem')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
  });

  it('reads an ordered thread through one recursive D1 query and keeps owner drafts private', async () => {
    const queryLog: string[] = [];
    const db = {
      prepare(query: string) {
        queryLog.push(query);
        return {
          bind: () => ({
            all: async () => ({
              results: [
                {
                  id: 'post_root', slug: 'root', position: 0, state: 'DRAFT', access_mode: 'PUBLIC',
                  title: 'First post', body_ref: 'https://img.luckread.com/body/1.txt',
                  media_refs_json: '[]', cover_ref: null, created_at: '2026-11-05T00:00:00.000Z',
                },
                {
                  id: 'post_next', slug: 'next', position: 1, state: 'DRAFT', access_mode: 'PUBLIC',
                  title: 'Second post', body_ref: 'https://img.luckread.com/body/2.txt',
                  media_refs_json: '["https://img.luckread.com/photo.jpg"]',
                  cover_ref: 'https://img.luckread.com/photo.jpg', created_at: '2026-11-05T00:01:00.000Z',
                },
              ],
            }),
          }),
        };
      },
    } as never;

    const thread = await listPostThread(db, 'post_next', 'user_1');
    expect(queryLog).toHaveLength(1);
    expect(queryLog[0]).toContain('WITH RECURSIVE');
    expect(queryLog[0]).toContain("root_content.state = 'PUBLISHED' AND root_content.access_mode = 'PUBLIC'");
    expect(thread.rootContentId).toBe('post_root');
    expect(thread.items.map(item => item.id)).toEqual(['post_root', 'post_next']);
    expect(thread.items[1].mediaRefs).toEqual(['https://img.luckread.com/photo.jpg']);
  });

  it('routes thread reads publicly while keeping append behind the W01 authenticated social principal', async () => {
    const db = {
      prepare() {
        return {
          bind: () => ({
            all: async () => ({ results: [{
              id: 'post_root', slug: 'root', position: 0, state: 'PUBLISHED', access_mode: 'PUBLIC',
              title: 'First post', body_ref: 'https://img.luckread.com/body/1.txt',
              media_refs_json: '[]', cover_ref: null, created_at: '2026-11-05T00:00:00.000Z',
            }] }),
            first: async () => ({
              source_id: 'post_root', source_owner_user_id: 'user_1', source_content_type: 'post',
              source_state: 'PUBLISHED', source_access_mode: 'PUBLIC', target_id: 'post_next',
              target_owner_user_id: 'user_1', target_content_type: 'post', target_state: 'PUBLISHED',
              target_access_mode: 'PUBLIC', idem_id: null, idem_owner_user_id: null,
              idem_request_hash: null, idem_status: null, idem_response_json: null, idem_expires_at: null,
            }),
          }),
        };
      },
      batch: async () => [],
    } as never;
    const headers = {
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id': 'thread-route-test',
    };
    const publicResponse = await w03Worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/contents/post_root/thread', { headers }),
      { D1_02: db },
    );
    expect(publicResponse.status).toBe(200);
    await expect(publicResponse.json()).resolves.toMatchObject({ data: { rootContentId: 'post_root' } });

    const deniedResponse = await w03Worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/contents/post_root/thread', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json', 'Idempotency-Key': 'thread-link' },
        body: JSON.stringify({ nextContentId: 'post_next' }),
      }),
      { D1_02: db },
    );
    expect(deniedResponse.status).toBe(401);
  });
});
