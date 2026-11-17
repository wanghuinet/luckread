import { describe, expect, it, vi } from 'vitest'
import worker, { createW05SocialWorker } from './index.js'
import type { NotificationPreferencesStore } from './notification-preferences-store.js'
import { getNotificationPreferences, setNotificationPreferences, SocialClosureRuntimeError } from './social-closure-runtime.js'

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
    headers: { ...transportHeaders, ...(method === 'PATCH' ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(method === 'PATCH' ? { body: JSON.stringify(body) } : {}),
  })

describe('W05 notification preferences runtime', () => {
  it('reads and updates preferences through an injected Store', async () => {
    const defaults = { follow: true, like: true, comment: true, mention: true }
    const saved = { follow: false, like: true, comment: true, mention: false }
    const store: NotificationPreferencesStore = {
      get: vi.fn(async () => defaults),
      set: vi.fn(async () => saved),
    }
    await expect(getNotificationPreferences(store, 'viewer-2')).resolves.toEqual(defaults)
    await expect(setNotificationPreferences(store, 'viewer-2', { like: true, mention: false })).resolves.toEqual(saved)
    expect(store.get).toHaveBeenCalledWith('viewer-2')
    expect(store.set).toHaveBeenCalledWith('viewer-2', { like: true, mention: false })
  })

  it('maps injected storage failures to a sanitized internal error', async () => {
    const store: NotificationPreferencesStore = {
      get: vi.fn(async () => { throw new Error('private-storage-host-detail') }),
      set: vi.fn(async () => { throw new Error('private-storage-host-detail') }),
    }
    await expect(getNotificationPreferences(store, 'viewer-3')).rejects.toBeInstanceOf(SocialClosureRuntimeError)
    await expect(setNotificationPreferences(store, 'viewer-3', { like: false })).rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 500 })
  })

  it('fails closed when no PostgreSQL preferences Store is composed', async () => {
    const response = await worker.fetch(requestFor('GET'), {} as never)
    expect(response.status).toBe(503)
  })

  it('routes GET/PATCH through the injected Neon Store and scopes both operations to the authenticated principal', async () => {
    const defaults = { follow: true, like: true, comment: true, mention: true }
    const store: NotificationPreferencesStore = {
      get: vi.fn(async () => defaults),
      set: vi.fn(async (_userId, input) => ({ ...defaults, ...input })),
    }
    const neonWorker = createW05SocialWorker({ notificationPreferencesStore: store })
    const getResponse = await neonWorker.fetch(requestFor('GET'), {} as never, {} as never)
    expect(getResponse.status).toBe(200)
    await expect(getResponse.json()).resolves.toMatchObject({ data: defaults })
    expect(store.get).toHaveBeenCalledWith('viewer-1')
    const patchResponse = await neonWorker.fetch(requestFor('PATCH', { like: false, mention: false }), {} as never, {} as never)
    expect(patchResponse.status).toBe(200)
    await expect(patchResponse.json()).resolves.toMatchObject({ data: { follow: true, like: false, comment: true, mention: false } })
    expect(store.set).toHaveBeenCalledWith('viewer-1', { like: false, mention: false })
  })

  it('rejects empty, unknown, or non-boolean fields before requiring a Store', async () => {
    for (const body of [{}, { follow: true, ownerUserId: 'attacker' }, { like: 'false' }]) {
      const response = await worker.fetch(requestFor('PATCH', body), {} as never)
      expect(response.status).toBe(422)
    }
  })

  it('rejects an L1 principal before requiring a Store', async () => {
    const response = await worker.fetch(requestFor('GET', undefined, { 'X-LuckRead-Principal-Layer': 'L1' }), {} as never)
    expect(response.status).toBe(403)
  })
})
