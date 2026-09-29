import { describe, expect, it } from 'vitest'
import { applyAccountStateProjection, type ProjectionRecord } from './auth-013-projection.js'

class FakeKV {
  private readonly values = new Map<string, string>()
  async get(key: string, type?: 'json') {
    const value = this.values.get(key)
    if (value === undefined) return null
    return type === 'json' ? JSON.parse(value) as ProjectionRecord : value
  }
  async put(key: string, value: string) { this.values.set(key, value) }
  read(key: string) { const value = this.values.get(key); return value ? JSON.parse(value) as ProjectionRecord : null }
}

const event = (version: number, state: ProjectionRecord['accountState'], id: string) => ({
  eventId: id, eventType: 'identity.account_state_changed' as const, schemaVersion: '1.0' as const,
  producer: 'W02' as const, resourceType: 'User' as const, resourceId: 'usr_auth013_projection_01',
  occurredAt: '2026-09-29T04:00:00.000Z', publishedAt: '2026-09-29T04:00:01.000Z',
  correlationId: 'req_auth013_projection_01', causationId: id, idempotencyKey: id, attempt: 1,
  sourceVersion: version, actor: { actorId: 'operator_01', actorType: 'user' },
  before: { accountState: 'ACTIVE' as const, accountStateVersion: Math.max(1, version - 1) },
  after: { accountState: state, accountStateVersion: version },
  reason: 'controlled projection test',
})

describe('AUTH-013 W04 derived projection consumer', () => {
  it('applies a new version and marks deindex states PURGED', async () => {
    const kv = new FakeKV()
    expect(await applyAccountStateProjection(kv, event(2, 'FROZEN', 'evt_2'), new Date('2026-09-29T04:00:02.000Z'))).toBe('applied')
    expect(kv.read('auth013:projection:User:usr_auth013_projection_01')).toMatchObject({ sourceVersion: 2, state: 'PURGED', deindex: true })
  })
  it('absorbs duplicate delivery and rejects older versions', async () => {
    const kv = new FakeKV()
    await applyAccountStateProjection(kv, event(3, 'SUSPENDED', 'evt_3'))
    expect(await applyAccountStateProjection(kv, event(3, 'SUSPENDED', 'evt_3'))).toBe('ignored')
    expect(await applyAccountStateProjection(kv, event(2, 'ACTIVE', 'evt_2'))).toBe('ignored')
    expect(kv.read('auth013:projection:User:usr_auth013_projection_01')?.sourceVersion).toBe(3)
  })
  it('allows a newer RESTORED state to become ACTIVE', async () => {
    const kv = new FakeKV()
    await applyAccountStateProjection(kv, event(4, 'BANNED', 'evt_4'))
    expect(await applyAccountStateProjection(kv, event(5, 'RESTORED', 'evt_5'))).toBe('applied')
    expect(kv.read('auth013:projection:User:usr_auth013_projection_01')).toMatchObject({ sourceVersion: 5, state: 'ACTIVE', deindex: false })
  })
})
