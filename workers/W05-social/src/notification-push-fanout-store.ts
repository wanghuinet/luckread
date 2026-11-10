export type PendingPushOutboxRow = Readonly<{
  notification_id: string
  recipient_user_id: string
}>

export type PushFanoutDeliveryInput = Readonly<{
  delivery_id: string
  endpoint_id: string
}>

export type NotificationPushFanoutStore = Readonly<{
  listPending(limit: number): Promise<readonly PendingPushOutboxRow[]>
  markNoEndpoint(notificationId: string, now: string): Promise<void>
  fanOut(input: Readonly<{
    notificationId: string
    deliveries: readonly PushFanoutDeliveryInput[]
    endpointCount: number
    now: string
  }>): Promise<void>
}>

export class NotificationPushFanoutStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('NOTIFICATION_PUSH_FANOUT_UNAVAILABLE')
    this.name = 'NotificationPushFanoutStoreError'
  }
}

type D1Result<Row> = Readonly<{ results?: Row[] | null }>
type D1BoundStatement = Readonly<{
  all<Row>(): Promise<D1Result<Row>>
  run(): Promise<unknown>
}>
type D1Statement = Readonly<{
  bind(...values: unknown[]): D1BoundStatement
}>

export interface NotificationPushFanoutD1Executor {
  prepare(sql: string): D1Statement
  batch(statements: D1BoundStatement[]): Promise<unknown[]>
}

/** D1 remains the production adapter until an explicitly authorized cutover. */
export function createD1NotificationPushFanoutStore(
  db: NotificationPushFanoutD1Executor,
): NotificationPushFanoutStore {
  return {
    async listPending(limit) {
      try {
        const result = await db.prepare(
          'SELECT notification_id, recipient_user_id FROM social_notification_push_outbox ' +
          "WHERE status = 'PENDING' ORDER BY created_at ASC, notification_id ASC LIMIT ?",
        ).bind(limit).all<PendingPushOutboxRow>()
        return result.results ?? []
      } catch {
        throw new NotificationPushFanoutStoreError()
      }
    },

    async markNoEndpoint(notificationId, now) {
      try {
        await db.prepare(
          "UPDATE social_notification_push_outbox SET status = 'NO_ENDPOINT', endpoint_count = 0, updated_at = ? " +
          "WHERE notification_id = ? AND status = 'PENDING'",
        ).bind(now, notificationId).run()
      } catch {
        throw new NotificationPushFanoutStoreError()
      }
    },

    async fanOut(input) {
      if (input.deliveries.length === 0) return
      const statements = input.deliveries.map((delivery) => db.prepare(
        "INSERT OR IGNORE INTO social_notification_push_deliveries " +
        "(delivery_id, notification_id, endpoint_id, status, attempt_count, receipt_poll_count, next_attempt_at, created_at, updated_at) " +
        "VALUES (?, ?, ?, 'PENDING', 0, 0, ?, ?, ?)",
      ).bind(
        delivery.delivery_id,
        input.notificationId,
        delivery.endpoint_id,
        input.now,
        input.now,
        input.now,
      ))
      statements.push(db.prepare(
        "UPDATE social_notification_push_outbox SET status = 'FANNED_OUT', endpoint_count = ?, updated_at = ? " +
        "WHERE notification_id = ? AND status = 'PENDING'",
      ).bind(input.endpointCount, input.now, input.notificationId))
      try {
        // D1 batch is atomic: delivery rows and outbox state move together.
        await db.batch(statements)
      } catch {
        throw new NotificationPushFanoutStoreError()
      }
    },
  }
}
