/// <reference types="@cloudflare/workers-types" />
import Expo, { type ExpoPushMessage, type ExpoPushReceipt, type ExpoPushTicket } from 'expo-server-sdk'

export interface NotificationPushDeliveryEnv {
  readonly DB: D1Database
  readonly D1_03?: D1Database
  readonly PUSH_DELIVERY_ENABLED?: string
  readonly EXPO_ACCESS_TOKEN?: string
}

type ActiveEndpointRow = Readonly<{ endpoint_id: string; owner_user_id: string; push_token: string }>
type ClaimedDelivery = Readonly<{
  deliveryId: string; notificationId: string; endpointId: string; recipientUserId: string
  pushToken: string; notificationType: 'FOLLOW' | 'LIKE' | 'COMMENT' | 'REPLY' | 'MENTION'
  targetType: 'user' | 'content' | 'comment'; targetId: string; leaseToken: string; attemptCount: number
}>
type ClaimedReceipt = Readonly<{
  deliveryId: string; notificationId: string; endpointId: string; recipientUserId: string
  expoTicketId: string; leaseToken: string; attemptCount: number; receiptPollCount: number; pushTokenHash: string
}>
export type NotificationPushBatchResult = Readonly<{
  status: 'COMPLETED' | 'DISABLED'; fannedOut: number; sent: number; delivered: number
  retried: number; failed: number; skipped: number
}>

const FANOUT_LIMIT = 25
const DELIVERY_LIMIT = 100
const RECEIPT_LIMIT = 300
const ENDPOINT_LIMIT = 20
const MAX_SEND_ATTEMPTS = 6
const LEASE_SECONDS = 180
const RECEIPT_DELAY_SECONDS = 15 * 60
const RECEIPT_RETRY_SECONDS = 5 * 60
const isoAfter = (now: Date, seconds: number) => new Date(now.getTime() + seconds * 1000).toISOString()
async function hashPushToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

export function calculatePushRetryDelaySeconds(attemptCount: number): number {
  const attempt = Number.isSafeInteger(attemptCount) && attemptCount > 0 ? attemptCount : 1
  return Math.min(3600, 30 * (2 ** Math.min(attempt - 1, 7)))
}

export function isRetryableExpoError(errorCode: string): boolean {
  return ['MessageRateExceeded', 'InternalServerError', 'ExpoServerError', 'ServiceUnavailable', 'NetworkError'].includes(errorCode)
}

export function notificationPushMessage(task: Pick<ClaimedDelivery,
  'notificationId' | 'pushToken' | 'notificationType' | 'targetType' | 'targetId'
>): ExpoPushMessage {
  const copy: Record<ClaimedDelivery['notificationType'], string> = {
    FOLLOW: '有人关注了你',
    LIKE: '有人赞了你的内容',
    COMMENT: '有人评论了你的内容',
    REPLY: '有人回复了你',
    MENTION: '有人提及了你',
  }
  return {
    to: task.pushToken,
    title: 'LuckRead',
    body: copy[task.notificationType],
    sound: 'default',
    priority: 'high',
    channelId: 'default',
    collapseId: task.notificationId,
    data: {
      notificationId: task.notificationId,
      type: task.notificationType,
      targetType: task.targetType,
      targetId: task.targetId,
    },
  }
}

async function fanOutPendingNotifications(db: D1Database, endpointDb: D1Database, now: Date): Promise<number> {
  const pending = await db.prepare(
    'SELECT notification_id, recipient_user_id FROM social_notification_push_outbox ' +
    "WHERE status = 'PENDING' ORDER BY created_at ASC, notification_id ASC LIMIT ?",
  ).bind(FANOUT_LIMIT).all<{ notification_id: string; recipient_user_id: string }>()

  let count = 0
  for (const item of pending.results ?? []) {
    const endpoints = await endpointDb.prepare(
      'SELECT endpoint_id, owner_user_id, push_token FROM notification_push_endpoints ' +
      "WHERE owner_user_id = ? AND provider = 'expo' AND permission_status = 'granted' " +
      'AND push_token IS NOT NULL ORDER BY updated_at DESC LIMIT ?',
    ).bind(item.recipient_user_id, ENDPOINT_LIMIT).all<ActiveEndpointRow>()
    const rows = endpoints.results ?? []
    const nowIso = now.toISOString()

    if (rows.length === 0) {
      await db.prepare(
        "UPDATE social_notification_push_outbox SET status = 'NO_ENDPOINT', endpoint_count = 0, updated_at = ? " +
        "WHERE notification_id = ? AND status = 'PENDING'",
      ).bind(nowIso, item.notification_id).run()
      continue
    }

    const statements = rows.map((endpoint) => db.prepare(
      "INSERT OR IGNORE INTO social_notification_push_deliveries " +
      "(delivery_id, notification_id, endpoint_id, status, attempt_count, receipt_poll_count, next_attempt_at, created_at, updated_at) " +
      "VALUES (?, ?, ?, 'PENDING', 0, 0, ?, ?, ?)",
    ).bind(crypto.randomUUID(), item.notification_id, endpoint.endpoint_id, nowIso, nowIso, nowIso))
    statements.push(db.prepare(
      "UPDATE social_notification_push_outbox SET status = 'FANNED_OUT', endpoint_count = ?, updated_at = ? " +
      "WHERE notification_id = ? AND status = 'PENDING'",
    ).bind(rows.length, nowIso, item.notification_id))
    await db.batch(statements)
    count += 1
  }
  return count
}

async function claimDueDeliveries(db: D1Database, endpointDb: D1Database, now: Date): Promise<ClaimedDelivery[]> {
  const nowIso = now.toISOString()
  const candidates = await db.prepare(
    'SELECT delivery_id, notification_id, endpoint_id FROM social_notification_push_deliveries ' +
    "WHERE ((status IN ('PENDING','RETRY') AND next_attempt_at <= ?) " +
    "OR (status = 'LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)) " +
    'ORDER BY next_attempt_at ASC, created_at ASC LIMIT ?',
  ).bind(nowIso, nowIso, DELIVERY_LIMIT).all<{ delivery_id: string; notification_id: string; endpoint_id: string }>()

  const claimed: ClaimedDelivery[] = []
  for (const candidate of candidates.results ?? []) {
    const leaseToken = crypto.randomUUID()
    const updated = await db.prepare(
      "UPDATE social_notification_push_deliveries SET status = 'LEASED', lease_token = ?, lease_expires_at = ?, " +
      'attempt_count = attempt_count + 1, updated_at = ? WHERE delivery_id = ? AND ' +
      "((status IN ('PENDING','RETRY') AND next_attempt_at <= ?) " +
      "OR (status = 'LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)) " +
      'RETURNING delivery_id, notification_id, endpoint_id, attempt_count',
    ).bind(leaseToken, isoAfter(now, LEASE_SECONDS), nowIso, candidate.delivery_id, nowIso, nowIso)
      .first<{ delivery_id: string; notification_id: string; endpoint_id: string; attempt_count: number }>()
    if (!updated) continue

    const notification = await db.prepare(
      'SELECT o.recipient_user_id, n.notification_type, n.target_type, n.target_id ' +
      'FROM social_notification_push_outbox o JOIN social_notifications n ON n.notification_id = o.notification_id ' +
      'WHERE o.notification_id = ? LIMIT 1',
    ).bind(updated.notification_id).first<{
      recipient_user_id: string
      notification_type: ClaimedDelivery['notificationType']
      target_type: ClaimedDelivery['targetType']
      target_id: string
    }>()

    if (!notification) {
      await db.prepare(
        "UPDATE social_notification_push_deliveries SET status = 'CANCELLED', lease_token = NULL, lease_expires_at = NULL, " +
        "last_error_code = 'NOTIFICATION_NOT_FOUND', updated_at = ? WHERE delivery_id = ? AND lease_token = ?",
      ).bind(nowIso, updated.delivery_id, leaseToken).run()
      continue
    }

    const endpoint = await endpointDb.prepare(
      "SELECT endpoint_id, owner_user_id, push_token FROM notification_push_endpoints " +
      "WHERE endpoint_id = ? AND owner_user_id = ? AND provider = 'expo' " +
      "AND permission_status = 'granted' AND push_token IS NOT NULL LIMIT 1",
    ).bind(updated.endpoint_id, notification.recipient_user_id).first<ActiveEndpointRow>()

    if (!endpoint) {
      await db.prepare(
        "UPDATE social_notification_push_deliveries SET status = 'CANCELLED', lease_token = NULL, lease_expires_at = NULL, " +
        "last_error_code = 'ENDPOINT_NOT_ACTIVE', updated_at = ? WHERE delivery_id = ? AND lease_token = ?",
      ).bind(nowIso, updated.delivery_id, leaseToken).run()
      continue
    }

    const pushTokenHash = await hashPushToken(endpoint.push_token)
    const tokenSnapshotSaved = await db.prepare(
      'UPDATE social_notification_push_deliveries SET push_token_hash = ?, updated_at = ? WHERE delivery_id = ? AND status = ? AND lease_token = ?',
    ).bind(pushTokenHash, nowIso, updated.delivery_id, 'LEASED', leaseToken).run()
    if (Number(tokenSnapshotSaved.meta?.changes ?? 0) !== 1) continue

    claimed.push({
      deliveryId: updated.delivery_id,
      notificationId: updated.notification_id,
      endpointId: updated.endpoint_id,
      recipientUserId: notification.recipient_user_id,
      pushToken: endpoint.push_token,
      notificationType: notification.notification_type,
      targetType: notification.target_type,
      targetId: notification.target_id,
      leaseToken,
      attemptCount: updated.attempt_count,
    })
  }
  return claimed
}

async function deactivateInvalidEndpoint(endpointDb: D1Database, task: ClaimedDelivery, now: Date): Promise<void> {
  await endpointDb.prepare(
    "UPDATE notification_push_endpoints SET permission_status = 'undetermined', push_token = NULL, " +
    'updated_at = ?, last_seen_at = ? WHERE endpoint_id = ? AND owner_user_id = ? ' +
    "AND provider = 'expo' AND push_token = ?",
  ).bind(now.toISOString(), now.toISOString(), task.endpointId, task.recipientUserId, task.pushToken).run()
}

async function scheduleDeliveryRetry(
  db: D1Database, task: ClaimedDelivery, now: Date, errorCode: string,
): Promise<'retried' | 'failed'> {
  const canRetry = isRetryableExpoError(errorCode) && task.attemptCount < MAX_SEND_ATTEMPTS
  const status = canRetry ? 'RETRY' : 'FAILED'
  await db.prepare(
    'UPDATE social_notification_push_deliveries SET status = ?, next_attempt_at = ?, expo_ticket_id = NULL, ' +
    'lease_token = NULL, lease_expires_at = NULL, last_error_code = ?, updated_at = ? ' +
    "WHERE delivery_id = ? AND status = 'LEASED' AND lease_token = ?",
  ).bind(
    status,
    canRetry ? isoAfter(now, calculatePushRetryDelaySeconds(task.attemptCount)) : now.toISOString(),
    errorCode,
    now.toISOString(),
    task.deliveryId,
    task.leaseToken,
  ).run()
  return canRetry ? 'retried' : 'failed'
}

async function recordPushTicket(
  db: D1Database, endpointDb: D1Database, task: ClaimedDelivery, ticket: PushTicketLike, now: Date,
): Promise<'sent' | 'retried' | 'failed'> {
  if (ticket.status === 'ok' && typeof ticket.id === 'string' && ticket.id.trim()) {
    await db.prepare(
      "UPDATE social_notification_push_deliveries SET status = 'RECEIPT_PENDING', expo_ticket_id = ?, " +
      'next_attempt_at = ?, lease_token = NULL, lease_expires_at = NULL, last_error_code = NULL, updated_at = ? ' +
      "WHERE delivery_id = ? AND status = 'LEASED' AND lease_token = ?",
    ).bind(ticket.id, isoAfter(now, RECEIPT_DELAY_SECONDS), now.toISOString(), task.deliveryId, task.leaseToken).run()
    return 'sent'
  }
  const errorCode = ticket.status === 'error' ? String(ticket.details?.error ?? 'EXPO_TICKET_ERROR') : 'EXPO_TICKET_INVALID'
  if (errorCode === 'DeviceNotRegistered') await deactivateInvalidEndpoint(endpointDb, task, now)
  return scheduleDeliveryRetry(db, task, now, errorCode)
}

async function claimDueReceipts(db: D1Database, now: Date): Promise<ClaimedReceipt[]> {
  const nowIso = now.toISOString()
  const candidates = await db.prepare(
    "SELECT delivery_id, notification_id, endpoint_id, expo_ticket_id FROM social_notification_push_deliveries " +
    "WHERE ((status = 'RECEIPT_PENDING' AND expo_ticket_id IS NOT NULL AND next_attempt_at <= ?) " +
    "OR (status = 'RECEIPT_LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)) " +
    'ORDER BY next_attempt_at ASC, created_at ASC LIMIT ?',
  ).bind(nowIso, nowIso, RECEIPT_LIMIT).all<{
    delivery_id: string; notification_id: string; endpoint_id: string; expo_ticket_id: string
  }>()

  const claimed: ClaimedReceipt[] = []
  for (const candidate of candidates.results ?? []) {
    const leaseToken = crypto.randomUUID()
    const row = await db.prepare(
      "UPDATE social_notification_push_deliveries SET status = 'RECEIPT_LEASED', lease_token = ?, " +
      'lease_expires_at = ?, receipt_poll_count = receipt_poll_count + 1, updated_at = ? ' +
      "WHERE delivery_id = ? AND ((status = 'RECEIPT_PENDING' AND next_attempt_at <= ?) " +
      "OR (status = 'RECEIPT_LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)) " +
      'RETURNING delivery_id, notification_id, endpoint_id, expo_ticket_id, attempt_count, receipt_poll_count, push_token_hash',
    ).bind(leaseToken, isoAfter(now, LEASE_SECONDS), nowIso, candidate.delivery_id, nowIso, nowIso).first<{
      delivery_id: string; notification_id: string; endpoint_id: string; expo_ticket_id: string
      attempt_count: number; receipt_poll_count: number; push_token_hash: string | null
    }>()
    if (!row) continue
    const owner = await db.prepare(
      'SELECT recipient_user_id FROM social_notification_push_outbox WHERE notification_id = ? LIMIT 1',
    ).bind(row.notification_id).first<{ recipient_user_id: string }>()
    if (!owner) {
      await db.prepare(
        "UPDATE social_notification_push_deliveries SET status = 'CANCELLED', lease_token = NULL, lease_expires_at = NULL, " +
        "last_error_code = 'OUTBOX_NOT_FOUND', updated_at = ? WHERE delivery_id = ? AND lease_token = ?",
      ).bind(nowIso, row.delivery_id, leaseToken).run()
      continue
    }
    claimed.push({
      deliveryId: row.delivery_id,
      notificationId: row.notification_id,
      endpointId: row.endpoint_id,
      recipientUserId: owner.recipient_user_id,
      expoTicketId: row.expo_ticket_id,
      leaseToken,
      attemptCount: row.attempt_count,
      receiptPollCount: row.receipt_poll_count,
      pushTokenHash: row.push_token_hash ?? '',
    })
  }
  return claimed
}

async function applyReceipt(
  db: D1Database, endpointDb: D1Database, task: ClaimedReceipt, receipt: PushReceiptLike | undefined, now: Date,
): Promise<'delivered' | 'retried' | 'failed' | 'pending'> {
  if (!receipt) {
    if (task.receiptPollCount >= MAX_RECEIPT_POLLS) {
      await db.prepare(
        "UPDATE social_notification_push_deliveries SET status = 'FAILED', lease_token = NULL, lease_expires_at = NULL, " +
        "last_error_code = 'RECEIPT_TIMEOUT', updated_at = ? WHERE delivery_id = ? AND status = 'RECEIPT_LEASED' AND lease_token = ?",
      ).bind(now.toISOString(), task.deliveryId, task.leaseToken).run()
      return 'failed'
    }
    await db.prepare(
      "UPDATE social_notification_push_deliveries SET status = 'RECEIPT_PENDING', next_attempt_at = ?, " +
      "lease_token = NULL, lease_expires_at = NULL, last_error_code = 'RECEIPT_NOT_READY', updated_at = ? " +
      "WHERE delivery_id = ? AND status = 'RECEIPT_LEASED' AND lease_token = ?",
    ).bind(isoAfter(now, RECEIPT_RETRY_SECONDS), now.toISOString(), task.deliveryId, task.leaseToken).run()
    return 'pending'
  }

  if (receipt.status === 'ok') {
    await db.prepare(
      "UPDATE social_notification_push_deliveries SET status = 'DELIVERED', lease_token = NULL, " +
      "lease_expires_at = NULL, last_error_code = NULL, updated_at = ? " +
      "WHERE delivery_id = ? AND status = 'RECEIPT_LEASED' AND lease_token = ?",
    ).bind(now.toISOString(), task.deliveryId, task.leaseToken).run()
    return 'delivered'
  }

  const errorCode = String(receipt.details?.error ?? 'EXPO_RECEIPT_ERROR')
  if (errorCode === 'DeviceNotRegistered' && task.pushTokenHash) {
    const endpoint = await endpointDb.prepare(
      'SELECT push_token FROM notification_push_endpoints WHERE endpoint_id = ? AND owner_user_id = ? AND provider = ? LIMIT 1',
    ).bind(task.endpointId, task.recipientUserId, 'expo').first<{ push_token: string | null }>()
    if (endpoint?.push_token && await hashPushToken(endpoint.push_token) === task.pushTokenHash) {
      await endpointDb.prepare(
        "UPDATE notification_push_endpoints SET permission_status = 'undetermined', push_token = NULL, " +
        'updated_at = ?, last_seen_at = ? WHERE endpoint_id = ? AND owner_user_id = ? AND provider = ? AND push_token = ?',
      ).bind(now.toISOString(), now.toISOString(), task.endpointId, task.recipientUserId, 'expo', endpoint.push_token).run()
    }
  }
  const canRetry = isRetryableExpoError(errorCode) && task.attemptCount < MAX_SEND_ATTEMPTS
  const status = canRetry ? 'RETRY' : 'FAILED'
  await db.prepare(
    'UPDATE social_notification_push_deliveries SET status = ?, next_attempt_at = ?, expo_ticket_id = NULL, ' +
    'lease_token = NULL, lease_expires_at = NULL, last_error_code = ?, updated_at = ? ' +
    "WHERE delivery_id = ? AND status = 'RECEIPT_LEASED' AND lease_token = ?",
  ).bind(
    status,
    canRetry ? isoAfter(now, calculatePushRetryDelaySeconds(task.attemptCount)) : now.toISOString(),
    errorCode,
    now.toISOString(),
    task.deliveryId,
    task.leaseToken,
  ).run()
  return canRetry ? 'retried' : 'failed'
}

async function processSendBatch(
  db: D1Database, endpointDb: D1Database, client: Expo, tasks: ClaimedDelivery[], now: Date,
): Promise<{ sent: number; retried: number; failed: number }> {
  const result = { sent: 0, retried: 0, failed: 0 }
  if (!tasks.length) return result
  const byToken = new Map(tasks.map((task) => [task.pushToken, task]))
  const messages = tasks.map(notificationPushMessage)

  for (const chunk of client.chunkPushNotifications(messages)) {
    const chunkTasks = chunk.map((message) => byToken.get(String(message.to)))
      .filter((task): task is ClaimedDelivery => Boolean(task))
    try {
      const tickets = await client.sendPushNotificationsAsync(chunk)
      for (let index = 0; index < chunk.length; index += 1) {
        const message = chunk[index]
        const task = message ? byToken.get(String(message.to)) : undefined
        const ticket = tickets[index]
        if (!task || !ticket) continue
        const outcome = await recordPushTicket(db, endpointDb, task, ticket, now)
        if (outcome === 'sent') result.sent += 1
        else if (outcome === 'retried') result.retried += 1
        else result.failed += 1
      }
    } catch {
      for (const task of chunkTasks) {
        const outcome = await scheduleDeliveryRetry(db, task, now, 'ExpoServerError')
        if (outcome === 'retried') result.retried += 1
        else result.failed += 1
      }
    }
  }
  return result
}

async function processReceiptBatch(
  db: D1Database, endpointDb: D1Database, client: Expo, tasks: ClaimedReceipt[], now: Date,
): Promise<{ delivered: number; retried: number; failed: number; pending: number }> {
  const result = { delivered: 0, retried: 0, failed: 0, pending: 0 }
  if (!tasks.length) return result
  let receipts: Record<string, PushReceiptLike> = {}
  try {
    for (const chunk of client.chunkPushNotificationReceiptIds(tasks.map((task) => task.expoTicketId))) {
      Object.assign(receipts, await client.getPushNotificationReceiptsAsync(chunk))
    }
  } catch {
    for (const task of tasks) {
      const outcome = await applyReceipt(db, endpointDb, task, undefined, now)
      if (outcome === 'pending') result.pending += 1
    }
    return result
  }
  for (const task of tasks) {
    const outcome = await applyReceipt(db, endpointDb, task, receipts[task.expoTicketId], now)
    if (outcome === 'delivered') result.delivered += 1
    else if (outcome === 'retried') result.retried += 1
    else if (outcome === 'failed') result.failed += 1
    else result.pending += 1
  }
  return result
}

export async function runNotificationPushBatch(
  env: NotificationPushDeliveryEnv,
  now = new Date(),
): Promise<NotificationPushBatchResult> {
  if (env.PUSH_DELIVERY_ENABLED !== 'true') {
    return { status: 'DISABLED', fannedOut: 0, sent: 0, delivered: 0, retried: 0, failed: 0, skipped: 0 }
  }
  if (!env.DB || !env.D1_03) throw new Error('W05_PUSH_DELIVERY_D1_BINDING_MISSING')

  const fannedOut = await fanOutPendingNotifications(env.DB, env.D1_03, now)
  const deliveries = await claimDueDeliveries(env.DB, env.D1_03, now)
  const client = new Expo(env.EXPO_ACCESS_TOKEN?.trim() ? { accessToken: env.EXPO_ACCESS_TOKEN.trim() } : {})
  const sendResult = await processSendBatch(env.DB, env.D1_03, client, deliveries, now)
  const receipts = await claimDueReceipts(env.DB, now)
  const receiptResult = await processReceiptBatch(env.DB, env.D1_03, client, receipts, now)

  return {
    status: 'COMPLETED',
    fannedOut,
    sent: sendResult.sent,
    delivered: receiptResult.delivered,
    retried: sendResult.retried + receiptResult.retried,
    failed: sendResult.failed + receiptResult.failed,
    skipped: deliveries.length - sendResult.sent - sendResult.retried - sendResult.failed,
  }
}
