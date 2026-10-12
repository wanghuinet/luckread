import { beforeEach, describe, expect, it } from 'vitest'
import worker from './index.js'

type TestPrincipal = {
  active: boolean
  userId: string
  email: string
  accountState: 'ACTIVE'
  layer: string
}

type TestApplication = {
  application_id: string
  user_id: string
  creator_type: string
  statement: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  grant_state: 'NOT_REQUESTED' | 'PENDING' | 'GRANTED'
  version: number
  application_idempotency_key: string
  decision_idempotency_key: string | null
  decided_by: string | null
  decision_reason: string | null
  created_at: string
  updated_at: string
  decided_at: string | null
}

class FakeStatement {
  values: unknown[] = []

  constructor(private readonly db: FakeD1, readonly sql: string) {}

  bind(...values: unknown[]) {
    this.values = values
    return this
  }

  async first<T>(): Promise<T | null> {
    this.db.queries.push({ sql: this.sql, values: this.values })
    const [a, b] = this.values

    if (this.sql.includes('FROM creator_applications WHERE user_id = ? AND application_idempotency_key = ?')) {
      const row = [...this.db.applications.values()].find(
        (item) => item.user_id === a && item.application_idempotency_key === b,
      )
      return (row ?? null) as T | null
    }

    if (this.sql.includes('FROM creator_applications WHERE user_id = ? AND status = \'PENDING\'')) {
      const row = [...this.db.applications.values()].find(
        (item) => item.user_id === a && item.status === 'PENDING',
      )
      return row ? { application_id: row.application_id } as T : null
    }

    if (this.sql.includes('FROM creator_applications WHERE application_id = ? LIMIT 1')) {
      return (this.db.applications.get(String(a)) ?? null) as T | null
    }

    if (this.sql.includes('FROM creator_applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')) {
      const row = [...this.db.applications.values()]
        .filter((item) => item.user_id === a)
        .sort((left, right) => right.created_at.localeCompare(left.created_at))[0]
      if (!row) return null
      const { application_id, creator_type, statement, status, grant_state, version, created_at, updated_at, decided_at, decision_reason } = row
      return { application_id, creator_type, statement, status, grant_state, version, created_at, updated_at, decided_at, decision_reason } as T
    }

    if (this.sql.includes('FROM creators WHERE user_id = ?')) {
      return (this.db.creators.get(String(a)) ?? null) as T | null
    }

    return null
  }

  async all<T>(): Promise<{ results: T[] }> {
    this.db.queries.push({ sql: this.sql, values: this.values })
    const reviewerId = String(this.values[0] ?? '')
    const limit = Number(this.values[1] ?? 25)
    const results = [...this.db.applications.values()]
      .filter((item) => item.status === 'PENDING' ||
        (item.status === 'APPROVED' && item.grant_state === 'PENDING' && item.decided_by === reviewerId))
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .slice(0, limit)
      .map(({ application_id, user_id, creator_type, statement, status, grant_state, version, created_at }) => ({
        application_id, user_id, creator_type, statement, status, grant_state, version, created_at,
      }))
    return { results: results as T[] }
  }
}

class FakeD1 {
  applications = new Map<string, TestApplication>()
  creators = new Map<string, { creator_id: string; application_id: string }>()
  queries: Array<{ sql: string; values: unknown[] }> = []
  batches = 0

  prepare(sql: string) {
    return new FakeStatement(this, sql)
  }

  async batch(statements: unknown[]) {
    this.batches++
    const results = statements.map((item) => {
      const statement = item as FakeStatement
      if (statement.sql.includes('INSERT INTO creator_applications')) {
        const [applicationId, userId, creatorType, statementText, idempotencyKey, now, updatedAt] = statement.values
        this.applications.set(String(applicationId), {
          application_id: String(applicationId),
          user_id: String(userId),
          creator_type: String(creatorType),
          statement: String(statementText),
          status: 'PENDING',
          grant_state: 'NOT_REQUESTED',
          version: 1,
          application_idempotency_key: String(idempotencyKey),
          decision_idempotency_key: null,
          decided_by: null,
          decision_reason: null,
          created_at: String(now),
          updated_at: String(updatedAt),
          decided_at: null,
        })
        return { meta: { changes: 1 } }
      }
      return { meta: { changes: 1 } }
    })
    return results
  }
}

const principal = (userId: string, layer: string): TestPrincipal => ({
  active: true,
  userId,
  email: userId + '@example.test',
  accountState: 'ACTIVE',
  layer,
})

const request = (path: string, method: string, body?: unknown, headers?: HeadersInit) =>
  new Request('https://luckread-w08-creator.internal' + path, {
    method,
    headers: new Headers({
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(headers ?? {}),
    }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

function harness(current: TestPrincipal | null) {
  const db = new FakeD1()
  const auth = {
    async fetch(incoming: Request): Promise<Response> {
      const path = new URL(incoming.url).pathname
      if (path === '/internal/auth/principal') {
        return current
          ? Response.json(current)
          : Response.json({ active: false }, { status: 401 })
      }
      // Tests must not accidentally promote an identity unless a test opts into it.
      throw new Error('Unexpected W02 role-assignment call in guard-path test')
    },
  }
  const env = {
    D1_01: db as unknown as D1Database,
    W02_AUTH: auth as unknown as Fetcher,
  } as Parameters<typeof worker.fetch>[1]
  return { db, env }
}

async function responseBody(response: Response) {
  return await response.json() as {
    data?: {
      error?: { code?: string; message?: string }
      applicationId?: string
      application?: Record<string, unknown> | null
      status?: string
      grantState?: string
      replayed?: boolean
      data?: Array<Record<string, unknown>>
    }
    requestId?: string
  }
}

function existingApplication(overrides: Partial<TestApplication> = {}): TestApplication {
  return {
    application_id: 'creator-app-0001',
    user_id: 'applicant-0001',
    creator_type: 'WRITER',
    statement: 'I write articles.',
    status: 'PENDING',
    grant_state: 'NOT_REQUESTED',
    version: 1,
    application_idempotency_key: 'creator-apply-0001',
    decision_idempotency_key: null,
    decided_by: null,
    decision_reason: null,
    created_at: '2026-10-12T00:00:00.000Z',
    updated_at: '2026-10-12T00:00:00.000Z',
    decided_at: null,
    ...overrides,
  }
}

describe('W08 creator qualification runtime guards', () => {
  let db: FakeD1
  let env: Parameters<typeof worker.fetch>[1]

  beforeEach(() => {
    const setup = harness(principal('applicant-0001', 'L2'))
    db = setup.db
    env = setup.env
  })

  it('rejects a verified L1 user at the API boundary without creating an application', async () => {
    const setup = harness(principal('user-l1-0001', 'L1'))
    const response = await worker.fetch(request('/api/v1/creator-applications', 'POST', {
      creatorType: 'WRITER',
      statement: 'I write articles.',
    }, { 'Idempotency-Key': 'creator-apply-l1-0001' }), setup.env)

    expect(response.status).toBe(403)
    expect((await responseBody(response)).data?.error?.code).toBe('VERIFIED_USER_REQUIRED')
    expect(setup.db.applications.size).toBe(0)
    expect(setup.db.batches).toBe(0)
  })

  it('rejects L6 from both review-list and decision endpoints before reading or writing D1', async () => {
    const setup = harness(principal('moderator-l6-0001', 'L6'))
    const listResponse = await worker.fetch(request('/api/v1/admin/creator-applications', 'GET'), setup.env)
    const decisionResponse = await worker.fetch(request('/api/v1/admin/creator-applications/decision', 'POST', {
      applicationId: 'creator-app-0001',
      decision: 'APPROVED',
      reason: '',
    }, { 'Idempotency-Key': 'review-l6-0001', 'If-Match': '"1"' }), setup.env)

    expect(listResponse.status).toBe(403)
    expect((await responseBody(listResponse)).data?.error?.code).toBe('PERMISSION_DENIED')
    expect(decisionResponse.status).toBe(403)
    expect((await responseBody(decisionResponse)).data?.error?.code).toBe('PERMISSION_DENIED')
    expect(setup.db.queries).toHaveLength(0)
    expect(setup.db.batches).toBe(0)
  })

  it('rejects missing identity and fails closed before any D1 work', async () => {
    const setup = harness(null)
    const response = await worker.fetch(request('/api/v1/creator-applications/me', 'GET'), setup.env)

    expect(response.status).toBe(401)
    expect((await responseBody(response)).data?.error?.code).toBe('UNAUTHENTICATED')
    expect(setup.db.queries).toHaveLength(0)
  })

  it('creates an L2 application once and replays the same idempotency key without a second write', async () => {
    const firstResponse = await worker.fetch(request('/api/v1/creator-applications', 'POST', {
      creatorType: 'WRITER',
      statement: 'I write articles.',
      layer: 'L3',
      roleId: 'creator',
    }, { 'Idempotency-Key': 'creator-apply-once-0001' }), env)
    const first = await responseBody(firstResponse)

    const replayResponse = await worker.fetch(request('/api/v1/creator-applications', 'POST', {
      creatorType: 'WRITER',
      statement: 'I write articles.',
      layer: 'L8',
      roleId: 'admin',
    }, { 'Idempotency-Key': 'creator-apply-once-0001' }), env)
    const replay = await responseBody(replayResponse)

    expect(firstResponse.status).toBe(201)
    expect(first.data?.status).toBe('PENDING')
    expect(replayResponse.status).toBe(200)
    expect(replay.data?.replayed).toBe(true)
    expect(replay.data?.applicationId).toBe(first.data?.applicationId)
    expect(db.applications.size).toBe(1)
    expect(db.batches).toBe(1)
  })

  it('allows an applicant to read only their own application status', async () => {
    db.applications.set('creator-app-0001', existingApplication())
    const own = await worker.fetch(request('/api/v1/creator-applications/me', 'GET'), env)
    expect(own.status).toBe(200)
    expect((await responseBody(own)).data?.application).toMatchObject({
      application_id: 'creator-app-0001',
      status: 'PENDING',
    })

    const otherHarness = harness(principal('different-user-0001', 'L2'))
    otherHarness.db.applications.set('creator-app-0001', existingApplication())
    const other = await worker.fetch(request('/api/v1/creator-applications/me', 'GET'), otherHarness.env)
    expect(other.status).toBe(200)
    expect((await responseBody(other)).data?.application).toBeNull()
  })

  it('rejects self-review and stale-version decisions without mutating an application', async () => {
    db.applications.set('creator-app-0001', existingApplication())
    const selfHarness = harness(principal('applicant-0001', 'L7'))
    selfHarness.db.applications.set('creator-app-0001', existingApplication())
    const selfResponse = await worker.fetch(request('/api/v1/admin/creator-applications/decision', 'POST', {
      applicationId: 'creator-app-0001', decision: 'APPROVED', reason: '',
    }, { 'Idempotency-Key': 'creator-review-self-0001', 'If-Match': '"1"' }), selfHarness.env)
    expect(selfResponse.status).toBe(403)
    expect((await responseBody(selfResponse)).data?.error?.code).toBe('SELF_APPROVAL_DENIED')
    expect(selfHarness.db.batches).toBe(0)

    const staleResponse = await worker.fetch(request('/api/v1/admin/creator-applications/decision', 'POST', {
      applicationId: 'creator-app-0001', decision: 'APPROVED', reason: '',
    }, { 'Idempotency-Key': 'creator-review-stale-0001', 'If-Match': '"9"' }), env)
    expect(staleResponse.status).toBe(412)
    expect((await responseBody(staleResponse)).data?.error?.code).toBe('PRECONDITION_FAILED')
    expect(db.batches).toBe(0)
  })

  it('rejects a conflicting decision after the application has reached a final state', async () => {
    const setup = harness(principal('reviewer-l7-0001', 'L7'))
    setup.db.applications.set('creator-app-0001', existingApplication({
      status: 'APPROVED',
      grant_state: 'PENDING',
      version: 2,
      decision_idempotency_key: 'creator-review-original-0001',
      decided_by: 'reviewer-l8-0001',
      decided_at: '2026-10-12T00:10:00.000Z',
    }))
    const response = await worker.fetch(request('/api/v1/admin/creator-applications/decision', 'POST', {
      applicationId: 'creator-app-0001', decision: 'REJECTED', reason: 'conflicting decision',
    }, { 'Idempotency-Key': 'creator-review-conflict-0001', 'If-Match': '"2"' }), setup.env)

    expect(response.status).toBe(409)
    expect((await responseBody(response)).data?.error?.code).toBe('DECISION_CONFLICT')
    expect(setup.db.batches).toBe(0)
  })
})
