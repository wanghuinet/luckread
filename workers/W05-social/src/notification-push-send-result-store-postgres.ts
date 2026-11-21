import {
  NotificationPushSendResultStoreError,
  type NotificationPushSendResultStore,
  type RecordNotificationPushTicketInput,
  type ScheduleNotificationPushRetryInput,
} from './notification-push-send-result-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; the Worker runtime does not bundle a Node driver. */
export interface NotificationPushSendResultPostgresExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/** PostgreSQL ticket/retry transitions use lease-token CAS and return whether the lease was still current. */
export function createPostgresNotificationPushSendResultStore(
  db: NotificationPushSendResultPostgresExecutor,
): NotificationPushSendResultStore {
  const update = async (sql: string, values: unknown[]): Promise<boolean> => {
    try {
      const result = await db.query<{ delivery_id: string }>(sql, values)
      return result.rows.length === 1
    } catch {
      // Do not expose SQL, provider response bodies or connection details.
      throw new NotificationPushSendResultStoreError()
    }
  }

  return {
    async recordTicket(input: RecordNotificationPushTicketInput) {
      return update(`
        UPDATE social_notification_push_deliveries
           SET status = 'RECEIPT_PENDING',
               expo_ticket_id = $1,
               receipt_poll_count = 0,
               next_attempt_at = $2::timestamptz,
               lease_token = NULL,
               lease_expires_at = NULL,
               last_error_code = NULL,
               updated_at = $3::timestamptz
         WHERE delivery_id = $4
           AND status = 'LEASED'
           AND lease_token = $5
        RETURNING delivery_id
      `, [input.ticketId, input.nextAttemptAt, input.now, input.deliveryId, input.leaseToken])
    },

    async scheduleRetry(input: ScheduleNotificationPushRetryInput) {
      return update(`
        UPDATE social_notification_push_deliveries
           SET status = $1,
               next_attempt_at = $2::timestamptz,
               expo_ticket_id = NULL,
               lease_token = NULL,
               lease_expires_at = NULL,
               last_error_code = $3,
               updated_at = $4::timestamptz
         WHERE delivery_id = $5
           AND status = 'LEASED'
           AND lease_token = $6
        RETURNING delivery_id
      `, [input.status, input.nextAttemptAt, input.errorCode, input.now, input.deliveryId, input.leaseToken])
    },
  }
}
