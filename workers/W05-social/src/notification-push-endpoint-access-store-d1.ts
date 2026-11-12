import {
  NotificationPushEndpointAccessStoreError,
  type ActiveNotificationPushEndpoint,
  type ClearInvalidNotificationPushTokenInput,
  type NotificationPushEndpointAccessRow,
  type NotificationPushEndpointAccessStore,
} from './notification-push-endpoint-access-store.js'

type D1Result<Row> = Readonly<{ results?: Row[] | null }>
type D1RunResult = Readonly<{ meta?: Readonly<{ changes?: number }> }>
type D1BoundStatement = Readonly<{
  all<Row>(): Promise<D1Result<Row>>
  first<Row>(): Promise<Row | null>
  run(): Promise<D1RunResult>
}>
type D1Statement = Readonly<{ bind(...values: unknown[]): D1BoundStatement }>

export interface NotificationPushEndpointAccessD1Executor {
  prepare(sql: string): D1Statement
}

const boundedLimit = (limit: number): number =>
  Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 20) : 20

/** D1 remains the runtime default until an explicitly authorized cutover. */
export function createD1NotificationPushEndpointAccessStore(
  db: NotificationPushEndpointAccessD1Executor,
): NotificationPushEndpointAccessStore {
  return {
    async listActiveForRecipient(recipientUserId: string, limit: number) {
      try {
        const result = await db.prepare(
          "SELECT endpoint_id, owner_user_id, push_token FROM notification_push_endpoints " +
          "WHERE owner_user_id = ? AND provider = 'expo' AND permission_status = 'granted' " +
          "AND push_token IS NOT NULL ORDER BY updated_at DESC LIMIT ?",
        ).bind(recipientUserId, boundedLimit(limit)).all<ActiveNotificationPushEndpoint>()
        return result.results ?? []
      } catch {
        throw new NotificationPushEndpointAccessStoreError()
      }
    },

    async findEndpointForOwner(endpointId: string, ownerUserId: string) {
      try {
        return await db.prepare(
          "SELECT endpoint_id, owner_user_id, push_token, permission_status " +
          "FROM notification_push_endpoints WHERE endpoint_id = ? AND owner_user_id = ? " +
          "AND provider = 'expo' LIMIT ?",
        ).bind(endpointId, ownerUserId, 1).first<NotificationPushEndpointAccessRow>()
      } catch {
        throw new NotificationPushEndpointAccessStoreError()
      }
    },

    async clearTokenIfMatches(input: ClearInvalidNotificationPushTokenInput) {
      try {
        const result = await db.prepare(
          "UPDATE notification_push_endpoints SET permission_status = 'undetermined', push_token = NULL, " +
          "updated_at = ? WHERE endpoint_id = ? AND owner_user_id = ? AND provider = 'expo' " +
          "AND permission_status = 'granted' AND push_token = ?",
        ).bind(
          input.now,
          input.endpointId,
          input.ownerUserId,
          input.expectedPushToken,
        ).run()
        return Number(result.meta?.changes ?? 0) === 1
      } catch {
        throw new NotificationPushEndpointAccessStoreError()
      }
    },
  }
}
