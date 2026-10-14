import { describe, expect, it, vi } from 'vitest'
import worker, { type W11Env } from './worker'

function environment(first: () => Promise<unknown>): W11Env {
  return {
    D1_05: {
      prepare: vi.fn((query: string) => {
        expect(query).toBe('SELECT 1 AS ok')
        return {
          first: vi.fn(first),
        }
      }),
    },
  }
}

describe('W11 runtime boundary', () => {
  it('confirms the D1-05 binding with a minimal read-only probe', async () => {
    const env = environment(async () => ({ ok: 1 }))
    const response = await worker.fetch(
      new Request('https://w11.internal/healthz'),
      env,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      worker: 'W11',
      status: 'ok',
      database: 'reachable',
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(env.D1_05.prepare).toHaveBeenCalledTimes(1)
  })

  it('returns a sanitized degraded response when D1-05 is unavailable', async () => {
    const env = environment(async () => {
      throw new Error('sensitive provider configuration')
    })
    const response = await worker.fetch(
      new Request('https://w11.internal/healthz'),
      env,
    )

    expect(response.status).toBe(503)
    const body = await response.text()
    expect(JSON.parse(body)).toEqual({
      worker: 'W11',
      status: 'degraded',
      database: 'unavailable',
    })
    expect(body).not.toContain('sensitive provider configuration')
  })

  it('keeps analytics data routes closed until an admitted transport is connected', async () => {
    const env = environment(async () => ({ ok: 1 }))
    const response = await worker.fetch(
      new Request('https://w11.internal/api/analytics/creators'),
      env,
    )

    expect(response.status).toBe(404)
    expect(env.D1_05.prepare).not.toHaveBeenCalled()
  })

  it('does not expose a health endpoint to non-GET methods', async () => {
    const env = environment(async () => ({ ok: 1 }))
    const response = await worker.fetch(
      new Request('https://w11.internal/healthz', { method: 'POST' }),
      env,
    )

    expect(response.status).toBe(404)
    expect(env.D1_05.prepare).not.toHaveBeenCalled()
  })
})
