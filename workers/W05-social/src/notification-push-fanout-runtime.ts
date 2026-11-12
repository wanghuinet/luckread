/// <reference types="@cloudflare/workers-types" />

import {
  createD1NotificationPushFanoutStore,
  type NotificationPushFanoutStore,
} from './notification-push-fanout-store.js'

import {
  createD1NotificationPushEndpointAccessStore,
  type NotificationPushEndpointAccessStore,
} from './notification-push-endpoint-access-store-d1.js'

const FANOUT_LIMIT = 25
const ENDPOINT_LIMIT = 20

type EndpointAccessSource = D1Database | NotificationPushEndpointAccessStore

function resolveNotificationPushEndpointAccessStore(
  source: EndpointAccessSource,
): NotificationPushEndpointAccessStore {
  if (
    typeof (source as NotificationPushEndpointAccessStore).listActiveForRecipient === 'function' &&
    typeof (source as NotificationPushEndpointAccessStore).findEndpointForOwner === 'function' &&
    typeof (source as NotificationPushEndpointAccessStore).clearTokenIfMatches === 'function'
  ) return source as NotificationPushEndpointAccessStore
  return createD1NotificationPushEndpointAccessStore(source as D1Database)
}

type PushFanoutDataSource = D1Database | NotificationPushFanoutStore

function resolveNotificationPushFanoutStore(source: PushFanoutDataSource): NotificationPushFanoutStore {
  if (typeof (source as NotificationPushFanoutStore).listPending === 'function') {
    return source as NotificationPushFanoutStore
  }
  return createD1NotificationPushFanoutStore(source as D1Database)
}

/**
 * Fan out W05-owned outbox rows to W09-owned active Expo endpoints.
 * W09 remains the D1-03 endpoint authority; D1 is the default until cutover.
 */
export async function fanOutPendingNotifications(
  source: PushFanoutDataSource,
  endpointSource: EndpointAccessSource,
  now: Date,
): Promise<number> {
  const store = resolveNotificationPushFanoutStore(source)
  const endpointStore = resolveNotificationPushEndpointAccessStore(endpointSource)
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

