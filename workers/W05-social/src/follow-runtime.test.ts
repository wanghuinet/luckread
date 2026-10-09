import { describe, expect, it, vi } from 'vitest'
import {
  follow,
  getFollowStatus,
  invalidateFollowListCountCache,
  listFollowers,
  listFollowing,
  parseFollowListLimit,
  unfollow,
} from './follow-runtime.js'

const db = (
  firstResults: unknown[] = [],
  allResults: unknown[] = [],
) => {
  let firstIndex = 0
  let allIndex = 0
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      first: vi.fn(async () => firstResults[firstIndex++] ?? null),
      all: vi.fn(async () => allResults[allIndex++] ?? { results: [] }),
      run: vi.fn(async () => ({ sql, args })),
    })),
  }))
  return { prepare } as unknown as D1Database
}

const installCache = (store = new Map<string, Response>()) => {
  const cache = {
    match: vi.fn(async (request: Request) => store.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => {
      store.set(request.url, response.clone())
    }),
    delete: vi.fn(async (request: Request) => store.delete(request.url)),
  }
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: { default: cache },
  })
  return cache
}

const uninstallCache = () => {
  Reflect.deleteProperty(globalThis, 'caches')
}

describe('follow runtime', () => {
  it('creates a relationship', async () => {
    const row = {
      relationship_id: 'r1',
      follower_user_id: 'u1',
      target_user_id: 'u2',
      created_at: '2026-10-02T00:00:00.000Z',
    }
    await expect(follow(db([{ blocked: 0 }, row]), 'u1', 'u2')).resolves.toEqual(row)
  })

  it('is idempotent', async () => {
    const row = {
      relationship_id: 'r1',
      follower_user_id: 'u1',
      target_user_id: 'u2',
      created_at: '2026-10-02T00:00:00.000Z',
    }
    const d = db([{ blocked: 0, ...row }])
    await expect(follow(d, 'u1', 'u2')).resolves.toEqual(row)
    expect(d.prepare).toHaveBeenCalledTimes(1)
  })

  it('rejects follow when either side has an active block', async () => {
    await expect(
      follow(
        db([{ blocked: 1 }]),
        'u1',
        'u2',
      ),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
  })

  it('binds the final follow write to the active block predicate', async () => {
    const d = db([{ blocked: 0 }])
    const prepare = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare
    prepare.mockImplementationOnce(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ({ blocked: 0 })),
      })),
    })).mockImplementationOnce((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => null),
      })),
    }))

    await expect(follow(d, 'u1', 'u2')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
    expect(String(prepare.mock.calls[1]?.[0])).toContain("block.relation_type = 'block'")
    expect(String(prepare.mock.calls[1]?.[0])).toContain('INSERT INTO social_follow_relationships')
    expect(String(prepare.mock.calls[1]?.[0])).toContain('NOT EXISTS')
  })

  it('rejects self follow', async () => {
    await expect(follow(db(), 'u1', 'u1')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
  })

  it('unfollows', async () => {
    await expect(unfollow(db(), 'u1', 'u2')).resolves.toBeUndefined()
  })

  it('reads status', async () => {
    await expect(
      getFollowStatus(
        db([{ relationship_id: 'r1', created_at: '2026-10-02T00:00:00.000Z' }]),
        'u1',
        'u2',
      ),
    ).resolves.toEqual({
      following: true,
      relationshipId: 'r1',
      createdAt: '2026-10-02T00:00:00.000Z',
    })
  })

  it('hides follow status when either side is blocked', async () => {
    const d = db([{
      relationship_id: 'r-blocked',
      created_at: '2026-10-02T00:00:00.000Z',
      blocked: 1,
    }])
    await expect(getFollowStatus(d, 'u1', 'u2')).resolves.toEqual({
      following: false,
      relationshipId: null,
      createdAt: null,
    })
    const sql = String((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(sql).toContain("block.relation_type = 'block'")
    expect(sql).toContain('block.actor_user_id = ? AND block.target_user_id = ?')
  })

  it('lists followers with a bounded total count and opaque next cursor', async () => {
    const d = db([{ total_count: 3 }], [{
      results: [
        {
          relationship_id: 'r2',
          user_id: 'u4',
          followed_at: '2026-10-02T00:01:00.000Z',
        },
        {
          relationship_id: 'r1',
          user_id: 'u3',
          followed_at: '2026-10-02T00:00:00.000Z',
        },
        {
          relationship_id: 'r0',
          user_id: 'u2',
          followed_at: '2026-09-30T00:00:00.000Z',
        },
      ],
    }])
    const result = await listFollowers(d, 'u9', null, 2)
    const pageQuery = String((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    const countQuery = String((d.prepare as unknown as ReturnType<typeof vi.fn>).mock.calls[1]?.[0])
    expect(pageQuery).toContain("block.relation_type = 'block'")
    expect(pageQuery).toContain('NOT EXISTS')
    expect(pageQuery).not.toContain('COUNT(*)')
    expect(countQuery).toContain('COUNT(*)')
    expect(countQuery).toContain('rel_count.')
    expect(result).toMatchObject({
      items: [
        { relationshipId: 'r2', userId: 'u4', followedAt: '2026-10-02T00:01:00.000Z' },
        { relationshipId: 'r1', userId: 'u3', followedAt: '2026-10-02T00:00:00.000Z' },
      ],
      totalCount: 3,
      hasMore: true,
    })
    expect(result.nextCursor).toEqual(expect.any(String))
  })

  it('uses a cached aggregate count without a second D1 query', async () => {
    const store = new Map<string, Response>([
      [
        'https://cache.luckread.internal/__social-follow-count?v=1&direction=followers&user=u9',
        Response.json({ totalCount: 17 }),
      ],
    ])
    const cache = installCache(store)
    try {
      const d = db([], [{
        results: [{
          relationship_id: 'r1',
          user_id: 'u8',
          followed_at: '2026-10-02T00:00:00.000Z',
        }],
      }])
      const result = await listFollowers(d, 'u9', null, 20)
      expect(result.totalCount).toBe(17)
      expect(d.prepare).toHaveBeenCalledTimes(1)
      expect(cache.match).toHaveBeenCalled()
    } finally {
      uninstallCache()
    }
  })

  it('invalidates both follow count directions for affected users', async () => {
    const cache = installCache()
    try {
      await invalidateFollowListCountCache('u1', 'u2')
      expect(cache.delete).toHaveBeenCalledTimes(4)
    } finally {
      uninstallCache()
    }
  })

  it('lists following relationships', async () => {
    const d = db([{ total_count: 1 }], [{
      results: [{
        relationship_id: 'r3',
        user_id: 'u7',
        followed_at: '2026-10-02T00:00:00.000Z',
      }],
    }])
    await expect(listFollowing(d, 'u5', null, 20)).resolves.toEqual({
      items: [{
        relationshipId: 'r3',
        userId: 'u7',
        followedAt: '2026-10-02T00:00:00.000Z',
      }],
      totalCount: 1,
      nextCursor: null,
      hasMore: false,
    })
  })

  it('rejects malformed or cross-direction cursors', async () => {
    const d = db([], [{ results: [] }])
    await expect(listFollowers(d, 'u1', '%%%INVALID%%%', 20)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
    const first = await listFollowers(db([], [{
      results: [{
        relationship_id: 'r1',
        user_id: 'u2',
        followed_at: '2026-10-02T00:00:00.000Z',
        total_count: 2,
      }, {
        relationship_id: 'r0',
        user_id: 'u3',
        followed_at: '2026-10-01T00:00:00.000Z',
        total_count: 2,
      }],
    }]), 'u1', null, 1)
    await expect(listFollowing(d, 'u1', first.nextCursor, 20)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
  })

  it('rejects follow cursors reused for another target user', async () => {
    const first = await listFollowers(db([], [{
      results: [
        { relationship_id: 'r2', user_id: 'u2', followed_at: '2026-10-02T00:01:00.000Z' },
        { relationship_id: 'r1', user_id: 'u3', followed_at: '2026-10-02T00:00:00.000Z' },
      ],
    }]), 'u1', null, 1)
    expect(first.nextCursor).toEqual(expect.any(String))
    await expect(listFollowers(db(), 'u9', first.nextCursor, 20)).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
      status: 400,
    })
  })

  it('validates list limits', () => {
    expect(parseFollowListLimit(null)).toBe(20)
    expect(parseFollowListLimit('50')).toBe(50)
    expect(() => parseFollowListLimit('0')).toThrow()
    expect(() => parseFollowListLimit('51')).toThrow()
  })

  it('rejects invalid ids', async () => {
    await expect(follow(db(), '', 'u2')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    })
  })
})
