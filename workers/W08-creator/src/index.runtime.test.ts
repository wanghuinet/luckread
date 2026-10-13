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
      const row = this.db.creators.get(String(a))
      if (!row) return null
      if (this.sql.includes('AS creatorId')) {
        return { creatorId: row.creator_id, applicationId: row.application_id } as T
      }
      return { creator_id: row.creator_id, application_id: row.application_id } as T
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
  creators = new Map<string, { creator_id: string; application_id: string; status?: string; version?: number; updated_at?: string }>()
  queries: Array<{ sql: string; values: unknown[] }> = []
  batches = 0

  prepare(sql: string) {
    return new FakeStatement(this, sql)
  }

  async batch(statements: unknown[]) {
    this.batches++
    const results = statements.map((item) => {
      const statement = item as FakeStatement
      const values = statement.values

      if (statement.sql.includes('INSERT INTO creator_applications')) {
        const [applicationId, userId, creatorType, statementText, idempotencyKey, now, updatedAt] = values
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

      if (statement.sql.includes("UPDATE creator_applications SET status = 'APPROVED'")) {
        const [key, actorId, reason, decidedAt, updatedAt, applicationId, expectedVersion] = values
        const row = this.applications.get(String(applicationId))
        if (!row || row.status !== 'PENDING' || row.version !== Number(expectedVersion)) {
          return { meta: { changes: 0 } }
        }
        Object.assign(row, {
          status: 'APPROVED',
          grant_state: 'PENDING',
          version: row.version + 1,
          decision_idempotency_key: String(key),
          decided_by: String(actorId),
          decision_reason: String(reason),
          decided_at: String(decidedAt),
          updated_at: String(updatedAt),
        })
        return { meta: { changes: 1 } }
      }

      if (statement.sql.includes('INSERT INTO creators')) {
        const [creatorId, createdAt, updatedAt, applicationId, key, actorId] = values
        const row = this.applications.get(String(applicationId))
        if (!row || row.status !== 'APPROVED' || row.decision_idempotency_key !== key || row.decided_by !== actorId) {
          return { meta: { changes: 0 } }
        }
        this.creators.set(row.user_id, {
          creator_id: String(creatorId),
          application_id: row.application_id,
          status: 'PENDING_ROLE_GRANT',
          version: 1,
          updated_at: String(updatedAt ?? createdAt),
        })
        return { meta: { changes: 1 } }
      }

      if (statement.sql.includes("UPDATE creator_applications SET grant_state = 'GRANTED'")) {
        const [updatedAt, applicationId] = values
        const row = this.applications.get(String(applicationId))
        if (!row || row.status !== 'APPROVED' || row.grant_state !== 'PENDING') return { meta: { changes: 0 } }
        row.grant_state = 'GRANTED'
        row.version++
        row.updated_at = String(updatedAt)
        return { meta: { changes: 1 } }
      }

      if (statement.sql.includes("UPDATE creators SET status = 'ACTIVE'")) {
        const [updatedAt, applicationId] = values
        const row = [...this.creators.values()].find((item) => item.application_id === String(applicationId))
        if (!row || row.status !== 'PENDING_ROLE_GRANT') return { meta: { changes: 0 } }
        row.status = 'ACTIVE'
        row.version = (row.version ?? 1) + 1
        row.updated_at = String(updatedAt)
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

const request = (path: string, method: string, body?: unknown, headers?: HeadersInit) => {
  const requestHeaders = new Headers(headers)
  if (body !== undefined && !requestHeaders.has('content-type')) {
    requestHeaders.set('content-type', 'application/json')
  }
  return new Request('https://luckread-w08-creator.internal' + path, {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function harness(current: TestPrincipal | null, allowRoleGrant = false, sharedDb?: FakeD1) {
  const db = sharedDb ?? new FakeD1()
  const roleGrants: Array<Record<string, unknown>> = []
  const auth = {
    async fetch(incoming: Request): Promise<Response> {
      const path = new URL(incoming.url).pathname
      if (path === '/internal/auth/principal') {
        return current
          ? Response.json(current)
          : Response.json({ active: false }, { status: 401 })
      }
      if (path === '/internal/authz/role-assignment' && allowRoleGrant) {
        roleGrants.push(await incoming.json() as Record<string, unknown>)
        return Response.json({ assignmentId: 'role-assignment-test-0001', replayed: false })
      }
      // Tests must not accidentally promote an identity unless a test opts into it.
      throw new Error('Unexpected W02 role-assignment call in guard-path test')
    },
  }
  const env = {
    D1_01: db as unknown as D1Database,
    W02_AUTH: auth as unknown as Fetcher,
  } as Parameters<typeof worker.fetch>[1]
  return { db, env, roleGrants }
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
  it('routes the internal CASL endpoint and rejects a forged subject before any D1 access', async () => {
    const setup = harness(principal('regular-user-0001', 'L2'))
    const response = await worker.fetch(request('/internal/authz/check-permission', 'POST', {
      subjectId: 'admin-user-0001',
      action: 'creator.application.review',
      resourceType: 'CreatorApplication',
    }), setup.env)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      decision: 'DENY',
      reasonCode: 'CALLER_SUPPLIED_AUTHORIZATION_CONTEXT',
    })
    expect(setup.db.queries).toHaveLength(0)
    expect(setup.db.batches).toBe(0)
  })

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

    const staleHarness = harness(principal('reviewer-l7-0002', 'L7'))
    staleHarness.db.applications.set('creator-app-0001', existingApplication())
    const staleResponse = await worker.fetch(request('/api/v1/admin/creator-applications/decision', 'POST', {
      applicationId: 'creator-app-0001', decision: 'APPROVED', reason: '',
    }, { 'Idempotency-Key': 'creator-review-stale-0001', 'If-Match': '"9"' }), staleHarness.env)
    expect(staleResponse.status).toBe(412)
    expect((await responseBody(staleResponse)).data?.error?.code).toBe('PRECONDITION_FAILED')
    expect(staleHarness.db.batches).toBe(0)
  })

  it('closes the applicant-to-review-to-W02-grant lifecycle against one shared D1 state', async () => {
    const applicant = harness(principal('applicant-lifecycle-0001', 'L2'))
    const submittedResponse = await worker.fetch(request('/api/v1/creator-applications', 'POST', {
      creatorType: 'WRITER',
      statement: 'Lifecycle acceptance test.',
    }, { 'Idempotency-Key': 'creator-lifecycle-apply-0001' }), applicant.env)
    const submitted = await responseBody(submittedResponse)
    const applicationId = submitted.data?.applicationId

    expect(submittedResponse.status).toBe(201)
    expect(applicationId).toBeTruthy()
    expect(submitted.data?.status).toBe('PENDING')

    const reviewer = harness(principal('reviewer-l7-lifecycle-0001', 'L7'), true, applicant.db)
    const decisionResponse = await worker.fetch(request('/api/v1/admin/creator-applications/decision', 'POST', {
      applicationId,
      decision: 'APPROVED',
      reason: 'Lifecycle acceptance approved.',
    }, { 'Idempotency-Key': 'creator-lifecycle-review-0001', 'If-Match': '"1"' }), reviewer.env)
    const decision = await responseBody(decisionResponse)

    expect(decisionResponse.status).toBe(200)
    expect(decision.data).toMatchObject({ status: 'APPROVED', grantState: 'GRANTED', version: 3 })
    expect(reviewer.roleGrants).toEqual([{
      subjectId: 'applicant-lifecycle-0001',
      roleId: 'creator',
      scopeType: 'global',
      scopeId: null,
      approvalRef: 'creator-application-' + applicationId,
    }])

    const promotedApplicant = harness(principal('applicant-lifecycle-0001', 'L3'), false, applicant.db)
    const statusResponse = await worker.fetch(request('/api/v1/creator-applications/me', 'GET'), promotedApplicant.env)
    const status = await responseBody(statusResponse)

    expect(statusResponse.status).toBe(200)
    expect(status.data?.application).toMatchObject({
      application_id: applicationId,
      status: 'APPROVED',
      grant_state: 'GRANTED',
    })
    expect(applicant.db.creators.get('applicant-lifecycle-0001')).toMatchObject({
      application_id: applicationId,
      status: 'ACTIVE',
    })
  })

  it('grants L3 only after an authorized L7 approval and W02 confirms RoleAssignment', async () => {
    const setup = harness(principal('reviewer-l7-0001', 'L7'), true)
    setup.db.applications.set('creator-app-0001', existingApplication())

    const response = await worker.fetch(request('/api/v1/admin/creator-applications/decision', 'POST', {
      applicationId: 'creator-app-0001',
      decision: 'APPROVED',
      reason: 'Creator qualification accepted.',
    }, { 'Idempotency-Key': 'creator-review-approve-0001', 'If-Match': '"1"' }), setup.env)
    const result = await responseBody(response)

    expect(response.status).toBe(200)
    expect(result.data).toMatchObject({ status: 'APPROVED', grantState: 'GRANTED', version: 3 })
    expect(setup.roleGrants).toEqual([{
      subjectId: 'applicant-0001',
      roleId: 'creator',
      scopeType: 'global',
      scopeId: null,
      approvalRef: 'creator-application-creator-app-0001',
    }])
    expect(setup.db.creators.get('applicant-0001')).toMatchObject({
      application_id: 'creator-app-0001',
      status: 'ACTIVE',
    })
    expect(setup.db.applications.get('creator-app-0001')).toMatchObject({
      status: 'APPROVED',
      grant_state: 'GRANTED',
      decided_by: 'reviewer-l7-0001',
    })
  })

  it('shows grant-pending retries only to the reviewer who originally approved the application', async () => {
    const reviewer = harness(principal('reviewer-l7-0001', 'L7'))
    const otherReviewer = harness(principal('reviewer-l7-0002', 'L7'))
    reviewer.db.applications.set('creator-app-own-retry', existingApplication({
      application_id: 'creator-app-own-retry',
      status: 'APPROVED',
      grant_state: 'PENDING',
      version: 2,
      decided_by: 'reviewer-l7-0001',
      decision_idempotency_key: 'creator-review-original-own',
    }))
    reviewer.db.applications.set('creator-app-other-retry', existingApplication({
      application_id: 'creator-app-other-retry',
      user_id: 'applicant-0002',
      status: 'APPROVED',
      grant_state: 'PENDING',
      version: 2,
      decided_by: 'reviewer-l7-0002',
      decision_idempotency_key: 'creator-review-original-other',
    }))
    otherReviewer.db.applications = reviewer.db.applications
    otherReviewer.db.creators = reviewer.db.creators

    const ownResponse = await worker.fetch(request('/api/v1/admin/creator-applications', 'GET'), reviewer.env)
    const otherResponse = await worker.fetch(request('/api/v1/admin/creator-applications', 'GET'), otherReviewer.env)
    const own = await responseBody(ownResponse)
    const other = await responseBody(otherResponse)

    expect(ownResponse.status).toBe(200)
    expect(own.data?.data?.map((item) => item.application_id)).toContain('creator-app-own-retry')
    expect(own.data?.data?.map((item) => item.application_id)).not.toContain('creator-app-other-retry')
    expect(other.data?.data?.map((item) => item.application_id)).toContain('creator-app-other-retry')
    expect(other.data?.data?.map((item) => item.application_id)).not.toContain('creator-app-own-retry')
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
