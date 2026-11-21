import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createContent,
  type ContentCreateStore,
  type ContentRecord,
  type ContentRevision,
} from './content-runtime.js'
import { createPostgresContentCreateStore, type ContentCreatePostgresDatabase } from './content-create-store-postgres.js'

const connectionString = process.env.W03_POSTGRES_TEST_URL
const postgresSuite = connectionString ? describe : describe.skip

postgresSuite('W03 PostgreSQL 18 content-create runtime integration', () => {
  let pool: Pool
  let store: ContentCreateStore

  beforeAll(async () => {
    if (!connectionString) throw new Error('W03_POSTGRES_TEST_URL is required')
    pool = new Pool({
      connectionString,
      max: 4,
      connectionTimeoutMillis: 5_000,
    })

    for (const filename of [
      '0001_w03_d1_02_content_schema.sql',
      '0002_w03_d1_02_content_snowflake_timestamp_bigint.sql',
    ]) {
      const migration = await readFile(
        new URL('./neon-postgres-migrations/' + filename, import.meta.url),
        'utf8',
      )
      await pool.query(migration)
    }

    store = createPostgresContentCreateStore(pool as unknown as ContentCreatePostgresDatabase)
  })

  afterAll(async () => {
    await pool?.end()
  })

  async function createFixture() {
    const ownerUserId = 'user_pg18_' + crypto.randomUUID().replaceAll('-', '')
    const idempotencyKey = 'create_pg18_' + crypto.randomUUID()
    const bodyRef = 'body:pg18:' + crypto.randomUUID()
    const now = new Date()
    const created = await createContent(
      ownerUserId,
      {
        contentType: 'post',
        title: 'PostgreSQL 18 integration post',
        bodyRef,
        mediaRefs: [],
        coverRef: null,
      },
      idempotencyKey,
      now,
      'w03-pg18-integration',
      undefined,
      store,
    )

    return { ownerUserId, idempotencyKey, bodyRef, now, created }
  }

  it('allocates a bigint Snowflake ID and commits content, revision, idempotency and trigger outbox on PostgreSQL', async () => {
    const fixture = await createFixture()
    const { created, ownerUserId, idempotencyKey, bodyRef } = fixture

    expect(created.id).toMatch(/^[0-9]{16,20}$/)
    expect(created.state).toBe('DRAFT')
    expect(created.ownerUserId).toBe(ownerUserId)

    const allocator = await pool.query<{
      last_timestamp_ms: string
      sequence: number
    }>(
      'SELECT last_timestamp_ms::text, sequence FROM content_id_snowflake_state WHERE id = 1',
    )
    expect(allocator.rows).toHaveLength(1)
    expect(Number(allocator.rows[0]?.last_timestamp_ms)).toBeGreaterThan(1_700_000_000_000)

    const persisted = await pool.query<{
      id: string
      owner_user_id: string
      body_ref: string
      state: string
      version: number
    }>(
      'SELECT id, owner_user_id, body_ref, state, version FROM contents WHERE id = $1',
      [created.id],
    )
    expect(persisted.rows).toEqual([{
      id: created.id,
      owner_user_id: ownerUserId,
      body_ref: bodyRef,
      state: 'DRAFT',
      version: 1,
    }])

    const revisions = await pool.query<{
      content_id: string
      revision: number
      operation: string
      actor_user_id: string
    }>(
      'SELECT content_id, revision, operation, actor_user_id FROM content_revisions WHERE content_id = $1',
      [created.id],
    )
    expect(revisions.rows).toEqual([{
      content_id: created.id,
      revision: 1,
      operation: 'CREATE',
      actor_user_id: ownerUserId,
    }])

    const outbox = await pool.query<{
      operation_id: string
      event_type: string
      content_id: string
      aggregate_version: number
      payload_json: string
    }>(
      'SELECT operation_id, event_type, content_id, aggregate_version, payload_json FROM content_outbox_events WHERE content_id = $1',
      [created.id],
    )
    expect(outbox.rows).toHaveLength(1)
    expect(outbox.rows[0]).toMatchObject({
      operation_id: 'createContent',
      event_type: 'content.created',
      content_id: created.id,
      aggregate_version: 1,
    })
    expect(JSON.parse(outbox.rows[0]!.payload_json)).toMatchObject({
      id: created.id,
      state: 'DRAFT',
      version: 1,
    })

    const idempotency = await pool.query<{
      owner_user_id: string
      operation_id: string
      idempotency_key: string
      status: string
    }>(
      'SELECT owner_user_id, operation_id, idempotency_key, status FROM content_mutation_idempotency WHERE owner_user_id = $1 AND operation_id = $2 AND idempotency_key = $3',
      [ownerUserId, 'createContent', idempotencyKey],
    )
    expect(idempotency.rows).toEqual([{
      owner_user_id: ownerUserId,
      operation_id: 'createContent',
      idempotency_key: idempotencyKey,
      status: 'COMPLETED',
    }])

    const replay = await createContent(
      ownerUserId,
      {
        contentType: 'post',
        title: 'PostgreSQL 18 integration post',
        bodyRef,
        mediaRefs: [],
        coverRef: null,
      },
      idempotencyKey,
      new Date(),
      'w03-pg18-integration-replay',
      undefined,
      store,
    )
    expect(replay.id).toBe(created.id)

    const counts = await pool.query<{
      contents: string
      revisions: string
      outbox: string
    }>(
      'SELECT (SELECT count(*)::text FROM contents WHERE id = $1) AS contents, ' +
      '(SELECT count(*)::text FROM content_revisions WHERE content_id = $1) AS revisions, ' +
      '(SELECT count(*)::text FROM content_outbox_events WHERE content_id = $1) AS outbox',
      [created.id],
    )
    expect(counts.rows[0]).toEqual({
      contents: '1',
      revisions: '1',
      outbox: '1',
    })
  })

  it('rolls back the idempotency reservation when the following content insert fails', async () => {
    const fixture = await createFixture()
    const { created, ownerUserId } = fixture
    const rollbackKey = 'rollback_pg18_' + crypto.randomUUID()
    const nowIso = created.createdAt
    const revision: ContentRevision = {
      id: 'revision_pg18_' + crypto.randomUUID().replaceAll('-', ''),
      contentId: created.id,
      revision: 1,
      contentVersion: 1,
      actorUserId: ownerUserId,
      sourceRevision: null,
      operation: 'CREATE',
      state: 'DRAFT',
      accessMode: created.accessMode,
      slug: created.slug,
      title: created.title,
      bodyRef: created.bodyRef,
      mediaRefs: created.mediaRefs,
      coverRef: created.coverRef,
      mediaWarning: created.mediaWarning,
      etag: created.etag,
      reason: null,
      correlationId: 'w03-pg18-rollback',
      createdAt: nowIso,
    }

    await expect(store.create({
      ownerUserId,
      operationId: 'createContent',
      idempotencyKey: rollbackKey,
      requestHash: 'a'.repeat(64),
      responseJson: JSON.stringify(created),
      createdAt: nowIso,
      expiresAt: new Date(new Date(nowIso).getTime() + 86_400_000).toISOString(),
      content: created as ContentRecord,
      revision,
    })).rejects.toMatchObject({ status: 503 })

    const rolledBack = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM content_mutation_idempotency WHERE owner_user_id = $1 AND operation_id = $2 AND idempotency_key = $3',
      [ownerUserId, 'createContent', rollbackKey],
    )
    expect(rolledBack.rows[0]?.count).toBe('0')

    const existingContent = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM contents WHERE id = $1',
      [created.id],
    )
    expect(existingContent.rows[0]?.count).toBe('1')
  })
})
