import { describe, expect, it, vi } from 'vitest'
import type { PushEndpointPostgresExecutor } from './push-endpoint-runtime.js'
import { deletePushEndpoint, upsertPushEndpoint } from './push-endpoint-runtime.js'

const installationId = '6b6d9f5a-4e61-4c50-9d17-9e97f36e6e3c'
const pushToken = 'ExponentPushToken[abcdefghijklmnop_1234567890]'

const makeDatabase = (
  rows: Array<Record<string, unknown>> = [],
  failure?: Error,
) => {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values })
    if (failure) throw failure
    return { rows }
  })
  return {
    database: { query } as unknown as PushEndpointPostgresExecutor,
    query,
    calls,
  }
}

describe('W05 notification push endpoint runtime — Neon D1-03 only', () => {
  it('upserts one Expo endpoint using the authenticated owner and never returns the token', async () => {
    const { database, calls } = makeDatabase([{ endpoint_id: 'endpoint-1', permission_status: 'granted' }])

    const result = await upsertPushEndpoint(database, 'identity-user-1', installationId, {
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: pushToken,
      appVersion: '1.0.0',
    })

    expect(result).toEqual({ endpointId: 'endpoint-1', status: 'ACTIVE' })
    expect(JSON.stringify(result)).not.toContain(pushToken)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('INSERT INTO notification_push_endpoints')
    expect(calls[0]?.sql).toContain('ON CONFLICT (installation_id) DO UPDATE')
    expect(calls[0]?.sql).toContain('WHERE notification_push_endpoints.owner_user_id = EXCLUDED.owner_user_id')
    expect(calls[0]?.sql).toContain('RETURNING endpoint_id, permission_status')
    expect(calls[0]?.sql).not.toContain('social_notifications')
    expect(calls[0]?.values).toEqual([
      expect.any(String),
      installationId,
      'identity-user-1',
      'ios',
      pushToken,
      'granted',
      '1.0.0',
      expect.any(String),
      expect.any(String),
      expect.any(String),
    ])
  })

  it('clears an old token when permission is denied or undetermined', async () => {
    const { database, calls } = makeDatabase([{ endpoint_id: 'endpoint-1', permission_status: 'denied' }])

    const result = await upsertPushEndpoint(database, 'identity-user-1', installationId, {
      platform: 'android',
      permissionStatus: 'denied',
      expoPushToken: pushToken,
    })

    expect(result).toEqual({ endpointId: 'endpoint-1', status: 'DISABLED' })
    expect(calls[0]?.values[4]).toBeNull()
    expect(calls[0]?.values[5]).toBe('denied')
  })

  it('rejects untrusted owner fields and malformed Expo tokens before database access', async () => {
    const { database, query } = makeDatabase()

    await expect(upsertPushEndpoint(database, 'identity-user-1', installationId, {
      ownerUserId: 'attacker',
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: pushToken,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 })

    await expect(upsertPushEndpoint(database, 'identity-user-1', installationId, {
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: 'not-an-expo-token',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 })

    expect(query).not.toHaveBeenCalled()
  })

  it('does not allow another account to claim an existing installation identifier', async () => {
    const { database, calls } = makeDatabase([])

    await expect(upsertPushEndpoint(database, 'attacker-user', installationId, {
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: pushToken,
    })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })

    expect(calls[0]?.sql).toContain('WHERE notification_push_endpoints.owner_user_id = EXCLUDED.owner_user_id')
  })

  it('maps PostgreSQL unique token conflicts to a sanitized 409', async () => {
    const failure = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    const { database } = makeDatabase([], failure)

    await expect(upsertPushEndpoint(database, 'identity-user-1', installationId, {
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: pushToken,
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      message: 'CONFLICT',
    })
  })

  it('deletes only the authenticated owner installation and is retry safe', async () => {
    const { database, calls } = makeDatabase([])

    await expect(deletePushEndpoint(database, 'identity-user-1', installationId)).resolves.toBeUndefined()
    expect(calls).toEqual([{
      sql: 'DELETE FROM notification_push_endpoints WHERE owner_user_id = $1 AND installation_id = $2',
      values: ['identity-user-1', installationId],
    }])
  })

  it('fails closed when the Neon D1-03 executor is missing', async () => {
    await expect(upsertPushEndpoint(undefined, 'identity-user-1', installationId, {
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: pushToken,
    })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })

    await expect(deletePushEndpoint(undefined, 'identity-user-1', installationId))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})
