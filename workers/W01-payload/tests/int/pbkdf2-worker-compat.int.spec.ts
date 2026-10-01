import { describe, expect, it, vi } from 'vitest'

import {
  WORKER_PBKDF2_MAX_ITERATIONS,
  clampWorkerPbkdf2Iterations,
  wrapWorkerPbkdf2,
} from '../../src/runtime/pbkdf2-worker-compat'

describe('Worker PBKDF2 compatibility boundary', () => {
  it('clamps Payload native requests above the Worker ceiling', () => {
    expect(clampWorkerPbkdf2Iterations(600_000)).toBe(WORKER_PBKDF2_MAX_ITERATIONS)
    expect(WORKER_PBKDF2_MAX_ITERATIONS).toBe(100_000)
  })

  it('preserves the exact ceiling value', () => {
    expect(clampWorkerPbkdf2Iterations(100_000)).toBe(100_000)
  })

  it('does not reduce requests already below the ceiling', () => {
    expect(clampWorkerPbkdf2Iterations(10_000)).toBe(10_000)
  })

  it('passes the clamped iteration count to the native implementation', () => {
    const nativePbkdf2 = vi.fn((...args: any[]) => args[5]?.(null, Buffer.from('native-result')))
    const workerPbkdf2 = wrapWorkerPbkdf2(nativePbkdf2)

    let callbackResult: Buffer | null = null
    workerPbkdf2('password', 'salt', 600_000, 32, 'sha256', (_error: Error | null, result: Buffer) => {
      callbackResult = result
    })

    expect(nativePbkdf2).toHaveBeenCalledTimes(1)
    expect(nativePbkdf2.mock.calls[0]?.[2]).toBe(WORKER_PBKDF2_MAX_ITERATIONS)
    expect(callbackResult?.toString()).toBe('native-result')
  })
})
