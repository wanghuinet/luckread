import { describe, expect, it } from 'vitest'
import {
  calculateRetryDelaySeconds,
  classifyQueueFailure,
  QueueTaskFailure,
} from './retry-policy.js'

describe('W10 queue retry policy', () => {
  it('classifies explicit transient, permanent, and poison failures', () => {
    expect(classifyQueueFailure(new QueueTaskFailure('temporary', 'transient'))).toBe('transient')
    expect(classifyQueueFailure(new QueueTaskFailure('invalid input', 'permanent'))).toBe('permanent')
    expect(classifyQueueFailure(new QueueTaskFailure('invalid envelope', 'poison'))).toBe('poison')
  })

  it('treats unknown errors as transient rather than dropping work', () => {
    expect(classifyQueueFailure(new Error('unclassified'))).toBe('transient')
    expect(classifyQueueFailure('not an Error instance')).toBe('transient')
  })

  it('uses deterministic jitter within the first exponential window', () => {
    expect(calculateRetryDelaySeconds(1, 'transient', () => 0)).toBe(1)
    expect(calculateRetryDelaySeconds(1, 'transient', () => 0.999)).toBe(5)
  })

  it('increases the window and caps the retry delay', () => {
    expect(calculateRetryDelaySeconds(3, 'transient', () => 0.5)).toBe(11)
    expect(calculateRetryDelaySeconds(7, 'transient', () => 0.5)).toBe(151)
    expect(calculateRetryDelaySeconds(1000, 'transient', () => 0.999)).toBe(300)
  })

  it('gives permanent and poison failures a short delay for native DLQ delivery', () => {
    expect(calculateRetryDelaySeconds(5, 'permanent', () => 0.8)).toBe(1)
    expect(calculateRetryDelaySeconds(5, 'poison', () => 0.8)).toBe(1)
  })

  it('normalizes invalid attempt counts and rejects an invalid jitter source', () => {
    expect(calculateRetryDelaySeconds(0, 'transient', () => 0)).toBe(1)
    expect(calculateRetryDelaySeconds(Number.NaN, 'transient', () => 0)).toBe(1)
    expect(() => calculateRetryDelaySeconds(1, 'transient', () => 1)).toThrow(
      'INVALID_RETRY_JITTER_SOURCE',
    )
  })
})
