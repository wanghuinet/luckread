/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { listRelations, removeRelation, setRelation } from './block-mute-runtime.js'

const db = (firstResults: unknown[] = [], allResults: unknown[] = []) => {
  let firstIndex = 0
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      first: vi.fn(async () => firstResults[firstIndex++] ?? null),
      all: vi.fn(async () => ({ results: allResults })),
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
      code: 'INVALID_STATE',
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
  })
})


describe('block/mute relation lists', () => {
  it('returns a bounded page and a cursor scoped to the actor and relation type', async () => {
    const d = db([], [
      { relationship_id: 'block-2', target_user_id: 'target-2', created_at: '2026-10-18T00:00:00.000Z' },
      { relationship_id: 'block-1', target_user_id: 'target-1', created_at: '2026-10-17T00:00:00.000Z' },
    ])

    const page = await listRelations(d, 'viewer-1', 'block', null, 1)
    expect(page).toMatchObject({
      items: [{ relationshipId: 'block-2', targetUserId: 'target-2', createdAt: '2026-10-18T00:00:00.000Z' }],
      hasMore: true,
      nextCursor: expect.any(String),
    })
    expect(d.prepare).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC, relationship_id DESC'))
  })

  it('rejects cursors for another actor before querying D1', async () => {
    const d = db()
    const cursor = btoa(JSON.stringify({
      version: 1,
      actorUserId: 'someone-else',
      relationType: 'block',
      createdAt: '2026-10-17T00:00:00.000Z',
      relationshipId: 'block-1',
    })).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '')

    await expect(listRelations(d, 'viewer-1', 'block', cursor, 20)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
    expect(d.prepare).not.toHaveBeenCalled()
  })
})
