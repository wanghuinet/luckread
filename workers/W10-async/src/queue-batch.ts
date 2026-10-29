/**
 * W10 queue batch execution primitive.
 *
 * This module owns only message acknowledgement/retry mechanics. Task-specific
 * validation, authorization, idempotency, and business-state writes remain with
 * the admitted task handler and its owning Worker.
 *
 * Queue delivery is at-least-once: every supplied handler MUST be idempotent.
 * Consumer max_retries and DLQ routing are configured by the existing Queue
 * owner; this helper intentionally does not provision or select a Queue.
 */

export interface QueueMessageLike<TBody> {
  readonly body: TBody
  ack(): void
  retry(): void
}

export interface QueueBatchLike<TBody> {
  readonly messages: readonly QueueMessageLike<TBody>[]
}

export interface QueueBatchResult {
  attempted: number
  acknowledged: number
  retried: number
}

/**
 * Execute messages serially in the order delivered by the Queue.
 *
 * A failed task is retried individually and does not prevent later messages in
 * the same batch from running. If Queue acknowledgement/retry control itself
 * throws, let that error escape so the platform can fail the batch rather than
 * accidentally treating an unhandled message as successfully processed.
 */
export async function processQueueBatch<TBody>(
  batch: QueueBatchLike<TBody>,
  execute: (body: TBody) => Promise<void>,
): Promise<QueueBatchResult> {
  const result: QueueBatchResult = {
    attempted: 0,
    acknowledged: 0,
    retried: 0,
  }

  for (const message of batch.messages) {
    result.attempted += 1

    try {
      await execute(message.body)
    } catch {
      message.retry()
      result.retried += 1
      continue
    }

    message.ack()
    result.acknowledged += 1
  }

  return result
}
