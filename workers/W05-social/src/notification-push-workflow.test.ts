import { describe, expect, it, vi } from 'vitest'
import { runScheduledNotificationPush, type NotificationPushDeliveryEnv } from './notification-push-workflow-runtime.js'

const schedule = { cron: '* * * * *', scheduledTime: Date.parse('2026-11-04T00:00:00.000Z') }

function stepRunner() {
  const calls: Array<{ name: string; options: unknown }> = []
  const runStep = async <T>(
    name: string,
    options: Readonly<{ retries: Readonly<{ limit: number; delay: string; backoff: 'exponential' }> }>,
    callback: () => Promise<T>,
  ): Promise<T> => {
    calls.push({ name, options })
    return callback()
  }
  return { runStep, calls }
}

describe('W05 notification push durable Workflow', () => {
  it('does not create a durable step while delivery is disabled', async () => {
    const prepare = vi.fn()
    const env = { PUSH_DELIVERY_ENABLED: 'false', DB: { prepare }, D1_03: { prepare } } as unknown as NotificationPushDeliveryEnv
    const step = stepRunner()
    const result = await runScheduledNotificationPush(env, schedule, step.runStep)
    expect(result.status).toBe('DISABLED')
    expect(step.calls).toEqual([])
    expect(prepare).not.toHaveBeenCalled()
  })

  it('uses one retryable Workflow step for the W05-owned delivery batch', async () => {
    const result = { status: 'COMPLETED' as const, fannedOut: 1, sent: 2, delivered: 1, retried: 1, failed: 0, skipped: 0 }
    const runBatch = vi.fn(async () => result)
    const env = { PUSH_DELIVERY_ENABLED: 'true', DB: { prepare: vi.fn() }, D1_03: { prepare: vi.fn() } } as unknown as NotificationPushDeliveryEnv
    const step = stepRunner()
    const output = await runScheduledNotificationPush(env, schedule, async (name, options) => {
      step.calls.push({ name, options })
      return runBatch()
    })
    expect(output).toEqual(result)
    expect(step.calls).toEqual([{
      name: 'process-w05-notification-push-batch',
      options: { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' } },
    }])
    expect(runBatch).toHaveBeenCalledTimes(1)
  })

  it('rejects missing schedule data rather than starting an ambiguous batch', async () => {
    const env = { PUSH_DELIVERY_ENABLED: 'true', DB: { prepare: vi.fn() }, D1_03: { prepare: vi.fn() } } as unknown as NotificationPushDeliveryEnv
    const step = stepRunner()
    await expect(runScheduledNotificationPush(env, undefined, step.runStep)).rejects.toThrow('W05_PUSH_DELIVERY_SCHEDULE_REQUIRED')
    expect(step.calls).toEqual([])
  })
})
