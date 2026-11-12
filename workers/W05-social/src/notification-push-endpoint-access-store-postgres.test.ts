import { describe, expect, it, vi } from 'vitest'
import { NotificationPushEndpointAccessStoreError } from './notification-push-endpoint-access-store.js'
import {
  createPostgresNotificationPushEndpointAccessStore,
  type NotificationPushEndpointAccessPostgresExecutor,
} from './notification-push-endpoint-access-store-postgres.js'

describe('W05 delegated W09 PostgreSQL push endpoint access store', () => {
  it('lists only the recipient own active Expo endpoints and caps the result at 20', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({
      rows: [{ endpoint_id: 'endpoint-1', owner_user_id: 'recipient-1', push_token: 'ExponentPushToken[fixture-token-123456789]' }],
    }))
    const store = createPostgresNotificationPushEndpointAccessStore({
      query,
    } as unknown as NotificationPushEndpointAccessPostgresExecutor)

    await expect(store.listActiveForRecipient('recipient-1', 50)).resolves.toHaveLength(1)
    expect(query).toHaveBeenCalledTimes(1)
    const [sql, values] = query.mock.calls[0]!
    expect(sql).toContain("owner_user_id = $1")
    expect(sql).toContain("provider = 'expo'")
    expect(sql).toContain("permission_status = 'granted'")
    expect(sql).toContain('push_token IS NOT NULL')
    expect(sql).toContain('ORDER BY updated_at DESC')
    expect(sql).toContain('LIMIT $2')
    expect(values).toEqual(['recipient-1', 20])
  })

  it('looks up one endpoint only when both endpoint and owner IDs match', async () => {
    const query = vi.fn(async () => ({
      rows: [{
        endpoint_id: 'endpoint-1',
        owner_user_id: 'recipient-1',
        push_token: 'ExponentPushToken[fixture-token-123456789]',
        permission_status: 'granted',
      }],
    }))
    const store = createPostgresNotificationPushEndpointAccessStore({
      query,
    } as unknown as NotificationPushEndpointAccessPostgresExecutor)

    await expect(store.findEndpointForOwner('endpoint-1', 'recipient-1')).resolves.toMatchObject({
      endpoint_id: 'endpoint-1',
      owner_user_id: 'recipient-1',
      permission_status: 'granted',
    })
    const [sql, values] = query.mock.calls[0]!
    expect(sql).toContain('endpoint_id = $1')
    expect(sql).toContain('owner_user_id = $2')
    expect(sql).toContain("provider = 'expo'")
    expect(sql).toContain('LIMIT 1')
    expect(values).toEqual(['endpoint-1', 'recipient-1'])
  })

  it('clears only the exact still-current token with owner and provider predicates', async () => {
    const query = vi.fn(async () => ({ rows: [{ endpoint_id: 'endpoint-1' }] }))
    const store = createPostgresNotificationPushEndpointAccessStore({
      query,
    } as unknown as NotificationPushEndpointAccessPostgresExecutor)

    await expect(store.clearTokenIfMatches({
      endpointId: 'endpoint-1',
      ownerUserId: 'recipient-1',
      expectedPushToken: 'ExponentPushToken[current-token-123456789]',
      now: '2026-11-12T12:00:00.000Z',
    })).resolves.toBe(true)

    const [sql, values] = query.mock.calls[0]!
    expect(sql).toContain("SET permission_status = 'undetermined'")
    expect(sql).toContain('push_token = NULL')
    expect(sql).toContain('endpoint_id = $2')
    expect(sql).toContain('owner_user_id = $3')
    expect(sql).toContain("provider = 'expo'")
    expect(sql).toContain("permission_status = 'granted'")
    expect(sql).toContain('push_token = $4')
    expect(sql).toContain('RETURNING endpoint_id')
    expect(sql).not.toContain('last_seen_at')
    expect(values).toEqual([
      '2026-11-12T12:00:00.000Z',
      'endpoint-1',
      'recipient-1',
      'ExponentPushToken[current-token-123456789]',
    ])
  })

  it('returns false when the endpoint/token compare-and-set no longer matches', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const store = createPostgresNotificationPushEndpointAccessStore({
      query,
    } as unknown as NotificationPushEndpointAccessPostgresExecutor)

    await expect(store.clearTokenIfMatches({
      endpointId: 'endpoint-1',
      ownerUserId: 'recipient-1',
      expectedPushToken: 'ExponentPushToken[rotated-token-123456789]',
      now: '2026-11-12T12:00:00.000Z',
    })).resolves.toBe(false)
  })

  it('maps provider failures to a sanitized 503', async () => {
    const store = createPostgresNotificationPushEndpointAccessStore({
      async query() {
        throw new Error('secret-endpoint-provider-host-token')
      },
    } as unknown as NotificationPushEndpointAccessPostgresExecutor)

    await expect(store.listActiveForRecipient('recipient-1', 20))
      .rejects.toBeInstanceOf(NotificationPushEndpointAccessStoreError)
    await expect(store.findEndpointForOwner('endpoint-1', 'recipient-1'))
      .rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
        message: 'NOTIFICATION_PUSH_ENDPOINT_ACCESS_UNAVAILABLE',
      })
  })
})
