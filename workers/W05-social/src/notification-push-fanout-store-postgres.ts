import {
  NotificationPushFanoutStoreError,
  type NotificationPushFanoutStore,
  type PendingPushOutboxRow,
  type PushFanoutDeliveryInput,
} from './notification-push-fanout-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no Node driver is bundled into W05 Worker code. */
export interface NotificationPushFanoutPostgresExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/** PostgreSQL fan-out uses one statement so inbox delivery creation and outbox transition are atomic. */
export function createPostgresNotificationPushFanoutStore(
  db: NotificationPushFanoutPostgresExecutor,
): NotificationPushFanoutStore {
  const query = async <Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[],
  ): Promise<Row[]> => {
    try {
      const result = await db.query<Row>(sql, values)
      return result.rows
    } catch {
      // Never expose driver messages, SQL text or connection metadata.
      throw new NotificationPushFanoutStoreError()
    }
  }

  return {
    async listPending(limit: number) {
      return query<PendingPushOutboxRow>(`
        SELECT notification_id, recipient_user_id
          FROM social_notification_push_outbox
         WHERE status = 'PENDING'
         ORDER BY created_at ASC, notification_id ASC
         LIMIT $1
      `, [limit])
    },

    async markNoEndpoint(notificationId: string, now: string) {
      await query(`
        UPDATE social_notification_push_outbox
           SET status = 'NO_ENDPOINT', endpoint_count = 0, updated_at = $2::timestamptz
         WHERE notification_id = $1
           AND status = 'PENDING'
        RETURNING notification_id
      `, [notificationId, now])
    },

    async fanOut(input: Readonly<{
      notificationId: string
      deliveries: readonly PushFanoutDeliveryInput[]
      endpointCount: number
      now: string
    }>) {
      if (input.deliveries.length === 0) return
      const deliveryIds = input.deliveries.map(item => item.delivery_id)
      const endpointIds = input.deliveries.map(item => item.endpoint_id)
      await query(`
        WITH eligible AS MATERIALIZED (
          SELECT notification_id
            FROM social_notification_push_outbox
           WHERE notification_id = $1
             AND status = 'PENDING'
           FOR UPDATE
        ),
        inserted AS (
          INSERT INTO social_notification_push_deliveries (
            delivery_id,
            notification_id,
            endpoint_id,
            status,
            attempt_count,
            receipt_poll_count,
            next_attempt_at,
            created_at,
            updated_at
          )
          SELECT
            requested.delivery_id,
            eligible.notification_id,
            requested.endpoint_id,
            'PENDING',
            0,
            0,
            $2::timestamptz,
            $2::timestamptz,
            $2::timestamptz
          FROM eligible
          CROSS JOIN unnest($3::text[], $4::text[]) AS requested(delivery_id, endpoint_id)
          ON CONFLICT (notification_id, endpoint_id) DO NOTHING
          RETURNING delivery_id
        ),
        updated AS (
          UPDATE social_notification_push_outbox outbox
             SET status = 'FANNED_OUT',
                 endpoint_count = $5,
                 updated_at = $2::timestamptz
            FROM eligible
           WHERE outbox.notification_id = eligible.notification_id
             AND outbox.status = 'PENDING'
          RETURNING outbox.notification_id
        )
        SELECT
          (SELECT count(*)::int FROM inserted) AS inserted_count,
          (SELECT count(*)::int FROM updated) AS transitioned_count
      `, [
        input.notificationId,
        input.now,
        deliveryIds,
        endpointIds,
        input.endpointCount,
      ])
    },
  }
}
