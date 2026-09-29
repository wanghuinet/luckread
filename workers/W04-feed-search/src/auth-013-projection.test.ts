import { describe, expect, it } from 'vitest'
import { applyAccountStateProjection, parseAccountStateChanged, type ProjectionRecord } from './auth-013-projection.js'

class FakeKV {
  private readonly values = new Map<string, string>()
  async get(key: string, type?: 'json') {
    const value = this.values.get(key)
    if (value === undefined) return null
    return type === 'json' ? JSON.parse(value) as ProjectionRecord : value
  }
  async put(key: string, value: string) { this.values.set(key, value) }
  read(key: string) {
    const value = this.values.get(key)
    return value ? JSON.parse(value) as ProjectionRecord : null
  }
  size() { return this.values.size }
}

const event = (
  version: number,
  state: ProjectionRecord['accountState'],
  id = `evt_${version}`,
  resourceId = 'usr_auth013_projection_01',
) => ({
  eventId: id, eventType: 'identity.account_state_changed' as const, schemaVersion: '1.0' as const,
  producer: 'W02' as const, resourceType: 'User' as const, resourceId,
  occurredAt: '2026-09-29T04:00:00.000Z', publishedAt: '2026-09-29T04:00:01.000Z',
  correlationId: 'req_auth013_projection_01', causationId: id, idempotencyKey: id, attempt: 1,
  sourceVersion: version, actor: { actorId: 'operator_01', actorType: 'user' },
  before: { accountState: 'ACTIVE' as const, accountStateVersion: Math.max(1, version - 1) },
  after: { accountState: state, accountStateVersion: version },
  reason: 'controlled projection test',
})

const keyFor = (resourceId = 'usr_auth013_projection_01') =>
  `auth013:projection:User:${resourceId}`

describe('AUTH-013 W04 derived projection consumer', () => {
  it.each(['FROZEN', 'SUSPENDED', 'BANNED', 'DELETION_PENDING', 'DELETED'] as const)(
    'marks %s as PURGED/deindexed',
    async state => {
      const kv = new FakeKV()
      const result = await applyAccountStateProjection(
        kv,
        event(2, state),
        new Date('2026-09-29T04:00:02.000Z'),
      )
      expect(result).toBe('applied')
      expect(kv.read(keyFor())).toMatchObject({
        sourceVersion: 2,
        projectionVersion: 2,
        accountState: state,
        state: 'PURGED',
        deindex: true,
        sourceAuthority: 'D1-01',
        policyVersion: 'AUTH-013-v1',
      })
    },
  )

  it.each(['ACTIVE', 'RESTRICTED', 'RESTORED', 'REACTIVATED'] as const)(
    'keeps %s visible/active',
    async state => {
      const kv = new FakeKV()
      await applyAccountStateProjection(kv, event(2, state))
      expect(kv.read(keyFor())).toMatchObject({
        sourceVersion: 2,
        projectionVersion: 2,
        accountState: state,
        state: 'ACTIVE',
        deindex: false,
      })
    },
  )

  it('absorbs duplicate delivery and rejects older versions without rewriting state', async () => {
    const kv = new FakeKV()
    const now = new Date('2026-09-29T04:00:02.000Z')
    await applyAccountStateProjection(kv, event(3, 'SUSPENDED', 'evt_3'), now)
    const first = kv.read(keyFor())
    expect(await applyAccountStateProjection(kv, event(3, 'SUSPENDED', 'evt_3'), new Date('2026-09-29T04:01:00.000Z'))).toBe('ignored')
    expect(await applyAccountStateProjection(kv, event(2, 'ACTIVE', 'evt_2'), new Date('2026-09-29T04:02:00.000Z'))).toBe('ignored')
    expect(kv.read(keyFor())).toEqual(first)
    expect(kv.size()).toBe(1)
  })

  it('allows a newer RESTORED state to become ACTIVE', async () => {
    const kv = new FakeKV()
    await applyAccountStateProjection(kv, event(4, 'BANNED', 'evt_4'))
    expect(await applyAccountStateProjection(kv, event(5, 'RESTORED', 'evt_5'))).toBe('applied')
    expect(kv.read(keyFor())).toMatchObject({
      sourceVersion: 5,
      projectionVersion: 5,
      state: 'ACTIVE',
      deindex: false,
    })
  })

  it('rejects a malformed event whose after-version does not match sourceVersion', () => {
    const value = event(7, 'ACTIVE')
    value.after.accountStateVersion = 6
    expect(() => parseAccountStateChanged(value)).toThrow('INVALID_AUTH_013_EVENT')
  })

  it('emits only projection-safe metadata and keeps staleAfter within five minutes', async () => {
    const kv = new FakeKV()
    const now = new Date('2026-09-29T04:00:02.000Z')
    await applyAccountStateProjection(kv, event(8, 'RESTRICTED'), now)
    const record = kv.read(keyFor()) as ProjectionRecord
    expect(Date.parse(record.staleAfter) - Date.parse(record.createdAt)).toBe(5 * 60 * 1000)
    for (const forbidden of ['authorizationDecision', 'allow', 'deny', 'sessionValid', 'tokenValid']) {
      expect(record).not.toHaveProperty(forbidden)
    }
  })
})
