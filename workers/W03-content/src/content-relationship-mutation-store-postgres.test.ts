import { describe, expect, it } from 'vitest'

import { ContentRuntimeError } from './content-runtime.js'
import {
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

function fixture(options: { revokeMiss?: boolean; uniqueConflict?: boolean } = {}) {
  const directQueries: Array<{ sql: string; values?: unknown[] }> = []
  const transactionQueries: Array<{ sql: string; values?: unknown[] }> = []
  let released = false

  const client = {
    async query<Row>(sql: string, values?: unknown[]) {
      transactionQueries.push({ sql, values })
      if (options.uniqueConflict && sql.startsWith('INSERT INTO content_relationships')) {
        throw Object.assign(new Error('duplicate active relationship'), {
          code: '23505',
          constraint: 'content_relationships_active_unique_idx',
        })
      }
      if (options.revokeMiss && sql.startsWith('UPDATE content_relationships')) {
        return { rows: [] as Row[] }
      }
      if (sql.startsWith('INSERT INTO content_relationships')) {
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
