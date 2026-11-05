/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'

import worker from './index.js'

const transportHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'notification-preferences-test',
  'X-LuckRead-Principal-User-Id': 'viewer-1',
  'X-LuckRead-Principal-Layer': 'L2',
}

const requestFor = (method: 'GET' | 'PATCH', body?: unknown, headers: Record<string, string> = {}) =>
  new Request('https://luckread-w05.internal/internal/social/notification-preferences', {
    method,
    headers: {
      ...transportHeaders,
      ...(method === 'PATCH' ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(method === 'PATCH' ? { body: JSON.stringify(body) } : {}),
  })

function dbFor(first: (sql: string, values: unknown[]) => unknown | Promise<unknown>) {
  const statements: Array<{ sql: string; values: unknown[] }> = []
  const prepare = vi.fn((sql: string) => ({
    bind: (...values: unknown[]) => ({
      first: async () => {
        statements.push({ sql, values })
        return first(sql, values)
      },
    }),
  }))
  return {
    db: { prepare } as unknown as D1Database,
    prepare,
    statements,
  }
}

describe('W05 notification preferences runtime', () => {
  it('returns default-on preferences scoped to the authenticated W01 principal', async () => {
    const { db, statements } = dbFor(async () => null)
    const response = await worker.fetch(requestFor('GET'), { DB: db })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { follow: true, like: true, comment: true, mention: true },
    })
    expect(statements).toHaveLength(1)
    expect(statements[0]?.sql).toContain('FROM social_notification_preferences WHERE user_id = ?')
    expect(statements[0]?.values).toEqual(['viewer-1'])
  })

  it('persists a partial PATCH atomically and returns the canonical four-field state', async () => {
    const { db, statements } = dbFor(async () => ({
      follow_enabled: 1,
      like_enabled: 0,
      comment_enabled: 1,
      mention_enabled: 1,
    }))
    const response = await worker.fetch(requestFor('PATCH', { like: false }), { DB: db })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { follow: true, like: false, comment: true, mention: true },
    })
    expect(statements).toHaveLength(1)
    expect(statements[0]?.sql).toContain('ON CONFLICT(user_id) DO UPDATE')
    expect(statements[0]?.sql).toContain('COALESCE(?, social_notification_preferences.follow_enabled)')
    expect(statements[0]?.sql).toContain('RETURNING follow_enabled, like_enabled, comment_enabled, mention_enabled')
    expect(statements[0]?.values).toEqual(['viewer-1', null, 0, null, null, null, 0, null, null])
  })

  it('rejects empty, unknown, or non-boolean fields before touching D1', async () => {
    const prepare = vi.fn()
    const db = { prepare } as unknown as D1Database
    for (const body of [{}, { follow: true, ownerUserId: 'attacker' }, { like: 'false' }]) {
      const response = await worker.fetch(requestFor('PATCH', body), { DB: db })
      expect(response.status).toBe(422)
    }
    expect(prepare).not.toHaveBeenCalled()
  })

  it('rejects an L1 principal before reading or writing D1', async () => {
    const prepare = vi.fn()
    const db = { prepare } as unknown as D1Database
    const response = await worker.fetch(requestFor('GET', undefined, {
      'X-LuckRead-Principal-Layer': 'L1',
    }), { DB: db })
    expect(response.status).toBe(403)
    expect(prepare).not.toHaveBeenCalled()
  })
})
