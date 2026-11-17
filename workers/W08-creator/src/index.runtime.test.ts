import { beforeEach, describe, expect, it } from 'vitest'
import { createW08CreatorWorker } from './worker.js'
import type {
  CompleteCreatorGrantInput,
  CreateCreatorApplicationInput,
  CreatorApplicationOwnRow,
  CreatorApplicationReplayRow,
  CreatorApplicationReviewRow,
  CreatorApplicationRow,
  CreatorIdentityRow,
  DecideCreatorApplicationInput,
  W08CreatorStore,
} from './creator-store.js'

const worker = createW08CreatorWorker({
  getCreatorStore: (env) => (env as unknown as { CREATOR_STORE: W08CreatorStore }).CREATOR_STORE,
})

type TestPrincipal = {
  active: boolean
  userId: string
  email: string
  accountState: 'ACTIVE'
  layer: string
}

type TestApplication = CreatorApplicationRow

class MemoryW08CreatorStore implements W08CreatorStore {
  applications = new Map<string, TestApplication>()
  creators = new Map<string, {
    creator_id: string
    application_id: string
    status: 'PENDING_ROLE_GRANT' | 'ACTIVE'
    version: number
    updated_at: string
  }>()
  reads: string[] = []
  writes: string[] = []

  async findApplicationByIdempotency(userId: string, idempotencyKey: string): Promise<CreatorApplicationReplayRow | null> {
    this.reads.push('findApplicationByIdempotency')
    const row = [...this.applications.values()].find((item) =>
      item.user_id === userId && item.application_idempotency_key === idempotencyKey)
    if (!row) return null
    return {
      application_id: row.application_id,
      user_id: row.user_id,
      creator_type: row.creator_type,
      statement: row.statement,
      status: row.status,
      grant_state: row.grant_state,
      version: row.version,
      created_at: row.created_at,
    }
  }

  async findCreatorByUser(userId: string): Promise<CreatorIdentityRow | null> {
    this.reads.push('findCreatorByUser')
    const row = this.creators.get(userId)
    return row ? {
      creator_id: row.creator_id,
      application_id: row.application_id,
      status: row.status,
    } : null
  }

  async findPendingApplicationByUser(userId: string): Promise<{ application_id: string } | null> {
    this.reads.push('findPendingApplicationByUser')
    const row = [...this.applications.values()].find((item) =>
      item.user_id === userId && item.status === 'PENDING')
    return row ? { application_id: row.application_id } : null
  }

  async createApplication(input: CreateCreatorApplicationInput): Promise<void> {
    this.writes.push('createApplication')
    this.applications.set(input.applicationId, {
      application_id: input.applicationId,
      user_id: input.userId,
      creator_type: input.creatorType,
      statement: input.statement,
      status: 'PENDING',
      grant_state: 'NOT_REQUESTED',
      version: 1,
      application_idempotency_key: input.idempotencyKey,
      decision_idempotency_key: null,
      decided_by: null,
      decision_reason: null,
      created_at: input.now,
      updated_at: input.now,
      decided_at: null,
    })
  }

  async findOwnApplication(userId: string): Promise<CreatorApplicationOwnRow | null> {
    this.reads.push('findOwnApplication')
    const row = [...this.applications.values()]
      .filter((item) => item.user_id === userId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))[0]
    if (!row) return null
    return {
      application_id: row.application_id,
      creator_type: row.creator_type,
      statement: row.statement,
      status: row.status,
      grant_state: row.grant_state,
      version: row.version,
      created_at: row.created_at,
      updated_at: row.updated_at,
      decided_at: row.decided_at,
      decision_reason: row.decision_reason,
    }
  }

  async listReviewableApplications(reviewerId: string, limit: number): Promise<CreatorApplicationReviewRow[]> {
    this.reads.push('listReviewableApplications')
    return [...this.applications.values()]
      .filter((item) => item.status === 'PENDING' ||
        (item.status === 'APPROVED' && item.grant_state === 'PENDING' && item.decided_by === reviewerId))
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .slice(0, limit)
      .map((row) => ({
        application_id: row.application_id,
        user_id: row.user_id,
        creator_type: row.creator_type,
        statement: row.statement,
        status: row.status,
        grant_state: row.grant_state,
        version: row.version,
        created_at: row.created_at,
      }))
  }

  async readApplication(applicationId: string): Promise<CreatorApplicationRow | null> {
    this.reads.push('readApplication')
    return this.applications.get(applicationId) ?? null
  }

  async approveApplication(input: DecideCreatorApplicationInput): Promise<boolean> {
    this.writes.push('approveApplication')
    const row = this.applications.get(input.applicationId)
    if (!row || row.status !== 'PENDING' || row.version !== input.expectedVersion) return false
    Object.assign(row, {
      status: 'APPROVED',
      grant_state: 'PENDING',
      version: row.version + 1,
      decision_idempotency_key: input.idempotencyKey,
      decided_by: input.actorId,
      decision_reason: input.reason,
      decided_at: input.now,
      updated_at: input.now,
    })
    if (!this.creators.has(row.user_id)) {
      this.creators.set(row.user_id, {
        creator_id: 'creator-' + row.application_id,
        application_id: row.application_id,
        status: 'PENDING_ROLE_GRANT',
        version: 1,
        updated_at: input.now,
      })
    }
    return true
  }

  async rejectApplication(input: DecideCreatorApplicationInput): Promise<boolean> {
    this.writes.push('rejectApplication')
    const row = this.applications.get(input.applicationId)
    if (!row || row.status !== 'PENDING' || row.version !== input.expectedVersion) return false
    Object.assign(row, {
      status: 'REJECTED',
      grant_state: 'NOT_REQUESTED',
      version: row.version + 1,
      decision_idempotency_key: input.idempotencyKey,
      decided_by: input.actorId,
      decision_reason: input.reason,
      decided_at: input.now,
      updated_at: input.now,
    })
    return true
  }

  async completeCreatorGrant(input: CompleteCreatorGrantInput): Promise<void> {
    this.writes.push('completeCreatorGrant')
    const application = this.applications.get(input.applicationId)
    if (application && application.status === 'APPROVED' && application.grant_state === 'PENDING') {
      application.grant_state = 'GRANTED'
      application.version += 1
      application.updated_at = input.now
    }
    const creator = [...this.creators.values()].find((item) => item.application_id === input.applicationId)
    if (creator && creator.status === 'PENDING_ROLE_GRANT') {
      creator.status = 'ACTIVE'
      creator.version += 1
      creator.updated_at = input.now
    }
  }

  async findActiveCreator(userId: string): Promise<{ creator_id: string } | null> {
    this.reads.push('findActiveCreator')
    const row = this.creators.get(userId)
    return row?.status === 'ACTIVE' ? { creator_id: row.creator_id } : null
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

function harness(current: TestPrincipal | null, allowRoleGrant = false, sharedDb?: MemoryW08CreatorStore) {
  const db = sharedDb ?? new MemoryW08CreatorStore()
  const roleGrants: Array<Record<string, unknown>> = []
  const principalAuthorizations: Array<string | null> = []
  const roleGrantAuthorizations: Array<string | null> = []
  const auth = {
    async fetch(incoming: Request): Promise<Response> {
      const path = new URL(incoming.url).pathname
      if (path === '/internal/auth/principal') {
        principalAuthorizations.push(incoming.headers.get('authorization'))
        return current
          ? Response.json(current)
          : Response.json({ active: false }, { status: 401 })
      }
      if (path === '/internal/authz/role-assignment' && allowRoleGrant) {
        roleGrantAuthorizations.push(incoming.headers.get('authorization'))
        roleGrants.push(await incoming.json() as Record<string, unknown>)
        return Response.json({ assignmentId: 'role-assignment-test-0001', replayed: false })
      }
      // Tests must not accidentally promote an identity unless a test opts into it.
      throw new Error('Unexpected W02 role-assignment call in guard-path test')
    },
  }
  const env = {
    CREATOR_STORE: db,
    W02_AUTH: auth as unknown as Fetcher,
  } as Parameters<typeof worker.fetch>[1]
  return { db, env, roleGrants, principalAuthorizations, roleGrantAuthorizations }
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
  it('forwards native Bearer sessions to W02 when submitting a creator application', async () => {
    const setup = harness(principal('applicant-bearer-0001', 'L2'))
    const response = await worker.fetch(request('/api/v1/creator-applications', 'POST', {
      creatorType: 'WRITER',
      statement: 'Bearer session application.',
    }, {
      'Idempotency-Key': 'creator-apply-bearer-0001',
      Authorization: 'Bearer native-session-token',
    }), setup.env)

    expect(response.status).toBe(201)
    expect(setup.principalAuthorizations).toEqual(['Bearer native-session-token'])
  })

  it('routes the internal CASL endpoint and rejects a forged subject before any Store access', async () => {
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
    expect(setup.db.reads).toHaveLength(0)
    expect(setup.db.writes).toBe(0)
  })

  let db: MemoryW08CreatorStore
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
    expect(setup.db.writes).toBe(0)
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
    expect(setup.db.reads).toHaveLength(0)
    expect(setup.db.writes).toBe(0)
  })

  it('rejects missing identity and fails closed before any Store work', async () => {
    const setup = harness(null)
    const response = await worker.fetch(request('/api/v1/creator-applications/me', 'GET'), setup.env)

    expect(response.status).toBe(401)
    expect((await responseBody(response)).data?.error?.code).toBe('UNAUTHENTICATED')
    expect(setup.db.reads).toHaveLength(0)
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
    expect(db.writes).toBe(1)
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
    expect(selfHarness.db.writes).toBe(0)

    const staleHarness = harness(principal('reviewer-l7-0002', 'L7'))
    staleHarness.db.applications.set('creator-app-0001', existingApplication())
    const staleResponse = await worker.fetch(request('/api/v1/admin/creator-applications/decision', 'POST', {
      applicationId: 'creator-app-0001', decision: 'APPROVED', reason: '',
    }, { 'Idempotency-Key': 'creator-review-stale-0001', 'If-Match': '"9"' }), staleHarness.env)
    expect(staleResponse.status).toBe(412)
    expect((await responseBody(staleResponse)).data?.error?.code).toBe('PRECONDITION_FAILED')
    expect(staleHarness.db.writes).toBe(0)
  })

  it('closes the applicant-to-review-to-W02-grant lifecycle against one shared Store state', async () => {
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
    }, {
      'Idempotency-Key': 'creator-lifecycle-review-0001',
      'If-Match': '"1"',
      Authorization: 'Bearer reviewer-native-session-token',
    }), reviewer.env)
    const decision = await responseBody(decisionResponse)

    expect(decisionResponse.status).toBe(200)
    expect(decision.data).toMatchObject({ status: 'APPROVED', grantState: 'GRANTED', version: 3 })
    expect(reviewer.principalAuthorizations).toEqual(['Bearer reviewer-native-session-token'])
    expect(reviewer.roleGrantAuthorizations).toEqual(['Bearer reviewer-native-session-token'])
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
    expect(setup.db.writes).toBe(0)
  })
})
