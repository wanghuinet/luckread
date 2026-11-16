import { describe, expect, it } from 'vitest'

import { ContentRuntimeError } from './content-runtime.js'
import {
  appendPostThreadNext,
  createContentRelationship,
  revokeContentRelationship,
  type ContentRelationship,
  type ContentRelationshipMutationStore,
} from './content-relationships.js'
import {
  createPostgresContentRelationshipMutationStore,
  type ContentRelationshipPostgresDatabase,
} from './content-relationship-mutation-store-postgres.js'

const now = new Date('2026-11-16T12:00:00.000Z')
const nowIso = now.toISOString()
const relationship: ContentRelationship = {
  relationshipId: 'relationship_123',
  sourceType: 'content',
  sourceId: 'content_source',
  targetType: 'content',
  targetId: 'content_target',
  relationType: 'reference',
  schemaVersion: 1,
  status: 'ACTIVE',
  actorId: 'user_123',
  provenanceRef: 'source citation',
  authorizationRef: 'authorization evidence',
  createdAt: nowIso,
  updatedAt: nowIso,
}

const createRow = {
  source_id: 'content_source',
  owner_user_id: 'user_123',
  source_version: 7,
  target_id: 'content_target',
  idem_id: null,
  idem_owner_user_id: null,
  idem_request_hash: null,
  idem_status: null,
  idem_response_json: null,
  idem_expires_at: null,
  active_relationship_id: null,
}

const appendRow = {
  source_id: 'content_source',
  source_owner_user_id: 'user_123',
  source_content_type: 'post',
  source_state: 'DRAFT',
  source_access_mode: 'PUBLIC',
  target_id: 'content_target',
  target_owner_user_id: 'user_123',
  target_content_type: 'post',
  target_state: 'PUBLISHED',
  target_access_mode: 'PUBLIC',
  idem_id: null,
  idem_owner_user_id: null,
  idem_request_hash: null,
  idem_status: null,
  idem_response_json: null,
  idem_expires_at: null,
}

const appendStats = {
  previous_count: 1,
  next_count: 1,
  would_cycle: 0,
  source_has_next: 0,
  target_has_previous: 0,
}

const revokeRow = {
  relationship_id: relationship.relationshipId,
  source_type: 'content' as const,
  source_id: relationship.sourceId,
  target_type: 'content' as const,
  target_id: relationship.targetId,
  relation_type: 'reference' as const,
  schema_version: 1,
  status: 'ACTIVE' as const,
  actor_id: 'user_123',
  provenance_ref: relationship.provenanceRef,
  authorization_ref: relationship.authorizationRef,
  created_at: new Date(nowIso),
  updated_at: new Date(nowIso),
  owner_user_id: 'user_123',
  idem_id: null,
  idem_owner_user_id: null,
  idem_request_hash: null,
  idem_status: null,
  idem_response_json: null,
  idem_expires_at: null,
}

function fixture(options: { revokeMiss?: boolean; uniqueConflict?: boolean; appendInsertMiss?: boolean } = {}) {
  const directQueries: Array<{ sql: string; values?: unknown[] }> = []
  const transactionQueries: Array<{ sql: string; values?: unknown[] }> = []
  let released = false

  const client = {
    async query<Row>(sql: string, values?: unknown[]) {
      transactionQueries.push({ sql, values })
      if (options.uniqueConflict && sql.includes('INSERT INTO content_relationships')) {
        throw Object.assign(new Error('duplicate active relationship'), {
          code: '23505',
          constraint: 'content_relationships_thread_next_unique_idx',
        })
      }
      if (options.appendInsertMiss && sql.includes('INSERT INTO content_relationships') && sql.includes('WITH RECURSIVE')) {
        return { rows: [] as Row[] }
      }
      if (options.revokeMiss && sql.startsWith('UPDATE content_relationships')) {
        return { rows: [] as Row[] }
      }
      if (sql.includes('INSERT INTO content_relationships')) {
        return { rows: [{ relationship_id: relationship.relationshipId }] as Row[] }
      }
      if (sql.startsWith('UPDATE content_relationships')) {
        return { rows: [{ relationship_id: relationship.relationshipId }] as Row[] }
      }
      return { rows: [] as Row[] }
    },
    release() { released = true },
  }

  const database: ContentRelationshipPostgresDatabase = {
    async query<Row>(sql: string, values?: unknown[]) {
      directQueries.push({ sql, values })
      if (sql.includes('source_content_type')) {
        return { rows: [appendRow] as Row[] }
      }
      if (sql.includes('WITH RECURSIVE previous(id')) {
        return { rows: [appendStats] as Row[] }
      }
      if (sql.includes('FROM contents s LEFT JOIN contents t')) {
        return { rows: [createRow] as Row[] }
      }
      if (sql.includes('FROM content_relationships r JOIN contents c')) {
        return { rows: [revokeRow] as Row[] }
      }
      return { rows: [] as Row[] }
    },
    async connect() { return client },
  }

  return { database, directQueries, transactionQueries, released: () => released }
}

describe('W03 Neon content relationship mutation store', () => {
  it('lists published reference relationships with stable bounded cursor pagination', async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = []
    const rows = [
      [
        { relationship_id: 'relationship_2', relation_type: 'reference' as const, created_at: new Date('2026-11-16T12:00:00.000Z'), related_id: 'content_2', related_slug: 'two', related_type: 'post' as const, related_title: 'Two', relation_direction: 'out' as const },
        { relationship_id: 'relationship_1', relation_type: 'reference' as const, created_at: new Date('2026-11-16T11:00:00.000Z'), related_id: 'content_1', related_slug: 'one', related_type: 'article' as const, related_title: 'One', relation_direction: 'in' as const },
      ],
      [
        { relationship_id: 'relationship_1', relation_type: 'reference' as const, created_at: new Date('2026-11-16T11:00:00.000Z'), related_id: 'content_1', related_slug: 'one', related_type: 'article' as const, related_title: 'One', relation_direction: 'in' as const },
      ],
    ]
    let callIndex = 0
    const database: ContentRelationshipPostgresDatabase = {
      async query<Row>(sql: string, values?: unknown[]) {
        calls.push({ sql, values })
        return { rows: (rows[callIndex++] ?? []) as Row[] }
      },
      async connect() { throw new Error('list reads must not open a transaction') },
    }
    const store = createPostgresContentRelationshipMutationStore(database)
    const first = await store.list!({ contentId: 'content_source', direction: 'both', cursor: null, limit: 1 })
    expect(first.items).toEqual([{
      relationshipId: 'relationship_2', relationType: 'reference', direction: 'out',
      relatedContent: { id: 'content_2', slug: 'two', contentType: 'post', title: 'Two' },
      createdAt: '2026-11-16T12:00:00.000Z',
    }])
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toBeTruthy()
    expect(calls[0]?.sql).toContain("r.relation_type = 'reference'")
    expect(calls[0]?.sql).toContain("s.state = 'PUBLISHED'")
    expect(calls[0]?.sql).toContain("t.state = 'PUBLISHED'")
    expect(calls[0]?.sql).toContain('ORDER BY r.created_at DESC, r.relationship_id DESC')
    expect(calls[0]?.values).toEqual(['content_source', 2])

    const second = await store.list!({ contentId: 'content_source', direction: 'both', cursor: first.nextCursor, limit: 1 })
    expect(second.items[0]?.relationshipId).toBe('relationship_1')
    expect(second.hasMore).toBe(false)
    expect(second.nextCursor).toBeNull()
    expect(calls[1]?.sql).toContain('r.created_at < $2::timestamptz')
    expect(calls[1]?.values).toEqual(['content_source', '2026-11-16T12:00:00.000Z', 'relationship_2', 2])
  })

  it('loads source/target ownership, active reference and idempotency from PostgreSQL', async () => {
    const fake = fixture()
    const store = createPostgresContentRelationshipMutationStore(fake.database)

    await expect(store.loadCreate({
      targetContentId: 'content_target',
      ownerUserId: 'user_123',
      operationId: 'createContentRelationship',
      idempotencyKey: 'create-reference-key',
      sourceContentId: 'content_source',
    })).resolves.toEqual(createRow)

    expect(fake.directQueries[0]?.sql).toContain('LEFT JOIN LATERAL')
    expect(fake.directQueries[0]?.sql).toContain('active_relationship_id')
    expect(fake.directQueries[0]?.values).toEqual([
      'content_target', 'user_123', 'createContentRelationship', 'create-reference-key', 'content_source',
    ])
  })

  it('loads and maps a revoke snapshot from PostgreSQL with owner and source scope', async () => {
    const fake = fixture()
    const store = createPostgresContentRelationshipMutationStore(fake.database)

    await expect(store.loadRevoke({
      ownerUserId: 'user_123',
      operationId: 'revokeContentRelationship',
      idempotencyKey: 'revoke-reference-key',
      relationshipId: relationship.relationshipId,
      sourceContentId: relationship.sourceId,
    })).resolves.toMatchObject({
      relationship_id: relationship.relationshipId,
      source_id: relationship.sourceId,
      target_id: relationship.targetId,
      owner_user_id: 'user_123',
      created_at: nowIso,
      updated_at: nowIso,
    })

    expect(fake.directQueries[0]?.sql).toContain('LEFT JOIN LATERAL')
    expect(fake.directQueries[0]?.sql).toContain('WHERE r.relationship_id = $4 AND r.source_id = $5')
    expect(fake.directQueries[0]?.values).toEqual([
      'user_123', 'revokeContentRelationship', 'revoke-reference-key',
      relationship.relationshipId, relationship.sourceId,
    ])
  })

  it('commits completed idempotency and reference insertion in one transaction with trigger-backed outbox', async () => {
    const fake = fixture()
    const store = createPostgresContentRelationshipMutationStore(fake.database)

    await store.create({
      ownerUserId: 'user_123',
      operationId: 'createContentRelationship',
      idempotencyKey: 'create-reference-key',
      requestHash: 'create-hash',
      responseJson: JSON.stringify(relationship),
      createdAt: nowIso,
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      relationship,
    })

    const sql = fake.transactionQueries.map(item => item.sql)
    expect(sql[0]).toBe('BEGIN')
    expect(sql[1]).toContain('DELETE FROM content_mutation_idempotency')
    expect(sql[2]).toContain('INSERT INTO content_mutation_idempotency')
    expect(sql[3]).toContain("VALUES ($1, 'content', $2, 'content', $3, 'reference', 1, 'ACTIVE'")
    expect(sql[3]).toContain('RETURNING relationship_id')
    expect(sql[4]).toBe('COMMIT')
    expect(fake.transactionQueries[2]?.values?.[5]).toBe(201)
    expect(fake.transactionQueries[3]?.values).toEqual([
      relationship.relationshipId,
      relationship.sourceId,
      relationship.targetId,
      relationship.actorId,
      relationship.provenanceRef,
      relationship.authorizationRef,
      nowIso,
      nowIso,
    ])
    expect(fake.released()).toBe(true)
  })

  it('commits reference revocation and idempotency in one transaction with trigger-backed outbox', async () => {
    const fake = fixture()
    const store = createPostgresContentRelationshipMutationStore(fake.database)

    await store.revoke({
      ownerUserId: 'user_123',
      operationId: 'revokeContentRelationship',
      idempotencyKey: 'revoke-reference-key',
      requestHash: 'revoke-hash',
      responseJson: JSON.stringify({ ...relationship, status: 'REVOKED' }),
      updatedAt: nowIso,
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      relationshipId: relationship.relationshipId,
      sourceContentId: relationship.sourceId,
    })

    const sql = fake.transactionQueries.map(item => item.sql)
    expect(sql[0]).toBe('BEGIN')
    expect(sql[1]).toContain('DELETE FROM content_mutation_idempotency')
    expect(sql[2]).toContain('INSERT INTO content_mutation_idempotency')
    expect(sql[3]).toContain("SET status = 'REVOKED'")
    expect(sql[3]).toContain('relationship_id = $2 AND source_id = $3 AND status = \'ACTIVE\'')
    expect(sql[4]).toBe('COMMIT')
    expect(fake.transactionQueries[2]?.values?.[5]).toBe(200)
    expect(fake.transactionQueries[3]?.values).toEqual([
      nowIso, relationship.relationshipId, relationship.sourceId,
    ])
    expect(fake.released()).toBe(true)
  })

  it('routes reference create and revoke through Neon without issuing D1 statements', async () => {
    const createSnapshot = {
      ...createRow,
      source_id: 'content_source',
      owner_user_id: 'user_123',
      target_id: 'content_target',
      active_relationship_id: null,
    }
    const revokeSnapshot = {
      relationship_id: relationship.relationshipId,
      source_type: 'content' as const,
      source_id: relationship.sourceId,
      target_type: 'content' as const,
      target_id: relationship.targetId,
      relation_type: 'reference' as const,
      schema_version: 1,
      status: 'ACTIVE' as const,
      actor_id: 'user_123',
      provenance_ref: relationship.provenanceRef,
      authorization_ref: relationship.authorizationRef,
      created_at: nowIso,
      updated_at: nowIso,
      owner_user_id: 'user_123',
      idem_id: null,
      idem_owner_user_id: null,
      idem_request_hash: null,
      idem_status: null,
      idem_response_json: null,
      idem_expires_at: null,
    }
    let createInput: Parameters<ContentRelationshipMutationStore['create']>[0] | undefined
    let revokeInput: Parameters<ContentRelationshipMutationStore['revoke']>[0] | undefined
    const store: ContentRelationshipMutationStore = {
      async loadCreate(input) {
        expect(input.sourceContentId).toBe('content_source')
        return createSnapshot
      },
      async create(input) { createInput = input },
      async loadRevoke(input) {
        return {
          ...revokeSnapshot,
          relationship_id: input.relationshipId,
        }
      },
      async revoke(input) { revokeInput = input },
      async loadAppend() { return appendRow },
      async loadAppendStats() { return appendStats },
      async appendThread() {},
    }
    const d1 = {
      prepare() { throw new Error('D1 must not be queried in Neon mode') },
      batch() { throw new Error('D1 must not be written in Neon mode') },
    }

    const created = await createContentRelationship(
      d1 as never,
      'user_123',
      'content_source',
      {
        targetContentId: 'content_target',
        relationType: 'reference',
        provenanceRef: 'source citation',
        authorizationRef: 'authorization evidence',
      },
      'neon-create-reference-key',
      now,
      store,
    )
    const revoked = await revokeContentRelationship(
      d1 as never,
      'user_123',
      'content_source',
      created.relationshipId,
      'neon-revoke-reference-key',
      now,
      store,
    )

    expect(created).toMatchObject({
      sourceId: 'content_source',
      targetId: 'content_target',
      relationType: 'reference',
      status: 'ACTIVE',
    })
    expect(createInput?.relationship).toEqual(created)
    expect(createInput?.responseJson).toBe(JSON.stringify(created))
    expect(revoked).toMatchObject({ relationshipId: created.relationshipId, status: 'REVOKED' })
    expect(revokeInput?.sourceContentId).toBe('content_source')
    expect(revokeInput?.responseJson).toBe(JSON.stringify(revoked))
  })

  it('loads the thread append content and idempotency snapshot from PostgreSQL', async () => {
    const fake = fixture()
    const store = createPostgresContentRelationshipMutationStore(fake.database)

    await expect(store.loadAppend({
      targetContentId: 'content_target',
      ownerUserId: 'user_123',
      operationId: 'appendPostThreadNext',
      idempotencyKey: 'thread-append-key',
      sourceContentId: 'content_source',
    })).resolves.toEqual(appendRow)

    expect(fake.directQueries[0]?.sql).toContain('LEFT JOIN LATERAL')
    expect(fake.directQueries[0]?.sql).toContain('source_content_type')
    expect(fake.directQueries[0]?.values).toEqual([
      'content_target', 'user_123', 'appendPostThreadNext', 'thread-append-key', 'content_source',
    ])
  })

  it('loads previous/next thread graph statistics with a PostgreSQL recursive CTE', async () => {
    const fake = fixture()
    const store = createPostgresContentRelationshipMutationStore(fake.database)

    await expect(store.loadAppendStats({
      sourceContentId: 'content_source',
      targetContentId: 'content_target',
      maxItems: 50,
    })).resolves.toEqual(appendStats)

    expect(fake.directQueries[0]?.sql).toContain('WITH RECURSIVE previous')
    expect(fake.directQueries[0]?.sql).toContain('next_chain')
    expect(fake.directQueries[0]?.sql).toContain("relation_type = 'thread-next'")
    expect(fake.directQueries[0]?.values).toEqual([
      'content_source', 'content_target', 50,
    ])
  })

  it('serializes graph appends and commits idempotency plus final no-fork/no-merge/no-cycle insertion atomically', async () => {
    const fake = fixture()
    const store = createPostgresContentRelationshipMutationStore(fake.database)
    const threadRelationship: ContentRelationship = {
      ...relationship,
      relationshipId: 'thread_relationship_123',
      sourceId: 'content_source',
      targetId: 'content_target',
      relationType: 'thread-next',
      provenanceRef: null,
      authorizationRef: null,
    }

    await store.appendThread({
      ownerUserId: 'user_123',
      operationId: 'appendPostThreadNext',
      idempotencyKey: 'thread-append-key',
      requestHash: 'thread-hash',
      responseJson: JSON.stringify(threadRelationship),
      createdAt: nowIso,
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      maxItems: 50,
      relationship: threadRelationship,
    })

    const sql = fake.transactionQueries.map(item => item.sql)
    expect(sql[0]).toBe('BEGIN')
    expect(sql[1]).toContain('pg_advisory_xact_lock(74031, hashtext($1))')
    expect(fake.transactionQueries[1]?.values).toEqual(['user_123'])
    expect(sql[2]).toContain('ORDER BY id FOR UPDATE')
    expect(sql[3]).toContain('DELETE FROM content_mutation_idempotency')
    expect(sql[4]).toContain('INSERT INTO content_mutation_idempotency')
    expect(sql[5]).toContain('WITH RECURSIVE descendants')
    expect(sql[5]).toContain('ancestors')
    expect(sql[5]).toContain('NOT EXISTS (SELECT 1 FROM descendants WHERE id = s.id)')
    expect(sql[5]).toContain('s.id <> t.id')
    expect(sql[5]).toContain("relation_type = 'thread-next'")
    expect(sql[5]).toContain('RETURNING relationship_id')
    expect(sql[6]).toBe('COMMIT')
    expect(fake.transactionQueries[2]?.values).toEqual([['content_source', 'content_target']])
    expect(fake.transactionQueries[4]?.values?.[5]).toBe(201)
    expect(fake.transactionQueries[5]?.values).toEqual([
      'content_target', 'content_source', 50, 'thread_relationship_123',
      'user_123', nowIso, 'content_target', 50,
    ])
    expect(fake.released()).toBe(true)
  })

  it('rolls back a thread append when the final PostgreSQL graph recheck no longer permits the edge', async () => {
    const fake = fixture({ appendInsertMiss: true })
    const store = createPostgresContentRelationshipMutationStore(fake.database)
    const threadRelationship: ContentRelationship = {
      ...relationship,
      relationshipId: 'thread_relationship_rollback',
      relationType: 'thread-next',
      provenanceRef: null,
      authorizationRef: null,
    }

    await expect(store.appendThread({
      ownerUserId: 'user_123',
      operationId: 'appendPostThreadNext',
      idempotencyKey: 'stale-thread-append-key',
      requestHash: 'thread-hash',
      responseJson: JSON.stringify(threadRelationship),
      createdAt: nowIso,
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      maxItems: 50,
      relationship: threadRelationship,
    })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })

    expect(fake.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(fake.released()).toBe(true)
  })

  it('routes native post-thread append through Neon without issuing D1 statements', async () => {
    let appendInput: Parameters<ContentRelationshipMutationStore['appendThread']>[0] | undefined
    const store: ContentRelationshipMutationStore = {
      async loadCreate() { return createRow },
      async create() {},
      async loadRevoke() {
        return { ...revokeRow, created_at: nowIso, updated_at: nowIso }
      },
      async revoke() {},
      async loadAppend() { return appendRow },
      async loadAppendStats() { return appendStats },
      async appendThread(input) { appendInput = input },
    }
    const d1 = {
      prepare() { throw new Error('D1 must not be queried in Neon mode') },
      batch() { throw new Error('D1 must not be written in Neon mode') },
    }

    const created = await appendPostThreadNext(
      d1 as never,
      'user_123',
      'content_source',
      'content_target',
      'neon-thread-append-key',
      now,
      store,
    )

    expect(created).toMatchObject({
      sourceId: 'content_source',
      targetId: 'content_target',
      relationType: 'thread-next',
      status: 'ACTIVE',
      actorId: 'user_123',
    })
    expect(appendInput).toMatchObject({
      ownerUserId: 'user_123',
      operationId: 'appendPostThreadNext',
      idempotencyKey: 'neon-thread-append-key',
      maxItems: 50,
      relationship: created,
      responseJson: JSON.stringify(created),
    })
  })

  it('maps concurrent active-reference uniqueness conflicts to the existing 409 contract', async () => {
    const fake = fixture({ uniqueConflict: true })
    const store = createPostgresContentRelationshipMutationStore(fake.database)

    await expect(store.create({
      ownerUserId: 'user_123',
      operationId: 'createContentRelationship',
      idempotencyKey: 'duplicate-reference-key',
      requestHash: 'create-hash',
      responseJson: JSON.stringify(relationship),
      createdAt: nowIso,
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      relationship,
    })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })

    expect(fake.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(fake.released()).toBe(true)
  })

  it('fails closed and rolls back when the revoke row is no longer active', async () => {
    const fake = fixture({ revokeMiss: true })
    const store = createPostgresContentRelationshipMutationStore(fake.database)

    await expect(store.revoke({
      ownerUserId: 'user_123',
      operationId: 'revokeContentRelationship',
      idempotencyKey: 'stale-revoke-key',
      requestHash: 'revoke-hash',
      responseJson: JSON.stringify({ ...relationship, status: 'REVOKED' }),
      updatedAt: nowIso,
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      relationshipId: relationship.relationshipId,
      sourceContentId: relationship.sourceId,
    })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })

    expect(fake.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(fake.released()).toBe(true)
  })
})
