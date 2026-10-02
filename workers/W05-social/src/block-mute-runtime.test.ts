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
  it('creates and converges through a single authoritative upsert', async () => {
    const d = db([{
      relationship_id: 'block-1',
      actor_user_id: 'user-1',
      target_user_id: 'target-1',
      relation_type: 'block',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    }])

    await expect(setRelation(d, 'user-1', 'target-1', 'block')).resolves.toMatchObject({
      relationshipId: 'block-1',
      relationType: 'block',
    })
    expect(d.prepare).toHaveBeenCalledTimes(1)
    expect(d.prepare.mock.calls[0][0]).toContain(
      'ON CONFLICT(actor_user_id, target_user_id, relation_type)',
    )
  })

  it('keeps block and mute independent', async () => {
    const d = db([{
      relationship_id: 'mute-1',
      actor_user_id: 'user-1',
      target_user_id: 'target-1',
      relation_type: 'mute',
      created_at: '2026-10-02T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
    }])

    await expect(setRelation(d, 'user-1', 'target-1', 'mute')).resolves.toMatchObject({
      relationshipId: 'mute-1',
      relationType: 'mute',
    })
  })

  it('rejects self relation and malformed ids before D1 access', async () => {
    const d = db()
    await expect(setRelation(d, 'user-1', 'user-1', 'block')).rejects.toMatchObject({
      code: 'INVALID_RELATIONSHIP',
      status: 409,
    })
    await expect(setRelation(d, 'bad id', 'target-1', 'block')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    })
    expect(d.prepare).not.toHaveBeenCalled()
  })

  it('removes relations idempotently with one D1 delete', async () => {
    const d = db()
    await expect(removeRelation(d, 'user-1', 'target-1', 'mute')).resolves.toBeUndefined()
    expect(d.prepare).toHaveBeenCalledTimes(1)
    expect(d.prepare.mock.calls[0][0]).toContain('DELETE FROM social_user_interactions')
  })
})
