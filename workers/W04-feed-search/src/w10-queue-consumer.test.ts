import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './index.js'
import type { ProjectionRecord } from './auth-013-projection.js'

class FakeProjectionKV {
  readonly values = new Map<string, string>()
  failGet = false

  async get(key: string, _type: 'json'): Promise<unknown> {
    if (this.failGet) throw new Error('sensitive storage detail')
    const value = this.values.get(key)
    return value === undefined ? null : JSON.parse(value) as ProjectionRecord
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value)
  }
}

function accountStateEvent(version = 2) {
  return {
    eventId: `evt_${version}`,
    eventType: 'identity.account_state_changed',
    schemaVersion: '1.0',
    producer: 'W02',
    resourceType: 'User',
    resourceId: 'usr_w10_reuse_test',
    occurredAt: '2026-10-29T04:00:00.000Z',
    publishedAt: '2026-10-29T04:00:01.000Z',
    correlationId: 'trace_w10_reuse_test',
    causationId: `cause_${version}`,
    idempotencyKey: `idempotency_key_${version}_0001`,
    attempt: 1,
    sourceVersion: version,
    actor: { actorId: 'system_01', actorType: 'system' },
    before: { accountState: 'ACTIVE', accountStateVersion: version - 1 },
    after: { accountState: 'SUSPENDED', accountStateVersion: version },
    reason: 'consumer integration test',
  }
}

function message(body: unknown, attempts = 1) {
  return {
    body,
    attempts,
    ack: vi.fn(),
    retry: vi.fn((_options?: { delaySeconds: number }) => undefined),
  }
}

const envFor = (kv: FakeProjectionKV) => ({
  AUTH013_W04_DERIVED_PROJECTION: kv,
  W05_SOCIAL: { fetch: async () => new Response(null) },
})

afterEach(() => vi.restoreAllMocks())

describe('W04 projection consumer reuses W10 queue execution', () => {
  it('acknowledges a successfully applied projection through the shared executor', async () => {
    const kv = new FakeProjectionKV()
    const msg = message(accountStateEvent())

    await worker.queue({ messages: [msg] }, envFor(kv))

    expect(msg.ack).toHaveBeenCalledTimes(1)
    expect(msg.retry).not.toHaveBeenCalled()
    expect(kv.values.has('auth013:projection:User:usr_w10_reuse_test')).toBe(true)
  })

  it('classifies malformed events as poison, retries quickly, and continues the batch', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const kv = new FakeProjectionKV()
    const malformed = message({ eventType: 'not-an-event' }, 3)
    const valid = message(accountStateEvent(4), 1)

    await worker.queue({ messages: [malformed, valid] }, envFor(kv))

    expect(malformed.ack).not.toHaveBeenCalled()
    expect(malformed.retry).toHaveBeenCalledWith({ delaySeconds: 1 })
    expect(valid.ack).toHaveBeenCalledTimes(1)
    expect(valid.retry).not.toHaveBeenCalled()
    expect(kv.values.has('auth013:projection:User:usr_w10_reuse_test')).toBe(true)
  })

  it('uses W10 transient backoff for projection storage failures without logging exception details', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const kv = new FakeProjectionKV()
    kv.failGet = true
    const msg = message(accountStateEvent(), 4)

    await worker.queue({ messages: [msg] }, envFor(kv))

    expect(msg.ack).not.toHaveBeenCalled()
    expect(msg.retry).toHaveBeenCalledTimes(1)
    const options = msg.retry.mock.calls[0]?.[0]
    expect(options?.delaySeconds).toBeGreaterThanOrEqual(1)
    expect(options?.delaySeconds).toBeLessThanOrEqual(40)
    expect(errorLog).toHaveBeenCalledWith(JSON.stringify({
      event: 'auth013.w04.projection_consumer_error',
      code: 'PROJECTION_APPLY_FAILED',
    }))
    expect(errorLog.mock.calls.flat().join(' ')).not.toContain('sensitive storage detail')
  })
})
