import {
  NotificationPushDeliveryClaimStoreError,
  type ClaimedNotificationDeliveryCandidate,
  type ClaimDueNotificationDeliveriesInput,
  type CancelClaimedNotificationDeliveryInput,
  type NotificationPushDeliveryClaimStore,
  type SaveNotificationPushTokenHashInput,
} from './notification-push-delivery-claim-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>
export interface NotificationPushDeliveryClaimPostgresExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/** One atomic claim statement serializes concurrent senders with FOR UPDATE SKIP LOCKED. */
export function createPostgresNotificationPushDeliveryClaimStore(
  db: NotificationPushDeliveryClaimPostgresExecutor,
): NotificationPushDeliveryClaimStore {
  const query = async <Row extends Record<string, unknown>>(sql: string, values: unknown[]): Promise<Row[]> => {
    try {
      return (await db.query<Row>(sql, values)).rows
    } catch {
      throw new NotificationPushDeliveryClaimStoreError()
    }
  }
  const update = async (sql: string, values: unknown[]): Promise<boolean> =>
    (await query<{ delivery_id: string }>(sql, values)).length === 1

  return {
    async claimDue(input: ClaimDueNotificationDeliveriesInput) {
      return query<ClaimedNotificationDeliveryCandidate>(`
        WITH expired_max_attempts AS (
          UPDATE social_notification_push_deliveries
             SET status = 'FAILED',
                 lease_token = NULL,
                 lease_expires_at = NULL,
                 last_error_code = 'SEND_LEASE_EXPIRED_MAX_ATTEMPTS',
                 updated_at = $3::timestamptz
           WHERE status = 'LEASED'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at <= $3::timestamptz
             AND attempt_count >= $2
          RETURNING delivery_id
        ),
        candidates AS MATERIALIZED (
          SELECT delivery.delivery_id
            FROM social_notification_push_deliveries delivery
           WHERE (
             (delivery.status IN ('PENDING', 'RETRY')
               AND delivery.next_attempt_at <= $3::timestamptz
               AND delivery.attempt_count < $2)
             OR
             (delivery.status = 'LEASED'
               AND delivery.lease_expires_at IS NOT NULL
               AND delivery.lease_expires_at <= $3::timestamptz
               AND delivery.attempt_count < $2)
           )
           ORDER BY delivery.next_attempt_at ASC, delivery.created_at ASC, delivery.delivery_id ASC
           LIMIT $1
           FOR UPDATE OF delivery SKIP LOCKED
        ),
        claimed AS (
          UPDATE social_notification_push_deliveries delivery
             SET status = 'LEASED',
                 lease_token = gen_random_uuid()::text,
                 lease_expires_at = $4::timestamptz,
                 attempt_count = delivery.attempt_count + 1,
                 updated_at = $3::timestamptz
            FROM candidates
           WHERE delivery.delivery_id = candidates.delivery_id
          RETURNING
            delivery.delivery_id,
            delivery.notification_id,
            delivery.endpoint_id,
            delivery.lease_token,
            delivery.attempt_count
        )
        SELECT
          claimed.delivery_id,
          claimed.notification_id,
          claimed.endpoint_id,
          claimed.lease_token,
          claimed.attempt_count,
          outbox.recipient_user_id,
          notification.notification_type,
          notification.target_type,
          notification.target_id
        FROM claimed
        LEFT JOIN social_notification_push_outbox outbox
          ON outbox.notification_id = claimed.notification_id
        LEFT JOIN social_notifications notification
          ON notification.notification_id = claimed.notification_id
        ORDER BY claimed.delivery_id
      `, [input.limit, input.maxAttempts, input.now, input.leaseExpiresAt])
    },

    async cancel(input: CancelClaimedNotificationDeliveryInput) {
      return update(`
        UPDATE social_notification_push_deliveries
           SET status = 'CANCELLED',
               lease_token = NULL,
               lease_expires_at = NULL,
               last_error_code = $1,
               updated_at = $2::timestamptz
         WHERE delivery_id = $3
           AND status = 'LEASED'
           AND lease_token = $4
        RETURNING delivery_id
      `, [input.reason, input.now, input.deliveryId, input.leaseToken])
    },

    async savePushTokenHash(input: SaveNotificationPushTokenHashInput) {
      return update(`
        UPDATE social_notification_push_deliveries
           SET push_token_hash = $1,
               updated_at = $2::timestamptz
         WHERE delivery_id = $3
           AND status = 'LEASED'
           AND lease_token = $4
        RETURNING delivery_id
      `, [input.pushTokenHash, input.now, input.deliveryId, input.leaseToken])
    },
  }
}
