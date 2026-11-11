export type NotificationPushSendRetryStatus = 'RETRY' | 'FAILED'

export type RecordNotificationPushTicketInput = Readonly<{
  deliveryId: string
  leaseToken: string
  ticketId: string
  nextAttemptAt: string
  now: string
}>

export type ScheduleNotificationPushRetryInput = Readonly<{
  deliveryId: string
  leaseToken: string
  status: NotificationPushSendRetryStatus
  nextAttemptAt: string
  errorCode: string
  now: string
}>

export type NotificationPushSendResultStore = Readonly<{
  /** Lease-token compare-and-set. False means the claim has already expired or been superseded. */
  recordTicket(input: RecordNotificationPushTicketInput): Promise<boolean>
  /** Lease-token compare-and-set. False means the claim has already expired or been superseded. */
  scheduleRetry(input: ScheduleNotificationPushRetryInput): Promise<boolean>
}>

export class NotificationPushSendResultStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('NOTIFICATION_PUSH_SEND_RESULT_UNAVAILABLE')
    this.name = 'NotificationPushSendResultStoreError'
  }
}

type D1RunResult = Readonly<{ meta?: Readonly<{ changes?: number }> }>
type D1BoundStatement = Readonly<{ run(): Promise<D1RunResult> }>
type D1Statement = Readonly<{ bind(...values: unknown[]): D1BoundStatement }>

export interface NotificationPushSendResultD1Executor {
  prepare(sql: string): D1Statement
}

/** D1 remains the production-default send-result adapter until an authorized database cutover. */
export function createD1NotificationPushSendResultStore(
  db: NotificationPushSendResultD1Executor,
): NotificationPushSendResultStore {
  const update = async (sql: string, values: unknown[]): Promise<boolean> => {
    try {
      const result = await db.prepare(sql).bind(...values).run()
      return Number(result.meta?.changes ?? 0) === 1
    } catch {
      throw new NotificationPushSendResultStoreError()
    }
  }

  return {
    async recordTicket(input) {
      return update(
        "UPDATE social_notification_push_deliveries SET status = 'RECEIPT_PENDING', expo_ticket_id = ?, receipt_poll_count = 0, " +
        'next_attempt_at = ?, lease_token = NULL, lease_expires_at = NULL, last_error_code = NULL, updated_at = ? ' +
        "WHERE delivery_id = ? AND status = 'LEASED' AND lease_token = ?",
        [input.ticketId, input.nextAttemptAt, input.now, input.deliveryId, input.leaseToken],
      )
    },

    async scheduleRetry(input) {
      return update(
        'UPDATE social_notification_push_deliveries SET status = ?, next_attempt_at = ?, expo_ticket_id = NULL, ' +
        'lease_token = NULL, lease_expires_at = NULL, last_error_code = ?, updated_at = ? ' +
        "WHERE delivery_id = ? AND status = 'LEASED' AND lease_token = ?",
        [input.status, input.nextAttemptAt, input.errorCode, input.now, input.deliveryId, input.leaseToken],
      )
    },
  }
}
