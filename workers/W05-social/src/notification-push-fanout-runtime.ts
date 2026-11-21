/// <reference types="@cloudflare/workers-types" />

import type { NotificationPushFanoutStore } from './notification-push-fanout-store.js'
import type { NotificationPushEndpointAccessStore } from './notification-push-endpoint-access-store.js'

const FANOUT_LIMIT = 25
const ENDPOINT_LIMIT = 20

/**
 * Fan out W05-owned outbox rows to W09-owned active Expo endpoints.
 * W09 remains the owner of endpoint state; W05 uses the scoped Neon access port.
 */
export async function fanOutPendingNotifications(
  store: NotificationPushFanoutStore,
  endpointStore: NotificationPushEndpointAccessStore,
  now: Date,
): Promise<number> {
  const pending = await store.listPending(FANOUT_LIMIT)
  let count = 0
  for (const item of pending) {
    const rows = await endpointStore.listActiveForRecipient(item.recipient_user_id, ENDPOINT_LIMIT)
    const nowIso = now.toISOString()

    if (rows.length === 0) {
      await store.markNoEndpoint(item.notification_id, nowIso)
      continue
    }

    await store.fanOut({
      notificationId: item.notification_id,
      deliveries: rows.map(endpoint => ({
        delivery_id: crypto.randomUUID(),
        endpoint_id: endpoint.endpoint_id,
      })),
      endpointCount: rows.length,
      now: nowIso,
    })
    count += 1
  }
  return count
}

