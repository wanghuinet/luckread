import { describe, expect, it, vi } from 'vitest'
import { processQueueBatch, type QueueMessageLike } from './queue-batch.js'

function makeMessage<TBody>(body: TBody): QueueMessageLike<TBody> {
  return {
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  }
}

describe('W10 queue batch execution', () => {
  it('acknowledges only after a task handler succeeds', async () => {
    const message = makeMessage({ task: 'ok' })
    const execute = vi.fn(async () => undefined)

    const result = await processQueueBatch({ messages: [message] }, execute)

    expect(execute).toHaveBeenCalledWith({ task: 'ok' })
    expect(message.ack).toHaveBeenCalledTimes(1)
    expect(message.retry).not.toHaveBeenCalled()
    expect(result).toEqual({ attempted: 1, acknowledged: 1, retried: 0 })
  })

  it('retries a failed message and continues through the delivered batch', async () => {
    const first = makeMessage('first')
    const failed = makeMessage('failed')
    const last = makeMessage('last')
    const order: string[] = []
    const execute = vi.fn(async (body: string) => {
      order.push(body)
      if (body === 'failed') throw new Error('transient task failure')
    })

    const result = await processQueueBatch(
      { messages: [first, failed, last] },
      execute,
    )

    expect(order).toEqual(['first', 'failed', 'last'])
    expect(first.ack).toHaveBeenCalledTimes(1)
    expect(first.retry).not.toHaveBeenCalled()
    expect(failed.ack).not.toHaveBeenCalled()
    expect(failed.retry).toHaveBeenCalledTimes(1)
    expect(last.ack).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ attempted: 3, acknowledged: 2, retried: 1 })
  })

  it('does not swallow a Queue retry-control failure', async () => {
    const failed = makeMessage('failed')
    const later = makeMessage('later')
    failed.retry = vi.fn(() => {
      throw new Error('retry control unavailable')
    })
    const execute = vi.fn(async (body: string) => {
      if (body === 'failed') throw new Error('task failed')
    })

    await expect(
      processQueueBatch({ messages: [failed, later] }, execute),
    ).rejects.toThrow('retry control unavailable')

    expect(failed.ack).not.toHaveBeenCalled()
    expect(later.ack).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('returns zero counts for an empty batch', async () => {
    const execute = vi.fn(async () => undefined)

    await expect(
      processQueueBatch({ messages: [] }, execute),
    ).resolves.toEqual({ attempted: 0, acknowledged: 0, retried: 0 })

    expect(execute).not.toHaveBeenCalled()
  })
})
