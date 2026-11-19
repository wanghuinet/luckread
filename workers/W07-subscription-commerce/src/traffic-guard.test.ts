import { describe, expect, it, vi } from 'vitest'
import runtime from './index.js'

function neonBinding() {
  const connectionString = vi.fn((): string => {
    throw new Error('Neon pool must not initialize before the traffic guard')
  })
  const binding = {
    get connectionString() {
      return connectionString()
    },
  }
  return { binding, connectionString }
}

function neonBindings() {
  const membership = neonBinding()
  const finance = neonBinding()
  return {
    membership,
    finance,
    env: {
      W07_DATABASE_DRIVER: 'neon',
      W07_MEMBERSHIP_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_MEMBERSHIP_DB: membership.binding,
      HYPERDRIVE_FINANCE_DB: finance.binding,
    },
  }
}

function expectNoNeonPoolResolution(bindings: ReturnType<typeof neonBindings>) {
  expect(bindings.membership.connectionString).not.toHaveBeenCalled()
  expect(bindings.finance.connectionString).not.toHaveBeenCalled()
}

describe('W07 Neon traffic guard', () => {
  it('rejects exhausted origin traffic before Neon pool or transport work', async () => {
    const bindings = neonBindings()
    const response = await runtime.fetch(
      new Request('https://luckread-w07.internal/memberships/subscriptions', { method: 'GET' }),
      {
        ...bindings.env,
        SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER: { limit: vi.fn(async () => ({ success: false })) },
      },
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expectNoNeonPoolResolution(bindings)
  })

  it('fails closed when the origin limiter is missing', async () => {
    const bindings = neonBindings()
    const response = await runtime.fetch(
      new Request('https://luckread-w07.internal/memberships/subscriptions', { method: 'GET' }),
      bindings.env,
    )
    expect(response.status).toBe(503)
    expectNoNeonPoolResolution(bindings)
  })

  it('fails closed when the actor limiter is missing after origin allowance', async () => {
    const bindings = neonBindings()
    const response = await runtime.fetch(
      new Request('https://luckread-w07.internal/memberships/subscriptions', { method: 'GET' }),
      {
        ...bindings.env,
        SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
      },
    )
    expect(response.status).toBe(503)
    expectNoNeonPoolResolution(bindings)
  })

  it('fails closed with 503 when the configured origin limiter throws', async () => {
    const bindings = neonBindings()
    const response = await runtime.fetch(
      new Request('https://luckread-w07.internal/memberships/subscriptions', { method: 'GET' }),
      {
        ...bindings.env,
        SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER: { limit: vi.fn(async () => { throw new Error('limiter unavailable') }) },
        SUBSCRIPTION_READ_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
      },
    )
    expect(response.status).toBe(503)
    const body = await response.json() as { error?: { code?: string; message?: string } }
    expect(body.error?.code).toBe('SERVICE_UNAVAILABLE')
    expect(body.error?.message).toBe('service unavailable')
    expectNoNeonPoolResolution(bindings)
  })

  it('fails closed with 503 when the actor limiter throws', async () => {
    const bindings = neonBindings()
    const response = await runtime.fetch(
      new Request('https://luckread-w07.internal/memberships/subscriptions', { method: 'GET' }),
      {
        ...bindings.env,
        SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
        SUBSCRIPTION_READ_LIMITER: { limit: vi.fn(async () => { throw new Error('actor limiter unavailable') }) },
      },
    )
    expect(response.status).toBe(503)
    expectNoNeonPoolResolution(bindings)
  })
})
