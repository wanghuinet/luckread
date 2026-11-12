import {
  NotificationPushEndpointAccessStoreError,
  type ActiveNotificationPushEndpoint,
  type ClearInvalidNotificationPushTokenInput,
  type NotificationPushEndpointAccessRow,
  type NotificationPushEndpointAccessStore,
} from './notification-push-endpoint-access-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no Node driver is bundled into W05 Worker code. */
export interface NotificationPushEndpointAccessPostgresExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

const boundedLimit = (limit: number): number =>
  Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 20) : 20

/** W05's NOTIFY-003 delegate for the W09-owned D1-03 endpoint registry. */
export function createPostgresNotificationPushEndpointAccessStore(
  db: NotificationPushEndpointAccessPostgresExecutor,
): NotificationPushEndpointAccessStore {
  const query = async <Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[],
  ): Promise<Row[]> => {
    try {
      return (await db.query<Row>(sql, values)).rows
    } catch {
      // Endpoint tokens, SQL and provider/connection diagnostics stay private.
      throw new NotificationPushEndpointAccessStoreError()
    }
  }

  return {
    async listActiveForRecipient(recipientUserId: string, limit: number) {
      return query<ActiveNotificationPushEndpoint>(`
        SELECT endpoint_id, owner_user_id, push_token
          FROM notification_push_endpoints
         WHERE owner_user_id = $1
           AND provider = 'expo'
           AND permission_status = 'granted'
           AND push_token IS NOT NULL
         ORDER BY updated_at DESC
         LIMIT $2
      `, [recipientUserId, boundedLimit(limit)])
    },

    async findEndpointForOwner(endpointId: string, ownerUserId: string) {
      const rows = await query<NotificationPushEndpointAccessRow>(`
        SELECT endpoint_id, owner_user_id, push_token, permission_status
          FROM notification_push_endpoints
         WHERE endpoint_id = $1
           AND owner_user_id = $2
           AND provider = 'expo'
         LIMIT 1
      `, [endpointId, ownerUserId])
      return rows[0] ?? null
    },

    async clearTokenIfMatches(input: ClearInvalidNotificationPushTokenInput) {
      const rows = await query<{ endpoint_id: string }>(`
        UPDATE notification_push_endpoints
           SET permission_status = 'undetermined',
               push_token = NULL,
               updated_at = $1::timestamptz
         WHERE endpoint_id = $2
           AND owner_user_id = $3
           AND provider = 'expo'
           AND permission_status = 'granted'
           AND push_token = $4
        RETURNING endpoint_id
      `, [input.now, input.endpointId, input.ownerUserId, input.expectedPushToken])
      return rows.length === 1
    },
  }
}
