import { describe, expect, it } from 'vitest'

import {
  ContentRuntimeError,
  deleteContent,
  updateContent,
  transitionContentState,
  listDueScheduledContentCandidates,
  publishAuthorizedScheduledContents,
  type ContentMutationStore,
  type ContentRecord,
  type ContentMutationSnapshot,
} from './content-runtime.js'
import {
  createPostgresContentMutationStore,
  type ContentMutationPostgresDatabase,
} from './content-mutation-store-postgres.js'

const now = new Date('2026-11-16T12:00:00.000Z')
const nowIso = now.toISOString()
const snapshotContent: ContentRecord = {
  id: '123456789012345678',
  contentType: 'post',
  ownerUserId: 'user_123',
  creatorId: 'user_123',
  ipId: null,
  state: 'DRAFT',
  scheduledAt: null,
  accessMode: 'PUBLIC',
  version: 4,
  revision: 3,
  slug: 'existing-post',
  title: 'Existing post',
  bodyRef: 'body:existing',
  mediaRefs: [],
  coverRef: null,
  mediaWarning: null,
  etag: 'W/"4"',
  createdAt: '2026-11-15T10:00:00.000Z',
  updatedAt: '2026-11-15T10:00:00.000Z',
}

const pgRow = {
  id: snapshotContent.id,
  content_type: snapshotContent.contentType,
  owner_user_id: snapshotContent.ownerUserId,
  creator_id: snapshotContent.creatorId,
  ip_id: snapshotContent.ipId,
  state: snapshotContent.state,
  scheduled_at: null,
  access_mode: 'PUBLIC',
  version: snapshotContent.version,
  revision: snapshotContent.revision,
  slug: snapshotContent.slug,
  title: snapshotContent.title,
  body_ref: snapshotContent.bodyRef,
  media_refs_json: '[]',
  cover_ref: null,
  media_warning: null,
  etag: snapshotContent.etag,
  created_at: new Date(snapshotContent.createdAt),
  updated_at: new Date(snapshotContent.updatedAt),
  idem_id: null,
  idem_owner_user_id: null,
  idem_request_hash: null,
  idem_status: null,
  idem_response_status: null,
  idem_response_json: null,
  idem_expires_at: null,
}

function fixture(options: { casMiss?: boolean; idempotencyConflict?: boolean } = {}) {
  const directQueries: Array<{ sql: string; values?: unknown[] }> = []
  const transactionQueries: Array<{ sql: string; values?: unknown[] }> = []
  let released = false

  const client = {
    async query<Row>(sql: string, values?: unknown[]) {
      transactionQueries.push({ sql, values })
      if (options.idempotencyConflict && sql.startsWith('INSERT INTO content_mutation_idempotency')) {
        throw Object.assign(new Error('duplicate idempotency key'), {
          code: '23505',
          constraint: 'content_mutation_idempotency_owner_user_id_operation_id_idempotency_key_key',
        })
      }
      if (options.casMiss && sql.startsWith('UPDATE contents')) {
        return { rows: [] as Row[] }
      }
      if (sql.startsWith('UPDATE contents')) return { rows: [{ id: snapshotContent.id }] as Row[] }
      return { rows: [] as Row[] }
    },
    release() { released = true },
  }

  const database: ContentMutationPostgresDatabase = {
    async query<Row>(sql: string, values?: unknown[]) {
      directQueries.push({ sql, values })
      if (sql.includes('FROM contents c LEFT JOIN LATERAL')) return { rows: [pgRow] as Row[] }
      if (sql.includes("FROM contents WHERE state = 'SCHEDULED'")) {
        return { rows: [{
          id: snapshotContent.id,
          owner_user_id: 'user_123',
          creator_id: 'creator_456',
          version: 4,
          scheduled_at: new Date('2026-11-16T11:00:00.000Z'),
        }] as Row[] }
      }
      return { rows: [] as Row[] }
    },
    async connect() { return client },
  }

  return { database, directQueries, transactionQueries, released: () => released }
}

const emptyIdempotency = {
  idem_id: null,
  idem_owner_user_id: null,
  idem_request_hash: null,
  idem_status: null,
  idem_response_status: null,
  idem_response_json: null,
  idem_expires_at: null,
}

describe('W03 Neon content mutation store', () => {
  it('loads owner-keyed idempotency and maps PostgreSQL timestamps into canonical content records', async () => {
    const fake = fixture()
    const store = createPostgresContentMutationStore(fake.database)

    const result = await store.loadMutation(
      'user_123', snapshotContent.id, 'updateContent', 'update-key',
    )
    expect(result.content).toMatchObject({
      id: snapshotContent.id,
      ownerUserId: 'user_123',
      version: 4,
      revision: 3,
      createdAt: snapshotContent.createdAt,
      updatedAt: snapshotContent.updatedAt,
    })
    expect(result.idempotency).toEqual(emptyIdempotency)
    expect(fake.directQueries[0]?.sql).toContain('LEFT JOIN LATERAL')
    expect(fake.directQueries[0]?.sql).toContain('owner_user_id = $1')
  })

  it('commits the idempotency row, CAS update, revision and trigger-backed outbox in one transaction', async () => {
    const fake = fixture()
    const store = createPostgresContentMutationStore(fake.database)
    const updated: ContentRecord = {
      ...snapshotContent,
      title: 'Updated title',
      bodyRef: 'body:updated',
      version: 5,
      revision: 4,
      etag: 'W/"5"',
      updatedAt: nowIso,
    }
    const revision = {
      id: 'revision_4',
      contentId: updated.id,
      revision: 4,
      contentVersion: 5,
      actorUserId: 'user_123',
      sourceRevision: 3,
      operation: 'UPDATE' as const,
      state: 'DRAFT' as const,
      accessMode: 'PUBLIC' as const,
      slug: updated.slug,
      title: updated.title,
      bodyRef: updated.bodyRef,
      mediaRefs: [],
      coverRef: null,
      mediaWarning: null,
      etag: updated.etag,
      reason: null,
      correlationId: 'test-correlation',
      createdAt: nowIso,
    }

    await store.update({
      ownerUserId: 'user_123',
      operationId: 'updateContent',
      idempotencyKey: 'update-key',
      requestHash: 'request-hash',
      responseJson: JSON.stringify(updated),
      updatedAt: nowIso,
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      expectedVersion: 4,
      expectedEtag: 'W/"4"',
      content: updated,
      revision,
    })

    const sql = fake.transactionQueries.map(item => item.sql)
    expect(sql[0]).toBe('BEGIN')
    expect(sql[1]).toContain('DELETE FROM content_mutation_idempotency')
    expect(sql[2]).toContain('INSERT INTO content_mutation_idempotency')
    expect(sql[3]).toContain('UPDATE contents')
    expect(sql[3]).toContain('version = $14 AND etag = $15')
    expect(sql[4]).toContain('INSERT INTO content_revisions')
    expect(sql[5]).toBe('COMMIT')
    expect(fake.transactionQueries[3]?.values?.slice(-3)).toEqual([
      'user_123', 4, 'W/"4"',
    ])
    expect(fake.released()).toBe(true)
  })

  it('rolls back a stale content version and preserves the 412 precondition contract', async () => {
    const fake = fixture({ casMiss: true })
    const store = createPostgresContentMutationStore(fake.database)
    const updated = { ...snapshotContent, version: 5, revision: 4, etag: 'W/"5"', updatedAt: nowIso }

    await expect(store.update({
      ownerUserId: 'user_123',
      operationId: 'updateContent',
      idempotencyKey: 'stale-update-key',
      requestHash: 'request-hash',
      responseJson: JSON.stringify(updated),
      updatedAt: nowIso,
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      expectedVersion: 4,
      expectedEtag: 'W/"4"',
      content: updated,
      revision: {
        id: 'revision_4',
        contentId: updated.id,
        revision: 4,
        contentVersion: 5,
        actorUserId: 'user_123',
        sourceRevision: 3,
        operation: 'UPDATE',
        state: 'DRAFT',
        accessMode: 'PUBLIC',
        slug: updated.slug,
        title: updated.title,
        bodyRef: updated.bodyRef,
        mediaRefs: [],
        coverRef: null,
        etag: updated.etag,
        reason: null,
        correlationId: 'test',
        createdAt: nowIso,
      },
    })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', status: 412 })

    expect(fake.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(fake.released()).toBe(true)
  })

  it('soft-deletes content and commits the 204 idempotency record with the outbox trigger in one transaction', async () => {
    const fake = fixture()
    const store = createPostgresContentMutationStore(fake.database)

    await store.delete({
      ownerUserId: 'user_123',
      operationId: 'deleteContent',
      idempotencyKey: 'delete-key',
      requestHash: 'delete-hash',
      deletedAt: nowIso,
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      contentId: snapshotContent.id,
      expectedVersion: 4,
      expectedEtag: 'W/"4"',
      nextVersion: 5,
      nextEtag: 'W/"5"',
    })

    const sql = fake.transactionQueries.map(item => item.sql)
    expect(sql[0]).toBe('BEGIN')
    expect(sql[1]).toContain('DELETE FROM content_mutation_idempotency')
    expect(sql[2]).toContain('response_status, response_json')
    expect(sql[3]).toContain("SET state = 'DELETED'")
    expect(sql[3]).toContain('version = $6 AND etag = $7')
    expect(sql[4]).toBe('COMMIT')
    expect(fake.transactionQueries[2]?.values?.[5]).toBe(204)
    expect(fake.transactionQueries[2]?.values?.[6]).toBe('')
    expect(fake.released()).toBe(true)
  })

  it('commits a state transition, schedule, creator identity and idempotency in one transaction', async () => {
    const fake = fixture()
    const store = createPostgresContentMutationStore(fake.database)
    const scheduledAt = '2026-11-17T12:00:00.000Z'

    await store.transition({
      ownerUserId: 'user_123',
      operationId: 'transitionContentState',
      idempotencyKey: 'transition-key',
      requestHash: 'transition-hash',
      responseJson: JSON.stringify({ from: 'DRAFT', to: 'SCHEDULED', version: 5, etag: 'W/"5"', scheduledAt }),
      updatedAt: nowIso,
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      contentId: snapshotContent.id,
      expectedVersion: 4,
      expectedEtag: 'W/"4"',
      nextState: 'SCHEDULED',
      scheduledAt,
      nextCreatorId: 'creator_456',
      nextVersion: 5,
      nextEtag: 'W/"5"',
    })

    const sql = fake.transactionQueries.map(item => item.sql)
    expect(sql[0]).toBe('BEGIN')
    expect(sql[1]).toContain('DELETE FROM content_mutation_idempotency')
    expect(sql[2]).toContain('INSERT INTO content_mutation_idempotency')
    expect(sql[3]).toContain('UPDATE contents SET state = $1, scheduled_at = $2::timestamptz')
    expect(sql[3]).toContain('owner_user_id = $8 AND version = $9 AND etag = $10')
    expect(sql[4]).toBe('COMMIT')
    expect(fake.transactionQueries[3]?.values).toEqual([
      'SCHEDULED', scheduledAt, 'creator_456', 5, 'W/"5"', nowIso,
      snapshotContent.id, 'user_123', 4, 'W/"4"',
    ])
    expect(fake.transactionQueries[2]?.values?.[5]).toBe(200)
    expect(fake.released()).toBe(true)
  })

  it('rolls back a state transition when its authoritative version and ETag CAS misses', async () => {
    const fake = fixture({ casMiss: true })
    const store = createPostgresContentMutationStore(fake.database)

    await expect(store.transition({
      ownerUserId: 'user_123',
      operationId: 'transitionContentState',
      idempotencyKey: 'stale-transition-key',
      requestHash: 'transition-hash',
      responseJson: '{}',
      updatedAt: nowIso,
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      contentId: snapshotContent.id,
      expectedVersion: 4,
      expectedEtag: 'W/"4"',
      nextState: 'UNPUBLISHED',
      scheduledAt: null,
      nextCreatorId: 'user_123',
      nextVersion: 5,
      nextEtag: 'W/"5"',
    })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', status: 412 })

    expect(fake.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(fake.released()).toBe(true)
  })

  it('loads only due scheduled candidates from Neon in stable scheduled-time order', async () => {
    const fake = fixture()
    const store = createPostgresContentMutationStore(fake.database)

    await expect(store.listDueScheduled(nowIso, 25)).resolves.toEqual([{
      contentId: snapshotContent.id,
      ownerUserId: 'user_123',
      creatorId: 'creator_456',
      version: 4,
      scheduledAt: '2026-11-16T11:00:00.000Z',
    }])

    expect(fake.directQueries[0]?.sql).toContain("state = 'SCHEDULED'")
    expect(fake.directQueries[0]?.sql).toContain('scheduled_at <= $1::timestamptz')
    expect(fake.directQueries[0]?.sql).toContain('ORDER BY scheduled_at ASC, id ASC LIMIT $2')
    expect(fake.directQueries[0]?.values).toEqual([nowIso, 25])
  })

  it('publishes W08-authorized scheduled candidates with final owner, Creator, due-time and version CAS in one transaction', async () => {
    const fake = fixture()
    const store = createPostgresContentMutationStore(fake.database)
    const candidate = {
      contentId: snapshotContent.id,
      ownerUserId: 'user_123',
      expectedCreatorId: null,
      creatorId: 'creator_456',
      version: 4,
      scheduledAt: '2026-11-16T11:00:00.000Z',
      authorization: {
        decision: 'ALLOW' as const,
        policyVersion: 'casl-l0-l8-v1' as const,
        layer: 'L3' as const,
        action: 'content.publish.own' as const,
        resourceType: 'Content' as const,
        ownerUserId: 'user_123',
        creatorId: 'creator_456',
      },
    }

    await expect(store.publishScheduled([candidate], nowIso)).resolves.toBe(1)

    const sql = fake.transactionQueries.map(item => item.sql)
    expect(sql[0]).toBe('BEGIN')
    expect(sql[1]).toContain("SET state = 'PUBLISHED', scheduled_at = NULL")
    expect(sql[1]).toContain('creator_id IS NOT DISTINCT FROM $7')
    expect(sql[1]).toContain("state = 'SCHEDULED'")
    expect(sql[1]).toContain('scheduled_at = $8::timestamptz')
    expect(sql[1]).toContain('scheduled_at <= $9::timestamptz AND version = $10')
    expect(sql[2]).toBe('COMMIT')
    expect(fake.transactionQueries[1]?.values).toEqual([
      'creator_456', 5, 'W/"5"', nowIso, snapshotContent.id, 'user_123',
      null, candidate.scheduledAt, nowIso, 4,
    ])
    expect(fake.released()).toBe(true)
  })

  it('rolls back a duplicate delete idempotency key', async () => {
    const fake = fixture({ idempotencyConflict: true })
    const store = createPostgresContentMutationStore(fake.database)

    await expect(store.delete({
      ownerUserId: 'user_123',
      operationId: 'deleteContent',
      idempotencyKey: 'delete-key',
      requestHash: 'delete-hash',
      deletedAt: nowIso,
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      contentId: snapshotContent.id,
      expectedVersion: 4,
      expectedEtag: 'W/"4"',
      nextVersion: 5,
      nextEtag: 'W/"5"',
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS', status: 409 })

    expect(fake.transactionQueries.at(-1)?.sql).toBe('ROLLBACK')
    expect(fake.released()).toBe(true)
  })

  it('routes owner-authorized state transitions through Neon without issuing a D1 statement', async () => {
    const publishedContent = { ...snapshotContent, state: 'PUBLISHED' as const }
    let transitionInput: Parameters<ContentMutationStore['transition']>[0] | undefined
    const store: ContentMutationStore = {
      async loadMutation() {
        return { content: publishedContent, idempotency: emptyIdempotency }
      },
      async update() {},
      async delete() {},
      async transition(input) { transitionInput = input },
      async listDueScheduled() { return [] },
      async publishScheduled() { return 0 },
    }
    const d1 = {
      prepare() { throw new Error('D1 must not be queried in Neon mode') },
      batch() { throw new Error('D1 must not be written in Neon mode') },
    }

    const result = await transitionContentState(
      d1 as never,
      'user_123',
      'L2',
      snapshotContent.id,
      'UNPUBLISHED',
      undefined,
      'W/"4"',
      'neon-transition-key',
      now,
      {},
      store,
    )

    expect(result).toMatchObject({ from: 'PUBLISHED', to: 'UNPUBLISHED', version: 5, etag: 'W/"5"', scheduledAt: null })
    expect(transitionInput).toMatchObject({
      ownerUserId: 'user_123',
      operationId: 'transitionContentState',
      contentId: snapshotContent.id,
      expectedVersion: 4,
      expectedEtag: 'W/"4"',
      nextState: 'UNPUBLISHED',
      scheduledAt: null,
      nextCreatorId: 'user_123',
      nextVersion: 5,
      nextEtag: 'W/"5"',
    })
    expect(transitionInput?.responseJson).toBe(JSON.stringify(result))
  })

  it('routes scheduled candidate reads and W08-authorized publish commits through Neon without touching D1', async () => {
    const dueCandidate = {
      contentId: snapshotContent.id,
      ownerUserId: 'user_123',
      creatorId: 'creator_456',
      version: 4,
      scheduledAt: '2026-11-16T11:00:00.000Z',
    }
    let publishedCandidates: readonly unknown[] = []
    const store: ContentMutationStore = {
      async loadMutation() { return { content: null, idempotency: emptyIdempotency } },
      async update() {},
      async delete() {},
      async transition() {},
      async listDueScheduled(nowValue, limit) {
        expect(nowValue).toBe(nowIso)
        expect(limit).toBe(10)
        return [dueCandidate]
      },
      async publishScheduled(candidates) {
        publishedCandidates = candidates
        return 1
      },
    }
    const d1 = {
      prepare() { throw new Error('D1 must not be queried in Neon mode') },
      batch() { throw new Error('D1 must not be written in Neon mode') },
    }
    const due = await listDueScheduledContentCandidates(d1 as never, now, 10, store)
    const result = await publishAuthorizedScheduledContents(d1 as never, [{
      ...dueCandidate,
      expectedCreatorId: null,
      authorization: {
        decision: 'ALLOW',
        policyVersion: 'casl-l0-l8-v1',
        layer: 'L3',
        action: 'content.publish.own',
        resourceType: 'Content',
        ownerUserId: 'user_123',
        creatorId: 'creator_456',
      },
    }], now, store)

    expect(due).toEqual([dueCandidate])
    expect(result).toEqual({ scanned: 1, authorized: 1, published: 1, rejected: 0 })
    expect(publishedCandidates).toHaveLength(1)
  })

  it('injects Neon-backed update and delete stores without issuing a D1 statement', async () => {
    let currentContent = snapshotContent
    let updateInput: Parameters<ContentMutationStore['update']>[0] | undefined
    let deleteInput: Parameters<ContentMutationStore['delete']>[0] | undefined
    const store: ContentMutationStore = {
      async loadMutation() {
        return { content: currentContent, idempotency: emptyIdempotency }
      },
      async update(input) {
        updateInput = input
        currentContent = input.content
      },
      async delete(input) { deleteInput = input },
      async transition() {},
      async listDueScheduled() { return [] },
      async publishScheduled() { return 0 },
    }
    const d1 = {
      prepare() { throw new Error('D1 must not be queried in Neon mode') },
      batch() { throw new Error('D1 must not be written in Neon mode') },
    }

    const updated = await updateContent(
      d1 as never,
      'user_123',
      snapshotContent.id,
      { contentType: 'post', title: 'Updated from Neon', bodyRef: 'body:updated', mediaRefs: [], coverRef: null },
      'W/"4"',
      'neon-update-key',
      now,
      'neon-update-test',
      'L2',
      undefined,
      store,
    )
    await deleteContent(
      d1 as never,
      'user_123',
      snapshotContent.id,
      updated.etag,
      'neon-delete-key',
      now,
      'L2',
      store,
    )

    expect(updateInput?.content.id).toBe(snapshotContent.id)
    expect(updateInput?.expectedVersion).toBe(4)
    expect(deleteInput?.expectedVersion).toBe(5)
    expect(deleteInput?.nextVersion).toBe(6)
  })
})
