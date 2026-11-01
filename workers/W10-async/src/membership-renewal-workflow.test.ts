import { describe, expect, it, vi } from 'vitest'
import {
  runMembershipRenewalWorkflow,
  type MembershipRenewalWorkflowEnv,
} from './membership-renewal-workflow-runtime.js'

const schedule = {
  cron: '* * * * *',
  scheduledTime: Date.parse('2026-11-01T00:00:00.000Z'),
}

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

describe('W10 membership renewal Workflow runtime', () => {
  it('does not call W07 while the explicit activation switch is off', async () => {
    const fetch = vi.fn()
    const env = {
      MEMBERSHIP_RENEWAL_ENABLED: 'false',
      W07_COMMERCE: { fetch },
    } as unknown as MembershipRenewalWorkflowEnv
    const step = stepRunner()

    const result = await runMembershipRenewalWorkflow(env, schedule, step.runStep)

    expect(result).toEqual({ status: 'DISABLED' })
    expect(fetch).not.toHaveBeenCalled()
    expect(step.calls).toEqual([])
  })

  it('calls only the W07 owning-domain endpoint in a durable retryable step', async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.method).toBe('POST')
      expect(request.url).toBe('https://luckread-w07.internal/internal/renewals/w10/scheduled-batch')
      expect(request.headers.get('X-LuckRead-Caller')).toBe('W10')
      expect(request.headers.get('X-LuckRead-Transport-Version')).toBe('1.0')
      expect(request.headers.get('X-LuckRead-Correlation-Id')).toBe(
        'membership-renewal-workflow-' + String(schedule.scheduledTime),
      )
      expect(await request.text()).toBe('{}')
      return Response.json({
        data: {
          status: 'COMPLETED',
          processed: 1,
          processFailures: 0,
        },
        requestId: 'request_123',
      })
    })
    const env = {
      MEMBERSHIP_RENEWAL_ENABLED: 'true',
      W07_COMMERCE: { fetch },
    } as unknown as MembershipRenewalWorkflowEnv
    const step = stepRunner()

    const result = await runMembershipRenewalWorkflow(env, schedule, step.runStep)

    expect(result).toEqual({ status: 'COMPLETED', processed: 1, processFailures: 0 })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(step.calls).toEqual([{
      name: 'invoke-w07-renewal-batch',
      options: { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' } },
    }])
  })

  it('throws a safe transport error on non-success responses so the Workflow retries', async () => {
    const env = {
      MEMBERSHIP_RENEWAL_ENABLED: 'true',
      W07_COMMERCE: {
        fetch: vi.fn(async () => new Response('private provider details', { status: 503 })),
      },
    } as unknown as MembershipRenewalWorkflowEnv
    const step = stepRunner()

    await expect(runMembershipRenewalWorkflow(env, schedule, step.runStep))
      .rejects.toThrow('W07_RENEWAL_TRANSPORT_HTTP_503')
  })

  it('rejects missing schedules and malformed W07 results', async () => {
    const env = {
      MEMBERSHIP_RENEWAL_ENABLED: 'true',
      W07_COMMERCE: {
        fetch: vi.fn(async () => Response.json({ data: { status: 'UNKNOWN' } })),
      },
    } as unknown as MembershipRenewalWorkflowEnv
    const step = stepRunner()

    await expect(runMembershipRenewalWorkflow(env, undefined, step.runStep))
      .rejects.toThrow('W10_RENEWAL_SCHEDULE_REQUIRED')
    await expect(runMembershipRenewalWorkflow(env, schedule, step.runStep))
      .rejects.toThrow('W07_RENEWAL_RESPONSE_INVALID')
  })
})
