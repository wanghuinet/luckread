/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { removeRelation, setRelation } from './block-mute-runtime.js'

const db = (firstResults: unknown[] = []) => {
  let firstIndex = 0
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      first: vi.fn(async () => firstResults[firstIndex++] ?? null),
      run: vi.fn(async () => ({ sql, args })),
    })),
  }))
  return { prepare } as unknown as D1Database
}

describe('block/mute runtime', () => {
  const activeTarget = [
    { account_state: 'ACTIVE' },
    { id: 'target-1' },
  ]

  it('creates and then converges on an existing block relation', async () => {
    const d = db([
      ...activeTarget,
      null,
      { relationship_id: 'block-1', actor_user_id: 'user-1', target_user_id: 'target-1', relation_type: 'block', created_at: '2026-10-02T00:00:00.000Z', updated_at: '2026-10-02T00:00:00.000Z' },
    ])

    await expect(setRelation(d, 'user-1', 'target-1', 'block')).resolves.toMatchObject({
      relationshipId: 'block-1',
      relationType: 'block',
    })
  })

  it('allows block and mute to coexist as independent relations', async () => {
    const d = db([
      ...activeTarget,
      null,
      { relationship_id: 'mute-1', actor_user_id: 'user-1', target_user_id: 'target-1', relation_type: 'mute', created_at: '2026-10-02T00:00:00.000Z', updated_at: '2026-10-02T00:00:00.000Z' },
    ])

    await expect(setRelation(d, 'user-1', 'target-1', 'mute')).resolves.toMatchObject({
      relationshipId: 'mute-1',
      relationType: 'mute',
    })
  })

  it('rejects self relation', async () => {
    await expect(setRelation(db(), 'user-1', 'user-1', 'block')).rejects.toMatchObject({
      code: 'INVALID_RELATIONSHIP',
      status: 409,
    })
  })

  it('rejects missing targets and inactive actors', async () => {
    await expect(setRelation(db([{ account_state: 'ACTIVE' }, null]), 'user-1', 'missing', 'mute')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    })
    await expect(setRelation(db([{ account_state: 'SUSPENDED' }]), 'user-1', 'target-1', 'block')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    })
  })

  it('removes relations idempotently', async () => {
    const d = db([{ account_state: 'ACTIVE' }])
    await expect(removeRelation(d, 'user-1', 'target-1', 'mute')).resolves.toBeUndefined()
  })
})
