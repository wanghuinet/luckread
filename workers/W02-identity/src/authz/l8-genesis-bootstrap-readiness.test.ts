import { describe, expect, it } from 'vitest'
import { checkL8BootstrapReadiness, L8BootstrapReadinessError } from './l8-genesis-bootstrap-readiness.js'
import type { VerifiedL8BootstrapApproval } from './l8-genesis-bootstrap-approval.js'

const NOW = '2026-10-24T12:00:00.000Z'

type FixtureOptions = {
  user?: { accountState: string; emailVerified: number | boolean } | null
  hasL2?: boolean
  hasL8?: boolean
  consumed?: boolean
  schemaReady?: boolean
}

class ReadinessD1 {
  readonly writes = 0
  constructor(private readonly options: FixtureOptions = {}) {}

  prepare(sql: string) {
    let args: unknown[] = []
    return {
      bind: (...values: unknown[]) => { args = values; return this },
      all: async <T>() => {
        if (!this.options.schemaReady && sql.includes('twoFactor')) throw new Error('missing twoFactor')
        if (!this.options.schemaReady && sql.includes('l8_genesis_bootstrap_audit')) throw new Error('missing audit table')
        return { results: [] as T[] }
      },
      first: async <T>() => {
        if (sql.includes('FROM "user" WHERE id = ?')) {
          return (this.options.user === undefined
            ? { accountState: 'ACTIVE', emailVerified: 1 }
            : this.options.user) as T | null
        }
        if (sql.includes("role_id = 'verified_user'")) {
          return (this.options.hasL2 === false ? null : { id: 'verified-user-target-123' }) as T | null
        }
        if (sql.includes("role_id = 'super_admin'")) {
          return (this.options.hasL8 ? { id: 'existing-l8' } : null) as T | null
        }
        if (sql.includes('FROM l8_genesis_bootstrap_audit WHERE bootstrap_key')) {
          return (this.options.consumed ? { bootstrap_key: 'first-l8' } : null) as T | null
        }
        return null
      },
    }
  }
}

const approval = (): VerifiedL8BootstrapApproval => ({
  request: {
    version: 1,
    operation: 'INITIAL_L8_BOOTSTRAP',
    targetUserId: 'existing-user-123',
    roleId: 'super_admin',
    scopeType: 'global',
    scopeId: null,
    reason: 'First L8 grant under approved change-control request',
    nonce: 'c'.repeat(64),
    createdAt: '2026-10-24T11:50:00.000Z',
    expiresAt: '2026-10-24T13:00:00.000Z',
  },
  requestPrNumber: 77,
  requestHeadSha: 'a'.repeat(40),
  requestMergeSha: 'b'.repeat(40),
  approvedReviewers: ['maintainer-a', 'maintainer-b'],
  reviewerPermissions: { 'maintainer-a': 'maintain', 'maintainer-b': 'write' },
  workflowRunId: '12345678',
})

describe('read-only W02 L8 bootstrap readiness', () => {
  it('returns READY_FOR_BOOTSTRAP without changing production state', async () => {
    const db = new ReadinessD1() as unknown as D1Database
    const result = await checkL8BootstrapReadiness(db, approval(), NOW)
    expect(result).toMatchObject({
      status: 'READY_FOR_BOOTSTRAP',
      targetUserId: 'existing-user-123',
      roleId: 'super_admin',
      scopeType: 'global',
      maxGrantSeconds: 14400,
      productionMutationPerformed: false,
      approvedReviewers: ['maintainer-a', 'maintainer-b'],
    })
  })

  it('blocks when the deployed MFA/audit schema is missing', async () => {
    const db = new ReadinessD1({ schemaReady: false }) as unknown as D1Database
    await expect(checkL8BootstrapReadiness(db, approval(), NOW))
      .rejects.toMatchObject({ code: 'SCHEMA_NOT_READY' })
  })

  it('blocks inactive or unverified target accounts', async () => {
    const db = new ReadinessD1({ user: { accountState: 'PENDING_VERIFICATION', emailVerified: 0 } }) as unknown as D1Database
    await expect(checkL8BootstrapReadiness(db, approval(), NOW))
      .rejects.toMatchObject({ code: 'TARGET_NOT_ELIGIBLE' })
  })

  it('blocks when the target has no effective L2 verified_user assignment', async () => {
    const db = new ReadinessD1({ hasL2: false }) as unknown as D1Database
    await expect(checkL8BootstrapReadiness(db, approval(), NOW))
      .rejects.toMatchObject({ code: 'VERIFIED_ROLE_REQUIRED' })
  })

  it('blocks if an effective global L8 already exists', async () => {
    const db = new ReadinessD1({ hasL8: true }) as unknown as D1Database
    await expect(checkL8BootstrapReadiness(db, approval(), NOW))
      .rejects.toMatchObject({ code: 'L8_ALREADY_EXISTS' })
  })

  it('blocks after the singleton one-time audit guard is consumed', async () => {
    const db = new ReadinessD1({ consumed: true }) as unknown as D1Database
    await expect(checkL8BootstrapReadiness(db, approval(), NOW))
      .rejects.toMatchObject({ code: 'BOOTSTRAP_ALREADY_CONSUMED' })
  })

  it('blocks expired approval requests', async () => {
    const request = approval()
    request.request.expiresAt = '2026-10-24T11:59:59.000Z'
    await expect(checkL8BootstrapReadiness(new ReadinessD1() as unknown as D1Database, request, NOW))
      .rejects.toBeInstanceOf(L8BootstrapReadinessError)
  })
})
