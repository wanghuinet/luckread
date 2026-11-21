/**
 * Retry policy for W10 message execution.
 *
 * Cloudflare Queue owns the retry limit and DLQ transition. This module only
 * chooses a per-message delay; it never acknowledges a failed message or
 * provisions a queue. Permanent/poison failures are retried with a short delay
 * so the configured consumer retry limit can move them to its DLQ quickly.
 */

export type QueueFailureClass = 'transient' | 'permanent' | 'poison'

export class QueueTaskFailure extends Error {
  constructor(
    message: string,
    readonly failureClass: QueueFailureClass,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'QueueTaskFailure'
  }
}

/**
 * Untyped errors default to transient: retrying is safer than silently dropping
 * an unknown failure. Task handlers should explicitly classify validated,
 * non-retryable input failures as permanent/poison.
 */
export function classifyQueueFailure(error: unknown): QueueFailureClass {
  return error instanceof QueueTaskFailure ? error.failureClass : 'transient'
}

/**
 * Calculate a bounded retry delay using full jitter within an exponential
 * window. The optional random source makes the policy deterministic in tests.
 *
 * Transient: 1..min(300, 5 * 2^(attempts-1)) seconds.
 * Permanent/poison: 1 second, to reach the configured native DLQ limit quickly.
 * The Queue consumer remains responsible for max_retries and DLQ configuration.
 */
export function calculateRetryDelaySeconds(
  attempts: number,
  failureClass: QueueFailureClass,
  random: () => number = Math.random,
): number {
  if (failureClass !== 'transient') return 1

  const normalizedAttempt =
    Number.isSafeInteger(attempts) && attempts >= 1 ? Math.min(attempts, 7) : 1
  const windowSeconds = Math.min(300, 5 * 2 ** (normalizedAttempt - 1))
  const sample = random()

  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new Error('INVALID_RETRY_JITTER_SOURCE')
  }

  return 1 + Math.floor(sample * windowSeconds)
}
