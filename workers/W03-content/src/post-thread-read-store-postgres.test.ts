import { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { ContentRuntimeError } from './content-runtime.js'
import {
  createPostgresPostThreadReadStore,
  type PostThreadReadPostgresQueryExecutor,
} from './post-thread-read-store-postgres.js'

const row = {
  id: 'post_root',
  slug: 'root',
  position: 0,
  state: 'PUBLISHED' as const,
  access_mode: 'PUBLIC' as const,
  title: 'First post',
  body_ref: 'https://img.luckread.com/body/1.txt',
  media_refs_json: '[]',
  cover_ref: null,
  created_at: new Date('2026-11-14T00:00:00.000Z'),
}

describe('W03 PostgreSQL post-thread read store', () => {
  it('uses the same-owner recursive chain, public/draft visibility and cycle guard', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const database: PostThreadReadPostgresQueryExecutor = {
      async query<T extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [row as unknown as T] }
      },
    }

    const result = await createPostgresPostThreadReadStore(database).list('post_next', 'owner-1', 50)

    expect(result).toEqual([{
      ...row,
      created_at: '2026-11-14T00:00:00.000Z',
    }])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.values).toEqual(['post_next', 50, 'owner-1', 'owner-1', 50, 'owner-1', 'owner-1'])
    const sql = calls[0]?.sql ?? ''
    expect(sql).toContain('WITH RECURSIVE')
    expect(sql).toContain("r.relation_type = 'thread-next'")
    expect(sql).toContain("r.status = 'ACTIVE'")
    expect(sql).toContain('previous_content.owner_user_id = a.owner_user_id')
    expect(sql).toContain('next_content.owner_user_id = t.owner_user_id')
    expect(sql).toContain("root_content.state = 'PUBLISHED' AND root_content.access_mode = 'PUBLIC'")
    expect(sql).toContain('$3::text IS NOT NULL')
    expect(sql).toContain('$6::text IS NOT NULL')
    expect(sql).toContain("STRPOS(a.visited, '|' || r.source_id || '|') = 0")
    expect(sql).toContain("STRPOS(t.visited, '|' || r.target_id || '|') = 0")
    expect(sql).toContain('ORDER BY t.position ASC')
    expect(sql).not.toContain('instr(')
    expect(sql).not.toContain('?')
  })

  it('rejects an unbounded thread depth before issuing SQL', async () => {
    const query = vi.fn()
    const database = { query } as unknown as PostThreadReadPostgresQueryExecutor
    const store = createPostgresPostThreadReadStore(database)

    await expect(store.list('post_root', null, 51)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    })
    expect(query).not.toHaveBeenCalled()
  })

  it('maps PostgreSQL errors to a sanitized 503', async () => {
    const database = {
      async query() {
        throw new Error('private-connection-or-sql-detail')
      },
    } as unknown as PostThreadReadPostgresQueryExecutor

    await expect(createPostgresPostThreadReadStore(database).list('post_root', null, 50))
      .rejects.toBeInstanceOf(ContentRuntimeError)
    await expect(createPostgresPostThreadReadStore(database).list('post_root', null, 50))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })

  const postgresUrl = process.env.W03_POSTGRES_TEST_URL
  it.skipIf(!postgresUrl)('executes owner-only draft and public thread reads against PostgreSQL 18', async () => {
    const pool = new Pool({ connectionString: postgresUrl })
    const client = await pool.connect()
    let transactionStarted = false
    try {
      await client.query('BEGIN')
      transactionStarted = true
      await client.query(`CREATE TEMP TABLE contents (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        state TEXT NOT NULL,
        access_mode TEXT NOT NULL,
        title TEXT NOT NULL,
        body_ref TEXT NOT NULL,
        media_refs_json TEXT NOT NULL,
        cover_ref TEXT,
        created_at TIMESTAMPTZ NOT NULL
      ) ON COMMIT DROP`)
      await client.query(`CREATE TEMP TABLE content_relationships (
        relationship_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        status TEXT NOT NULL
      ) ON COMMIT DROP`)

      const insertContent = async (
        id: string,
        ownerUserId: string,
        state: 'DRAFT' | 'PUBLISHED',
        createdAt: string,
      ) => client.query(
        `INSERT INTO contents
          (id, owner_user_id, slug, state, access_mode, title, body_ref, media_refs_json, cover_ref, created_at)
         VALUES ($1, $2, $3, $4, 'PUBLIC', $5, $6, '[]', NULL, $7)`,
        [id, ownerUserId, id + '-slug', state, id + ' title', 'https://img.luckread.com/body/' + id, createdAt],
      )

      await insertContent('draft-root', 'owner-1', 'DRAFT', '2026-11-14T09:00:00.000Z')
      await insertContent('draft-next', 'owner-1', 'DRAFT', '2026-11-14T09:01:00.000Z')
      await insertContent('public-root', 'owner-2', 'PUBLISHED', '2026-11-14T09:02:00.000Z')
      await insertContent('public-next', 'owner-2', 'PUBLISHED', '2026-11-14T09:03:00.000Z')
      await client.query(
        `INSERT INTO content_relationships
          (relationship_id, source_id, target_id, relation_type, status)
         VALUES ('draft-edge', 'draft-root', 'draft-next', 'thread-next', 'ACTIVE'),
                ('public-edge', 'public-root', 'public-next', 'thread-next', 'ACTIVE')`,
      )

      const store = createPostgresPostThreadReadStore(
        client as unknown as PostThreadReadPostgresQueryExecutor,
      )
      const ownerDrafts = await store.list('draft-next', 'owner-1', 50)
      expect(ownerDrafts.map(item => item.id)).toEqual(['draft-root', 'draft-next'])
      expect(ownerDrafts[0]?.created_at).toBe('2026-11-14T09:00:00.000Z')
      await expect(store.list('draft-next', null, 50)).resolves.toEqual([])
      await expect(store.list('draft-next', 'owner-2', 50)).resolves.toEqual([])
      const publicThread = await store.list('public-next', null, 50)
      expect(publicThread.map(item => item.id)).toEqual(['public-root', 'public-next'])
    } finally {
      if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined)
      client.release()
      await pool.end()
    }
  })
})
