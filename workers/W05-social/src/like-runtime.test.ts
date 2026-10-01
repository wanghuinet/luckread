import { describe, expect, it } from 'vitest'
import {
  likeResource,
  unlikeResource,
  validateTrustedLikeAdmission,
  type LikeDatabase,
  type TrustedLikeAdmission,
} from './like-runtime.js'

class FakeStatement {
  private values: unknown[] = []
  constructor(private readonly db: FakeDB, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this }

  async run() {
    if (this.sql.includes('INSERT OR IGNORE')) {
      const key = String(this.values[1]) + ':' + String(this.values[2]) + ':' + String(this.values[3])
      if (this.db.rows.has(key)) return { meta: { changes: 0 } }
      this.db.rows.add(key)
      return { meta: { changes: 1 } }
    }

    if (this.sql.includes('DELETE FROM social_like_relationships')) {
      const key = String(this.values[0]) + ':' + String(this.values[1]) + ':' + String(this.values[2])
      const existed = this.db.rows.delete(key)
      return { meta: { changes: existed ? 1 : 0 } }
    }

    return { meta: { changes: 0 } }
  }
}

class FakeDB implements LikeDatabase {
  readonly rows = new Set<string>()
  prepare(sql: string) { return new FakeStatement(this, sql) }
}

const admission = (patch: Partial<TrustedLikeAdmission> = {}): TrustedLikeAdmission => ({
  caller: 'W01',
  transportVersion: '1.0',
  correlationId: 'corr-like-1',
  actorUserId: 'user-a',
  resourceType: 'content',
  resourceId: 'content-1',
  actorAccountState: 'ACTIVE',
  resourceVisible: true,
  resourceInteractable: true,
  blockPolicyAllows: true,
  mutePolicyAllows: true,
  antiAbuseAdmission: 'ALLOW',
  idempotencyKey: 'user-a:content-1:like',
  ...patch,
})

describe('SOCIAL-003 trusted like admission', () => {
  it('fails closed for untrusted caller or denied policy', () => {
    expect(() => validateTrustedLikeAdmission(
      admission({ caller: 'PUBLIC_CLIENT' }),
      'like',
    )).toThrow('UNTRUSTED_CALLER')

    expect(() => validateTrustedLikeAdmission(
      admission({ resourceInteractable: false }),
      'like',
    )).toThrow('RESOURCE_NOT_INTERACTABLE')

    expect(() => validateTrustedLikeAdmission(
      admission({ antiAbuseAdmission: 'BLOCK' }),
      'like',
    )).toThrow('ANTI_ABUSE_DENIED')
  })

  it('creates one effective like and converges duplicates', async () => {
    const db = new FakeDB()
    const first = await likeResource(db, admission())
    const second = await likeResource(db, admission())

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(db.rows.size).toBe(1)
  })

  it('makes unlike idempotently safe', async () => {
    const db = new FakeDB()
    expect((await unlikeResource(db, admission())).removed).toBe(false)
    await likeResource(db, admission())
    expect((await unlikeResource(db, admission())).removed).toBe(true)
    expect((await unlikeResource(db, admission())).removed).toBe(false)
    expect(db.rows.size).toBe(0)
  })
})
