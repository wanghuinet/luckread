/// <reference types="@cloudflare/workers-types" />

import {
  createD1NotificationPushFanoutStore,
  type NotificationPushFanoutStore,
} from './notification-push-fanout-store.js'

type ActiveEndpointRow = Readonly<{ endpoint_id: string; owner_user_id: string; push_token: string }>

const FANOUT_LIMIT = 25
const ENDPOINT_LIMIT = 20

type PushFanoutDataSource = D1Database | NotificationPushFanoutStore

function resolveNotificationPushFanoutStore(source: PushFanoutDataSource): NotificationPushFanoutStore {
  if (typeof (source as NotificationPushFanoutStore).listPending === 'function') {
    return source as NotificationPushFanoutStore
  }
  return createD1NotificationPushFanoutStore(source as D1Database)
}

/**
 * Fan out W05-owned outbox rows to W09-owned active Expo endpoints.
 * The endpoint database remains the existing W09 D1-03 authority.
 */
export async function fanOutPendingNotifications(
  source: PushFanoutDataSource,
  endpointDb: D1Database,
  now: Date,
): Promise<number> {
  const store = resolveNotificationPushFanoutStore(source)
  const pending = await store.listPending(FANOUT_LIMIT)
  let count = 0
  for (const item of pending) {
    const endpoints = await endpointDb.prepare(
      'SELECT endpoint_id, owner_user_id, push_token FROM notification_push_endpoints ' +
      "WHERE owner_user_id = ? AND provider = 'expo' AND permission_status = 'granted' " +
      'AND push_token IS NOT NULL ORDER BY updated_at DESC LIMIT ?',
    ).bind(item.recipient_user_id, ENDPOINT_LIMIT).all<ActiveEndpointRow>()
    const rows = endpoints.results ?? []
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

