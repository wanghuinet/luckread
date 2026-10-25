export type ScheduledPublicationName = 'account-state' | 'mfa-audit'

export type ScheduledPublicationTask = {
  name: ScheduledPublicationName
  publish: () => Promise<unknown>
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
    console.error(`W02 ${name} scheduled publication tick failed`)
  },
): Promise<void> {
  const outcomes = await Promise.allSettled(tasks.map((task) => task.publish()))
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'rejected') logFailure(tasks[index]!.name)
  })
}
