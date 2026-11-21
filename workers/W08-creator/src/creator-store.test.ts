import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'

import { createPostgresW08CreatorStore } from './creator-store.js'

type QueryResult = { rows: Array<Record<string, unknown>>; rowCount: number | null }

class FakeClient {
  readonly calls: Array<{ sql: string; values: unknown[] }> = []
  released = false

  async query(sql: string, values: unknown[] = []): Promise<QueryResult> {
    this.calls.push({ sql, values })
    if (sql.includes('RETURNING user_id AS "userId"')) {
      return { rows: [{ userId: 'w08-applicant-0001' }], rowCount: 1 }
    }
    return { rows: [], rowCount: 1 }
  }

  release() {
    this.released = true
  }
}

class FakePool {
  readonly client = new FakeClient()
  readonly calls: Array<{ sql: string; values: unknown[] }> = []

  async query(sql: string, values: unknown[] = []): Promise<QueryResult> {
    this.calls.push({ sql, values })
    return { rows: [], rowCount: 0 }
  }

  async connect(): Promise<FakeClient> {
    return this.client
  }
}

const now = '2026-11-12T12:00:00.000Z'
const correlationId = 'w08-creator-store-test'

describe('W08 PostgreSQL creator persistence store', () => {
  it('creates the application and submission audit in one transaction', async () => {
    const fake = new FakePool()
    const store = createPostgresW08CreatorStore(fake as unknown as Pool)

    await store.createApplication({
      applicationId: 'w08-app-00000001',
      userId: 'w08-user-00000001',
      creatorType: 'WRITER',
      statement: 'Creator application test.',
      idempotencyKey: 'w08-idem-00000001',
      correlationId,
      now,
    })

    expect(fake.client.calls.map((call) => call.sql)).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO creator_applications'),
      expect.stringContaining('INSERT INTO creator_authorization_audit'),
      'COMMIT',
    ])
    expect(fake.client.calls[2]?.sql).toContain('ON CONFLICT (event_key) DO NOTHING')
    expect(fake.client.released).toBe(true)
  })

  it('uses a version/status compare-and-set and inserts creator plus audit atomically', async () => {
    const fake = new FakePool()
    const store = createPostgresW08CreatorStore(fake as unknown as Pool)

    await expect(store.approveApplication({
      applicationId: 'w08-app-00000002',
      applicantId: 'w08-user-00000002',
      creatorType: 'WRITER',
      actorId: 'w08-reviewer-0001',
      idempotencyKey: 'w08-review-00000002',
      reason: 'Reviewed creator application.',
      expectedVersion: 1,
      correlationId,
      now,
    })).resolves.toBe(true)

    const sql = fake.client.calls.map((call) => call.sql)
    expect(sql[0]).toBe('BEGIN')
    expect(sql[1]).toContain("WHERE application_id = $6 AND status = 'PENDING' AND version = $7 RETURNING")
    expect(sql[2]).toContain('INSERT INTO creators')
    expect(sql[3]).toContain('INSERT INTO creator_authorization_audit')
    expect(sql.at(-1)).toBe('COMMIT')
    expect(fake.client.released).toBe(true)
  })

  it('does not create a creator or decision audit when the application CAS misses', async () => {
    const fake = new FakePool()
    fake.client.query = async (sql: string, values: unknown[] = []) => {
      fake.client.calls.push({ sql, values })
      if (sql.includes('RETURNING user_id AS "userId"')) return { rows: [], rowCount: 0 }
      return { rows: [], rowCount: 1 }
    }
    const store = createPostgresW08CreatorStore(fake as unknown as Pool)

    await expect(store.rejectApplication({
      applicationId: 'w08-app-stale-0001',
      applicantId: 'w08-user-stale-0001',
      creatorType: 'WRITER',
      actorId: 'w08-reviewer-0001',
      idempotencyKey: 'w08-review-stale-01',
      reason: 'Stale decision.',
      expectedVersion: 1,
      correlationId,
      now,
    })).resolves.toBe(false)

    expect(fake.client.calls.some((call) => call.sql.includes('creator_authorization_audit'))).toBe(false)
    expect(fake.client.calls.at(-1)?.sql).toBe('COMMIT')
    expect(fake.client.released).toBe(true)
  })

  it('activates the creator identity and finalizes the grant in one transaction', async () => {
    const fake = new FakePool()
    const store = createPostgresW08CreatorStore(fake as unknown as Pool)

    await store.completeCreatorGrant({
      applicationId: 'w08-app-00000003',
      applicantId: 'w08-user-00000003',
      creatorId: 'creator-w08-app-00000003',
      actorId: 'w08-reviewer-0001',
      idempotencyKey: 'w08-review-00000003',
      correlationId,
      now,
    })

    const sql = fake.client.calls.map((call) => call.sql)
    expect(sql[0]).toBe('BEGIN')
    expect(sql[1]).toContain("grant_state = 'GRANTED'")
    expect(sql[2]).toContain("status = 'ACTIVE'")
    expect(sql[3]).toContain('creator_authorization_audit')
    expect(sql.at(-1)).toBe('COMMIT')
    expect(fake.client.released).toBe(true)
  })
})
