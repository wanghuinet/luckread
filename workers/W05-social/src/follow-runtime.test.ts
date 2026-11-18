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
import { FollowStoreError, type FollowStore } from './follow-store.js'
import type { FollowListReadStore } from './follow-list-read-store.js'

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
  it('creates a relationship through the injected Store', async () => {
    const row = {
      relationship_id: 'r1',
      follower_user_id: 'u1',
      target_user_id: 'u2',
      created_at: '2026-10-02T00:00:00.000Z',
    }
    const store: FollowStore = {
      follow: vi.fn(async () => row),
      unfollow: vi.fn(async () => {}),
    }
    await expect(follow(store, 'u1', 'u2')).resolves.toEqual(row)
    expect(store.follow).toHaveBeenCalledWith(expect.objectContaining({
      followerUserId: 'u1',
      targetUserId: 'u2',
    }))
  })

  it('accepts an injected provider-neutral follow store', async () => {
    const row = {
      relationship_id: 'pg_r1',
      follower_user_id: 'u1',
      target_user_id: 'u2',
      created_at: '2026-11-10T00:00:00.000Z',
    }
    const store = {
      follow: vi.fn(async () => row),
      unfollow: vi.fn(async () => {}),
    }
    await expect(follow(store, 'u1', 'u2')).resolves.toEqual(row)
    expect(store.follow).toHaveBeenCalledWith(expect.objectContaining({
      followerUserId: 'u1',
      targetUserId: 'u2',
      relationshipId: expect.any(String),
      createdAt: expect.any(String),
    }))
  })

  it('maps provider storage failures to a sanitized service-unavailable error', async () => {
    const store = {
      follow: vi.fn(async () => { throw new FollowStoreError() }),
      unfollow: vi.fn(async () => { throw new FollowStoreError() }),
    }
    await expect(follow(store, 'u1', 'u2')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    })
    await expect(unfollow(store, 'u1', 'u2')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    })
  })

  it('returns the existing relationship unchanged for an idempotent Store result', async () => {
    const row = {
      relationship_id: 'existing-r1',
      follower_user_id: 'u1',
      target_user_id: 'u2',
      created_at: '2026-10-02T00:00:00.000Z',
    }
    const store: FollowStore = {
      follow: vi.fn(async () => row),
      unfollow: vi.fn(async () => {}),
    }
    await expect(follow(store, 'u1', 'u2')).resolves.toEqual(row)
    expect(store.follow).toHaveBeenCalledTimes(1)
  })

  it('rejects follow when the Store reports an active Block', async () => {
    const store: FollowStore = {
      follow: vi.fn(async () => null),
      unfollow: vi.fn(async () => {}),
    }
    await expect(follow(store, 'u1', 'u2')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
  })

  it('rejects self follow before calling the Store', async () => {
    const store: FollowStore = {
      follow: vi.fn(async () => null),
      unfollow: vi.fn(async () => {}),
    }
    await expect(follow(store, 'u1', 'u1')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
    expect(store.follow).not.toHaveBeenCalled()
  })

  it('unfollows through the injected Store', async () => {
    const store: FollowStore = {
      follow: vi.fn(async () => null),
      unfollow: vi.fn(async () => {}),
    }
    await expect(unfollow(store, 'u1', 'u2')).resolves.toBeUndefined()
    expect(store.unfollow).toHaveBeenCalledWith('u1', 'u2')
  })

  it('reads status', async () => {
    await expect(
      getFollowStatus(
        db([{ relationship_id: 'r1', created_at: '2026-10-02T00:00:00.000Z', blocked: 0 }]),
        'u1',
        'u2',
      ),
    ).resolves.toEqual({
      following: true,
      relationshipId: 'r1',
      createdAt: '2026-10-02T00:00:00.000Z',
    })
  })

  it('accepts an injected provider-neutral follow-status read store', async () => {
    const store = {
      getStatus: vi.fn(async () => ({
        relationship_id: 'pg-r1',
        created_at: '2026-11-10T00:00:00.000Z',
        blocked: false,
      })),
    }
    await expect(getFollowStatus(store, 'u1', 'u2')).resolves.toEqual({
      following: true,
      relationshipId: 'pg-r1',
      createdAt: '2026-11-10T00:00:00.000Z',
    })
    expect(store.getStatus).toHaveBeenCalledWith({
      followerUserId: 'u1',
      targetUserId: 'u2',
    })
  })

  it('maps injected follow-status storage failures to a sanitized service-unavailable error', async () => {
    const store = {
      getStatus: vi.fn(async () => { throw new FollowStoreError() }),
    }
    await expect(getFollowStatus(store, 'u1', 'u2')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
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

  it('lists followers through the injected Store with a bounded count and opaque next cursor', async () => {
    const store: FollowListReadStore = {
      list: vi.fn(async () => [
        { relationship_id: 'r2', user_id: 'u4', followed_at: '2026-10-02T00:01:00.000Z', cursor_created_at: '2026-10-02T00:01:00.000000Z' },
        { relationship_id: 'r1', user_id: 'u3', followed_at: '2026-10-02T00:00:00.000Z', cursor_created_at: '2026-10-02T00:00:00.000000Z' },
        { relationship_id: 'r0', user_id: 'u2', followed_at: '2026-09-30T00:00:00.000Z', cursor_created_at: '2026-09-30T00:00:00.000000Z' },
      ]),
      count: vi.fn(async () => 3),
    }
    const result = await listFollowers(store, 'u9', null, 2)
    expect(store.list).toHaveBeenCalledWith({
      userId: 'u9', direction: 'followers', cursor: null, limit: 2,
    })
    expect(store.count).toHaveBeenCalledWith({ userId: 'u9', direction: 'followers' })
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

  it('uses a cached aggregate count without calling the Store count method', async () => {
    const cached = new Map<string, Response>([
      [
        'https://cache.luckread.internal/__social-follow-count?v=1&direction=followers&user=u9',
        Response.json({ totalCount: 17 }),
      ],
    ])
    const cache = installCache(cached)
    try {
      const store: FollowListReadStore = {
        list: vi.fn(async () => [{
          relationship_id: 'r1', user_id: 'u8', followed_at: '2026-10-02T00:00:00.000Z',
        }]),
        count: vi.fn(async () => 99),
      }
      const result = await listFollowers(store, 'u9', null, 20)
      expect(result.totalCount).toBe(17)
      expect(store.list).toHaveBeenCalledTimes(1)
      expect(store.count).not.toHaveBeenCalled()
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

  it('lists following relationships through the injected Store', async () => {
    const store: FollowListReadStore = {
      list: vi.fn(async () => [{
        relationship_id: 'r3',
        user_id: 'u7',
        followed_at: '2026-10-02T00:00:00.000Z',
      }]),
      count: vi.fn(async () => 1),
    }
    await expect(listFollowing(store, 'u5', null, 20)).resolves.toEqual({
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
