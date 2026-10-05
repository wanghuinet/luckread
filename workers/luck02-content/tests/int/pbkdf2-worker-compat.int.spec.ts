import { describe, expect, it } from 'vitest'

import {
  WORKER_PBKDF2_MAX_ITERATIONS,
  clampWorkerPbkdf2Iterations,
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
})
