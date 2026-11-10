import {
  NotificationPushDeliveryClaimStoreError,
  type ClaimedNotificationDeliveryCandidate,
  type ClaimDueNotificationDeliveriesInput,
  type CancelClaimedNotificationDeliveryInput,
  type DeliveryClaimNotificationType,
  type DeliveryClaimTargetType,
  type NotificationPushDeliveryClaimStore,
  type SaveNotificationPushTokenHashInput,
} from './notification-push-delivery-claim-store.js'

type D1Rows<Row> = Readonly<{ results?: Row[] | null }>
type D1RunResult = Readonly<{ meta?: Readonly<{ changes?: number }> }>
type D1BoundStatement = Readonly<{
  all<Row>(): Promise<D1Rows<Row>>
  first<Row>(): Promise<Row | null>
  run(): Promise<D1RunResult>
}>
type D1Statement = Readonly<{ bind(...values: unknown[]): D1BoundStatement }>
export interface NotificationPushDeliveryClaimD1Executor {
  prepare(sql: string): D1Statement
}
type CandidateRow = Readonly<{ delivery_id: string; notification_id: string; endpoint_id: string }>
type UpdatedRow = Readonly<{ delivery_id: string; notification_id: string; endpoint_id: string; attempt_count: number }>
type NotificationContextRow = Readonly<{
  recipient_user_id: string
  notification_type: DeliveryClaimNotificationType
  target_type: DeliveryClaimTargetType
  target_id: string
}>

/** Preserves the existing D1 claim sequence until an explicitly authorized production cutover. */
export function createD1NotificationPushDeliveryClaimStore(
  db: NotificationPushDeliveryClaimD1Executor,
): NotificationPushDeliveryClaimStore {
  const update = async (sql: string, values: unknown[]): Promise<boolean> => {
    try {
      const result = await db.prepare(sql).bind(...values).run()
      return Number(result.meta?.changes ?? 0) === 1
    } catch {
      throw new NotificationPushDeliveryClaimStoreError()
    }
  }

  return {
    async claimDue(input: ClaimDueNotificationDeliveriesInput) {
      try {
        await db.prepare(
          "UPDATE social_notification_push_deliveries SET status = 'FAILED', lease_token = NULL, lease_expires_at = NULL, " +
          "last_error_code = 'SEND_LEASE_EXPIRED_MAX_ATTEMPTS', updated_at = ? " +
          "WHERE status = 'LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ? AND attempt_count >= ?",
        ).bind(input.now, input.now, input.maxAttempts).run()

        const candidates = await db.prepare(
          'SELECT delivery_id, notification_id, endpoint_id FROM social_notification_push_deliveries ' +
          "WHERE ((status IN ('PENDING','RETRY') AND next_attempt_at <= ? AND attempt_count < ?) " +
          "OR (status = 'LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ? AND attempt_count < ?)) " +
          'ORDER BY next_attempt_at ASC, created_at ASC, delivery_id ASC LIMIT ?',
        ).bind(input.now, input.maxAttempts, input.now, input.maxAttempts, input.limit)
          .all<CandidateRow>()

        const claimed: ClaimedNotificationDeliveryCandidate[] = []
        for (const candidate of candidates.results ?? []) {
          const leaseToken = crypto.randomUUID()
          const updated = await db.prepare(
            "UPDATE social_notification_push_deliveries SET status = 'LEASED', lease_token = ?, lease_expires_at = ?, " +
            'attempt_count = attempt_count + 1, updated_at = ? WHERE delivery_id = ? AND ' +
            "((status IN ('PENDING','RETRY') AND next_attempt_at <= ? AND attempt_count < ?) " +
            "OR (status = 'LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ? AND attempt_count < ?)) " +
            'RETURNING delivery_id, notification_id, endpoint_id, attempt_count',
          ).bind(
            leaseToken, input.leaseExpiresAt, input.now, candidate.delivery_id,
            input.now, input.maxAttempts, input.now, input.maxAttempts,
          ).first<UpdatedRow>()
          if (!updated) continue

          const notification = await db.prepare(
            'SELECT o.recipient_user_id, n.notification_type, n.target_type, n.target_id ' +
            'FROM social_notification_push_outbox o JOIN social_notifications n ON n.notification_id = o.notification_id ' +
            'WHERE o.notification_id = ? LIMIT 1',
          ).bind(updated.notification_id).first<NotificationContextRow>()

          claimed.push({
            ...updated,
            lease_token: leaseToken,
            recipient_user_id: notification?.recipient_user_id ?? null,
            notification_type: notification?.notification_type ?? null,
            target_type: notification?.target_type ?? null,
            target_id: notification?.target_id ?? null,
          })
        }
        return claimed
      } catch {
        throw new NotificationPushDeliveryClaimStoreError()
      }
    },

    async cancel(input: CancelClaimedNotificationDeliveryInput) {
      return update(
        "UPDATE social_notification_push_deliveries SET status = 'CANCELLED', lease_token = NULL, " +
        "lease_expires_at = NULL, last_error_code = ?, updated_at = ? " +
        "WHERE delivery_id = ? AND status = 'LEASED' AND lease_token = ?",
        [input.reason, input.now, input.deliveryId, input.leaseToken],
      )
    },

    async savePushTokenHash(input: SaveNotificationPushTokenHashInput) {
      return update(
        'UPDATE social_notification_push_deliveries SET push_token_hash = ?, updated_at = ? ' +
        "WHERE delivery_id = ? AND status = 'LEASED' AND lease_token = ?",
        [input.pushTokenHash, input.now, input.deliveryId, input.leaseToken],
      )
    },
  }
}
