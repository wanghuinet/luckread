import { describe, expect, it, vi } from 'vitest'
import worker from './index.js'

const dbFor = (results: unknown[]) => {
  const prepare = vi.fn(() => ({
    bind: vi.fn(() => ({
      all: vi.fn(async () => ({ results })),
    })),
  }))
  return { prepare } as unknown as D1Database
}

const request = (pathname: string, headers: Record<string, string> = {}) =>
  new Request(`https://luckread-w05.internal${pathname}`, { headers })

const transportHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'test-correlation',
  'X-LuckRead-Principal-User-Id': 'viewer-1',
}

describe('W05 social query transport', () => {
  it('serves followers with relationship rows and total count', async () => {
    const env = {
      DB: dbFor([
        {
          relationship_id: 'r1',
          user_id: 'fan-1',
          followed_at: '2026-10-02T00:00:00.000Z',
          total_count: 1,
        },
      ]),
    }

    const response = await worker.fetch(
      request('/internal/social/users/creator-1/followers?limit=20', transportHeaders),
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [
          {
            relationshipId: 'r1',
            userId: 'fan-1',
            followedAt: '2026-10-02T00:00:00.000Z',
          },
        ],
        totalCount: 1,
        nextCursor: null,
        hasMore: false,
      },
    })
  })

  it('serves following from the same relationship authority', async () => {
    const env = {
      DB: dbFor([
        {
          relationship_id: 'r2',
          user_id: 'creator-2',
          followed_at: '2026-10-02T00:00:00.000Z',
          total_count: 1,
        },
      ]),
    }

    const response = await worker.fetch(
      request('/internal/social/users/user-1/following', transportHeaders),
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        totalCount: 1,
        items: [{ userId: 'creator-2' }],
      },
    })
  })

  it('fails closed when the W01 transport boundary is missing', async () => {
    const response = await worker.fetch(
      request('/internal/social/users/creator-1/followers'),
      { DB: dbFor([]) },
    )

    expect(response.status).toBe(403)
  })

  it('rejects non-GET query transport', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/users/creator-1/followers', {
        method: 'POST',
        headers: transportHeaders,
      }),
      { DB: dbFor([]) },
    )

    expect(response.status).toBe(405)
  })
})
