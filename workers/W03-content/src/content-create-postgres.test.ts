import { createContent, ContentRuntimeError, type ContentCreateStore } from './content-runtime.js'
import { describe, expect, it } from 'vitest'

import {
  CONTENT_SNOWFLAKE_EPOCH_MS,
  encodeContentSnowflakeId,
} from './content-snowflake-id.js'
import {
  createPostgresContentCreateStore,
  type ContentCreatePostgresDatabase,
} from './content-create-store-postgres.js'

const nowMs = Date.UTC(2026, 10, 16, 12, 0, 0)
const nowIso = new Date(nowMs).toISOString()

function fixture(options: { idempotencyConflict?: boolean; failContentInsert?: boolean } = {}) {
  const directQueries: Array<{ sql: string; values?: unknown[] }> = []
  const transactionQueries: Array<{ sql: string; values?: unknown[] }> = []
  const state = { last_timestamp_ms: -1, sequence: 4095 }
  let released = false
  let rollbackCount = 0

  const client = {
    async query<Row>(sql: string, values?: unknown[]) {
      transactionQueries.push({ sql, values })
      if (options.idempotencyConflict && sql.startsWith('INSERT INTO content_mutation_idempotency')) {
        throw Object.assign(new Error('duplicate idempotency key'), {
          code: '23505',
          constraint: 'content_mutation_idempotency_owner_user_id_operation_id_idempotency_key_key',
        })
      }
      if (options.failContentInsert && sql.startsWith('INSERT INTO contents')) {
        throw new Error('simulated content insert failure')
      }
      if (sql === 'ROLLBACK') rollbackCount += 1
      return { rows: [] as Row[] }
    },
    release() { released = true },
  }

  const database: ContentCreatePostgresDatabase = {
    async query<Row>(sql: string, values?: unknown[]) {
      directQueries.push({ sql, values })
      if (sql.startsWith('SELECT id AS idem_id')) return { rows: [] as Row[] }
      if (sql.startsWith('UPDATE content_id_snowflake_state')) {
        const requestedMs = Number(values?.[0])
        if (requestedMs > state.last_timestamp_ms) {
          state.last_timestamp_ms = requestedMs
          state.sequence = 0
        } else if (state.sequence < 4095) {
          state.sequence += 1
        } else {
          return { rows: [] as Row[] }
        }
        return { rows: [{ last_timestamp_ms: String(state.last_timestamp_ms), sequence: state.sequence }] as Row[] }
      }
      return { rows: [] as Row[] }
    },
    async connect() { return client },
  }

  return {
    database,
    directQueries,
    transactionQueries,
    released: () => released,
    rollbackCount: () => rollbackCount,
  }
}

const content = {
  id: encodeContentSnowflakeId(nowMs, 0),
  contentType: 'post' as const,
  ownerUserId: 'user_123',
  creatorId: 'user_123',
  ipId: null,
  state: 'DRAFT' as const,
  scheduledAt: null,
  accessMode: 'PUBLIC' as const,
  accessGranted: true,
  version: 1,
  revision: 1,
  slug: 'post-123',
  title: 'A new post',
  bodyRef: 'body:post',
  mediaRefs: [],
  coverRef: null,
  mediaWarning: null,
  etag: 'W/"1"',
  createdAt: nowIso,
  updatedAt: nowIso,
}
const revision = {
  id: 'revision_1',
  contentId: content.id,
  revision: 1,
  contentVersion: 1,
  actorUserId: 'user_123',
  sourceRevision: null,
  operation: 'CREATE' as const,
  state: 'DRAFT' as const,
  accessMode: 'PUBLIC' as const,
  slug: content.slug,
  title: content.title,
  bodyRef: content.bodyRef,
  mediaRefs: [],
  coverRef: null,
  mediaWarning: null,
  etag: 'W/"1"',
  reason: null,
  correlationId: 'test-correlation',
  createdAt: nowIso,
}

describe('W03 Neon content creation store', () => {

  it('routes the public createContent operation through the Neon store without touching D1', async () => {
    let created: Parameters<ContentCreateStore['create']>[0] | undefined
    const store: ContentCreateStore = {
      async loadIdempotency() { return null },
      async allocateContentId() { return encodeContentSnowflakeId(nowMs, 1) },
      async create(input) { created = input },
    }
    const d1 = {
      prepare() { throw new Error('D1 must not be queried in Neon mode') },
      batch() { throw new Error('D1 must not be written in Neon mode') },
    }

    const result = await createContent(
      d1 as never,
      'user_123',
      { contentType: 'post', title: 'Neon post', bodyRef: 'body:neon-post', mediaRefs: [], coverRef: null },
      'neon-create-key',
      new Date(nowMs),
      'neon-create-test',
      undefined,
      store,
    )

    expect(result.id).toBe(encodeContentSnowflakeId(nowMs, 1))
    expect(created?.content.id).toBe(result.id)
    expect(created?.revision.contentId).toBe(result.id)
    expect(created?.operationId).toBe('createContent')
    expect(created?.requestHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('loads idempotency state from PostgreSQL and maps database timestamps', async () => {
    const fake = fixture()
    const store = createPostgresContentCreateStore(fake.database)
    const row = {
      idem_id: 'idem_1',
      idem_owner_user_id: 'user_123',
      idem_request_hash: 'hash_1',
      idem_status: 'COMPLETED' as const,
      idem_response_status: 201,
      idem_response_json: JSON.stringify(content),
      idem_expires_at: new Date(nowMs + 60_000),
    }
    const database = {
      ...fake.database,
      async query<Row>(sql: string, values?: unknown[]) {
        if (sql.startsWith('SELECT id AS idem_id')) return { rows: [row] as Row[] }
        return fake.database.query<Row>(sql, values)
      },
    }
    const result = await createPostgresContentCreateStore(database).loadIdempotency(
      'user_123', 'createContent', 'create-key',
    )
    expect(result).toMatchObject({
      idem_id: 'idem_1',
      idem_owner_user_id: 'user_123',
      idem_status: 'COMPLETED',
      idem_expires_at: new Date(row.idem_expires_at).toISOString(),
    })
    expect(fake.directQueries).toHaveLength(0)
    expect(store).toBeDefined()
  })

  it('allocates a Snowflake ID using the PostgreSQL bigint state row', async () => {
    const fake = fixture()
    const store = createPostgresContentCreateStore(fake.database)
    await expect(store.allocateContentId(nowMs)).resolves.toBe(encodeContentSnowflakeId(nowMs, 0))
    expect(fake.directQueries[0]?.sql).toContain('UPDATE content_id_snowflake_state')
    expect(fake.directQueries[0]?.sql).toContain('$1::bigint')
    expect(fake.directQueries[0]?.sql).toContain('RETURNING last_timestamp_ms, sequence')
    expect(fake.directQueries[0]?.values).toEqual([nowMs])
    expect(CONTENT_SNOWFLAKE_EPOCH_MS).toBeLessThan(nowMs)
  })

  it('commits idempotency, content, revision and trigger-backed outbox atomically', async () => {
    const fake = fixture()
    const store = createPostgresContentCreateStore(fake.database)

    await store.create({
      ownerUserId: content.ownerUserId,
      operationId: 'createContent',
      idempotencyKey: 'create-key',
      requestHash: 'request-hash',
      responseJson: JSON.stringify(content),
      createdAt: nowIso,
      expiresAt: new Date(nowMs + 86_400_000).toISOString(),
      content,
      revision,
    })

    const sql = fake.transactionQueries.map(item => item.sql)
    expect(sql).toEqual([
      'BEGIN',
      expect.stringContaining('DELETE FROM content_mutation_idempotency'),
      expect.stringContaining('INSERT INTO content_mutation_idempotency'),
      expect.stringContaining('INSERT INTO contents'),
      expect.stringContaining('INSERT INTO content_revisions'),
      'COMMIT',
    ])
    expect(fake.transactionQueries[3]?.values?.[0]).toBe(content.id)
    expect(fake.transactionQueries[4]?.values?.[1]).toBe(content.id)
    expect(fake.released()).toBe(true)
    expect(fake.rollbackCount()).toBe(0)
  })

  it('rolls back a duplicate idempotency key and maps it to the existing conflict contract', async () => {
    const fake = fixture({ idempotencyConflict: true })
    const store = createPostgresContentCreateStore(fake.database)

    await expect(store.create({
      ownerUserId: content.ownerUserId,
      operationId: 'createContent',
      idempotencyKey: 'create-key',
      requestHash: 'request-hash',
      responseJson: JSON.stringify(content),
      createdAt: nowIso,
      expiresAt: new Date(nowMs + 86_400_000).toISOString(),
      content,
      revision,
    })).rejects.toMatchObject(new ContentRuntimeError('IDEMPOTENCY_IN_PROGRESS', 409))

    expect(fake.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(fake.released()).toBe(true)
  })

  it('rolls back when content persistence fails before commit', async () => {
    const fake = fixture({ failContentInsert: true })
    const store = createPostgresContentCreateStore(fake.database)

    await expect(store.create({
      ownerUserId: content.ownerUserId,
      operationId: 'createContent',
      idempotencyKey: 'create-key',
      requestHash: 'request-hash',
      responseJson: JSON.stringify(content),
      createdAt: nowIso,
      expiresAt: new Date(nowMs + 86_400_000).toISOString(),
      content,
      revision,
    })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })

    expect(fake.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(fake.released()).toBe(true)
  })
})
