import { describe, expect, it, vi } from 'vitest'
import entry from './entry.js'

describe('W11 Neon-only deployment entrypoint', () => {
  it('fails closed when the Neon driver is not explicitly selected, even if legacy D1 exists', async () => {
    const legacyD1Prepare = vi.fn()
    const response = await entry.fetch(
      new Request('https://w11.internal/healthz'),
      {
        D1_05: { prepare: legacyD1Prepare },
      } as never,
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      worker: 'W11',
      status: 'degraded',
      database: 'unconfigured',
    })
    expect(legacyD1Prepare).not.toHaveBeenCalled()
  })

  it('does not fall back to legacy D1 when Neon is selected but Hyperdrive is missing', async () => {
    const legacyD1Prepare = vi.fn()
    const response = await entry.fetch(
      new Request('https://w11.internal/healthz'),
      {
        W11_DATABASE_DRIVER: 'neon',
        D1_05: { prepare: legacyD1Prepare },
      } as never,
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      worker: 'W11',
      status: 'degraded',
      database: 'unavailable',
    })
    expect(legacyD1Prepare).not.toHaveBeenCalled()
  })
})
