export type ScheduledPublicationName = 'account-state' | 'mfa-audit'

export type ScheduledPublicationTask = {
  name: ScheduledPublicationName
  publish: () => Promise<unknown>
}

export type MfaPublicationSummary = {
  selected: number
  published: number
  failed: number
  receiptSelected?: number
  receiptEmitted?: number
  receiptFailed?: number
  receiptUnknown?: number
}

function isMfaPublicationSummary(value: unknown): value is MfaPublicationSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const summary = value as Record<string, unknown>
  const required = ['selected', 'published', 'failed']
  const optional = ['receiptSelected', 'receiptEmitted', 'receiptFailed', 'receiptUnknown']
  return required.every((key) =>
    Number.isSafeInteger(summary[key]) && Number(summary[key]) >= 0,
  ) && optional.every((key) =>
    summary[key] === undefined || (Number.isSafeInteger(summary[key]) && Number(summary[key]) >= 0),
  )
}

/**
 * Run existing W02 journal publishers independently.
 *
 * A failure reading or draining the account-state journal must not prevent
 * the MFA audit outbox from being attempted during the same cron tick.
 * Log only a fixed task label; never log queue payloads or thrown values.
 */
export async function runScheduledPublicationTicks(
  tasks: readonly ScheduledPublicationTask[],
  logFailure: (name: ScheduledPublicationName) => void = (name) => {
    console.error('W02 scheduled publication task failed', { task: name })
  },
  logMfaAuditSummary: (summary: MfaPublicationSummary) => void = (summary) => {
    console.info('W02 scheduled publication result', { task: 'mfa-audit', ...summary })
  },
): Promise<void> {
  const outcomes = await Promise.allSettled(tasks.map((task) => task.publish()))
  outcomes.forEach((outcome, index) => {
    const task = tasks[index]!
    if (outcome.status === 'rejected') {
      logFailure(task.name)
      return
    }
    if (task.name === 'mfa-audit' && isMfaPublicationSummary(outcome.value)) {
      const summary = outcome.value
      if (
        summary.selected > 0 ||
        summary.failed > 0 ||
        (summary.receiptSelected ?? 0) > 0 ||
        (summary.receiptFailed ?? 0) > 0 ||
        (summary.receiptUnknown ?? 0) > 0
      ) logMfaAuditSummary(summary)
    }
  })
}
