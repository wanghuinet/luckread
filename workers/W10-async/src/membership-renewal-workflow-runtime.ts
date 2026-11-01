export interface MembershipRenewalWorkflowEnv {
  readonly W07_COMMERCE: Fetcher
  readonly MEMBERSHIP_RENEWAL_ENABLED?: string
}

export type RenewalBatchWorkflowResult = Readonly<{
  readonly status: 'COMPLETED' | 'PARTIAL' | 'SCHEMA_NOT_READY'
}>

export type WorkflowSchedule = Readonly<{
  cron: string
  scheduledTime: number
}>

export type WorkflowStepRunner = (
  name: string,
  options: Readonly<{
    retries: Readonly<{
      limit: number
      delay: '5 seconds'
      backoff: 'exponential'
    }>
  }>,
  callback: () => Promise<RenewalBatchWorkflowResult>,
) => Promise<RenewalBatchWorkflowResult>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseRenewalBatchResult(value: unknown): RenewalBatchWorkflowResult {
  if (!isRecord(value) ||
      (value.status !== 'COMPLETED' && value.status !== 'PARTIAL' && value.status !== 'SCHEMA_NOT_READY')) {
    throw new Error('W07_RENEWAL_RESPONSE_INVALID')
  }
  return { status: value.status }
}

/**
 * Durable scheduler adapter. W10 owns only orchestration/retry; every scan,
 * reconciliation, pricing decision and payment side effect stays in W07.
 */
export async function runMembershipRenewalWorkflow(
  env: MembershipRenewalWorkflowEnv,
  schedule: WorkflowSchedule | undefined,
  runStep: WorkflowStepRunner,
): Promise<RenewalBatchWorkflowResult | Readonly<{ status: 'DISABLED' }>> {
  // Both W10 and W07 must be explicitly enabled. The repository default is off.
  if (env.MEMBERSHIP_RENEWAL_ENABLED !== 'true') return { status: 'DISABLED' }

  if (!schedule ||
      !Number.isSafeInteger(schedule.scheduledTime) ||
      schedule.scheduledTime < 0 ||
      typeof schedule.cron !== 'string' ||
      schedule.cron.length === 0 ||
      schedule.cron.length > 128) {
    throw new Error('W10_RENEWAL_SCHEDULE_REQUIRED')
  }

  const correlationId = 'membership-renewal-workflow-' + String(schedule.scheduledTime)

  const persistedResult = await runStep(
    'invoke-w07-renewal-batch',
    { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' } },
    async () => {
      const response = await env.W07_COMMERCE.fetch(
        new Request('https://luckread-w07.internal/internal/renewals/w10/scheduled-batch', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-LuckRead-Caller': 'W10',
            'X-LuckRead-Transport-Version': '1.0',
            'X-LuckRead-Correlation-Id': correlationId,
          },
          body: '{}',
        }),
      )

      if (!response.ok) {
        // Do not place provider responses or credentials into Workflow errors.
        throw new Error('W07_RENEWAL_TRANSPORT_HTTP_' + String(response.status))
      }

      let envelope: unknown
      try {
        envelope = await response.json()
      } catch {
        throw new Error('W07_RENEWAL_RESPONSE_INVALID')
      }
      if (!isRecord(envelope) || !Object.hasOwn(envelope, 'data')) {
        throw new Error('W07_RENEWAL_RESPONSE_INVALID')
      }
      return parseRenewalBatchResult(envelope.data)
    },
  )
  return parseRenewalBatchResult(persistedResult)
}
