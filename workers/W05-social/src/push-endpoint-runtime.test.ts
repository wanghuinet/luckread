/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { deletePushEndpoint, upsertPushEndpoint } from './push-endpoint-runtime.js'

const installationId = '6b6d9f5a-4e61-4c50-9d17-9e97f36e6e3c'
const pushToken = 'ExponentPushToken[abcdefghijklmnop_1234567890]'

describe('W05 notification push endpoint runtime', () => {
  it('upserts one Expo endpoint using the authenticated owner and never returns the token', async () => {
    let sql = ''
    let bindings: unknown[] = []
    const db = {
      prepare: vi.fn((value: string) => {
        sql = value
        return {
          bind: vi.fn((...values: unknown[]) => {
            bindings = values
            return { first: vi.fn(async () => ({ endpoint_id: 'endpoint-1', permission_status: 'granted' })) }
          }),
        }
      }),
    } as unknown as D1Database

    const result = await upsertPushEndpoint(db, 'identity-user-1', installationId, {
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: pushToken,
      appVersion: '1.0.0',
    })

    expect(result).toEqual({ endpointId: 'endpoint-1', status: 'ACTIVE' })
    expect(JSON.stringify(result)).not.toContain(pushToken)
    expect(sql).toContain('INSERT INTO notification_push_endpoints')
    expect(sql).toContain('ON CONFLICT(installation_id) DO UPDATE')
    expect(sql).toContain('RETURNING endpoint_id, permission_status')
    expect(sql).not.toContain('social_notifications')
    expect(bindings).toContain('identity-user-1')
    expect(bindings).toContain(installationId)
    expect(bindings).toContain(pushToken)
  })

  it('clears an old token when permission is denied or undetermined', async () => {
    let bindings: unknown[] = []
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn((...values: unknown[]) => {
          bindings = values
          return { first: vi.fn(async () => ({ endpoint_id: 'endpoint-1', permission_status: 'denied' })) }
        }),
      })),
    } as unknown as D1Database

    const result = await upsertPushEndpoint(db, 'identity-user-1', installationId, {
      platform: 'android',
      permissionStatus: 'denied',
      expoPushToken: null,
    })

    expect(result).toEqual({ endpointId: 'endpoint-1', status: 'DISABLED' })
    expect(bindings).toContain(null)
    expect(bindings).toContain('denied')
  })

  it('rejects untrusted owner fields and malformed Expo tokens before database access', async () => {
    const prepare = vi.fn()
    const db = { prepare } as unknown as D1Database

    await expect(upsertPushEndpoint(db, 'identity-user-1', installationId, {
      ownerUserId: 'attacker',
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: pushToken,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 })

    await expect(upsertPushEndpoint(db, 'identity-user-1', installationId, {
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: 'not-an-expo-token',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 })

    expect(prepare).not.toHaveBeenCalled()
  })

  it('does not allow another account to claim an existing installation identifier', async () => {
    let sql = ''
    const db = {
      prepare: vi.fn((value: string) => {
        sql = value
        return {
          bind: () => ({ first: async () => null }),
        }
      }),
    } as unknown as D1Database

    await expect(upsertPushEndpoint(db, 'attacker-user', installationId, {
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: pushToken,
    })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })

    expect(sql).toContain('WHERE notification_push_endpoints.owner_user_id = excluded.owner_user_id')
  })

  it('rejects a token already assigned to a different installation without leaking SQL details', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => {
            throw new Error(
              'UNIQUE constraint failed: notification_push_endpoints.provider, notification_push_endpoints.push_token',
            )
          },
        }),
      }),
    } as unknown as D1Database

    await expect(upsertPushEndpoint(db, 'identity-user-1', installationId, {
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: pushToken,
    })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })

  it('deletes only the authenticated owner installation and is retry safe', async () => {
    let sql = ''
    let bindings: unknown[] = []
    const db = {
      prepare: vi.fn((value: string) => {
        sql = value
        return {
          bind: vi.fn((...values: unknown[]) => {
            bindings = values
            return { run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })) }
          }),
        }
      }),
    } as unknown as D1Database

    await expect(deletePushEndpoint(db, 'identity-user-1', installationId)).resolves.toBeUndefined()
    expect(sql).toBe('DELETE FROM notification_push_endpoints WHERE owner_user_id = ? AND installation_id = ?')
    expect(bindings).toEqual(['identity-user-1', installationId])
  })

  it('fails closed if the W05 scoped D1-03 binding is missing', async () => {
    await expect(upsertPushEndpoint(undefined, 'identity-user-1', installationId, {
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: pushToken,
    })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })

    await expect(deletePushEndpoint(undefined, 'identity-user-1', installationId))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})
