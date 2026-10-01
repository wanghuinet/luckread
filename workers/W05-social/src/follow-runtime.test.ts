import { describe, expect, it } from 'vitest'
import { followUser, validateTrustedFollowAdmission, unfollowUser, type FollowDatabase, type TrustedFollowAdmission } from './follow-runtime.js'
class FakeStatement {
  private values: unknown[] = []
  constructor(private readonly db: FakeDB, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this }
  async run() {
    if (this.sql.includes('INSERT OR IGNORE')) {
      const key = String(this.values[1]) + ':' + String(this.values[2])
      if (this.db.rows.has(key)) return { meta: { changes: 0 } }
      this.db.rows.set(key, { relationshipId: String(this.values[0]) })
      return { meta: { changes: 1 } }
    }
    if (this.sql.includes('DELETE FROM social_follow_relationships')) {
      const key = String(this.values[0]) + ':' + String(this.values[1])
      const existed = this.db.rows.delete(key)
      return { meta: { changes: existed ? 1 : 0 } }
    }
    return { meta: { changes: 0 } }
  }
  async first<T>() {
    const key = String(this.values[0]) + ':' + String(this.values[1])
    return (this.db.rows.get(key) ?? null) as T | null
  }
}
class FakeDB implements FollowDatabase {
  readonly rows = new Map<string, { relationshipId: string }>()
  prepare(sql: string) { return new FakeStatement(this, sql) as never }
}
const admission = (patch: Partial<TrustedFollowAdmission> = {}): TrustedFollowAdmission => ({
  caller: 'W01', transportVersion: '1.0', correlationId: 'corr-1',
  actorUserId: 'user-a', targetUserId: 'user-b', actorAccountState: 'ACTIVE',
  targetFollowability: true, blockPolicyAllows: true, privacyScopeAllows: true,
  antiAbuseAdmission: 'ALLOW', idempotencyKey: 'user-a:user-b:follow', ...patch,
})
describe('SOCIAL-001 trusted follow admission', () => {
  it('fails closed for untrusted caller and denied policy', () => {
    expect(() => validateTrustedFollowAdmission(admission({ caller: 'PUBLIC_CLIENT' }), 'follow')).toThrow('UNTRUSTED_CALLER')
    expect(() => validateTrustedFollowAdmission(admission({ antiAbuseAdmission: 'BLOCK' }), 'follow')).toThrow('ANTI_ABUSE_DENIED')
    expect(() => validateTrustedFollowAdmission(admission({ privacyScopeAllows: false }), 'follow')).toThrow('PRIVACY_SCOPE_DENIED')
  })
  it('creates one relation and converges duplicate follow', async () => {
    const db = new FakeDB()
    const first = await followUser(db, admission())
    const second = await followUser(db, admission())
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.relationshipId).toBe(first.relationshipId)
    expect(db.rows.size).toBe(1)
  })
  it('makes missing unfollow idempotently safe', async () => {
    const db = new FakeDB()
    expect((await unfollowUser(db, admission())).removed).toBe(false)
    await followUser(db, admission())
    expect((await unfollowUser(db, admission())).removed).toBe(true)
    expect((await unfollowUser(db, admission())).removed).toBe(false)
    expect(db.rows.size).toBe(0)
  })
  it('rejects self follow', async () => {
    await expect(followUser(new FakeDB(), admission({ targetUserId: 'user-a' }))).rejects.toThrow('SELF_FOLLOW_DENIED')
  })
})
