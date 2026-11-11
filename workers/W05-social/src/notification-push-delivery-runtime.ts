/// <reference types="@cloudflare/workers-types" />
import Expo, { type ExpoPushMessage, type ExpoPushReceipt, type ExpoPushTicket } from 'expo-server-sdk'
import { fanOutPendingNotifications } from './notification-push-fanout-runtime.js'
import {
  createD1NotificationPushSendResultStore,
  type NotificationPushSendResultStore,
} from './notification-push-send-result-store.js'

type PushReceiptLike = ExpoPushReceipt
type PushTicketLike = ExpoPushTicket

export interface NotificationPushDeliveryEnv {
  readonly DB: D1Database
  readonly D1_03?: D1Database
  readonly PUSH_DELIVERY_ENABLED?: string
  readonly EXPO_ACCESS_TOKEN?: string
}

type ActiveEndpointRow = Readonly<{ endpoint_id: string; owner_user_id: string; push_token: string }>
type ClaimedDelivery = Readonly<{
  deliveryId: string; notificationId: string; endpointId: string; recipientUserId: string
  pushToken: string; pushTokenHash: string; notificationType: 'FOLLOW' | 'LIKE' | 'COMMENT' | 'REPLY' | 'MENTION'
  targetType: 'user' | 'content' | 'comment'; targetId: string; leaseToken: string; attemptCount: number
}>
type ClaimedReceipt = Readonly<{
  deliveryId: string; notificationId: string; endpointId: string; recipientUserId: string
  expoTicketId: string; leaseToken: string; attemptCount: number; receiptPollCount: number; pushTokenHash: string
}>
export type NotificationPushBatchResult = Readonly<{
  status: 'COMPLETED' | 'DISABLED'; fannedOut: number; sent: number; providerAccepted: number
  retried: number; failed: number; skipped: number
}>

const DELIVERY_LIMIT = 100
const RECEIPT_LIMIT = 300
const MAX_SEND_ATTEMPTS = 6
const MAX_RECEIPT_POLLS = 24
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

type PushMessageTask = Pick<ClaimedDelivery,
  'notificationId' | 'pushToken' | 'notificationType' | 'targetType' | 'targetId'
>

export function createPushMessageDeliveryIndex<T extends PushMessageTask>(
  tasks: readonly T[],
): Readonly<{ messages: ExpoPushMessage[]; taskByMessage: Map<ExpoPushMessage, T> }> {
  const taskByMessage = new Map<ExpoPushMessage, T>()
  const messages = tasks.map((task) => {
    const message = notificationPushMessage(task)
    taskByMessage.set(message, task)
    return message
  })
  return { messages, taskByMessage }
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


async function claimDueDeliveries(db: D1Database, endpointDb: D1Database, now: Date): Promise<ClaimedDelivery[]> {
  const nowIso = now.toISOString()
  await db.prepare(
    "UPDATE social_notification_push_deliveries SET status = 'FAILED', lease_token = NULL, lease_expires_at = NULL, " +
    "last_error_code = 'SEND_LEASE_EXPIRED_MAX_ATTEMPTS', updated_at = ? " +
    "WHERE status = 'LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ? AND attempt_count >= ?",
  ).bind(nowIso, nowIso, MAX_SEND_ATTEMPTS).run()
  const candidates = await db.prepare(
    'SELECT delivery_id, notification_id, endpoint_id FROM social_notification_push_deliveries ' +
    "WHERE ((status IN ('PENDING','RETRY') AND next_attempt_at <= ? AND attempt_count < ?) " +
    "OR (status = 'LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ? AND attempt_count < ?)) " +
    'ORDER BY next_attempt_at ASC, created_at ASC LIMIT ?',
  ).bind(nowIso, MAX_SEND_ATTEMPTS, nowIso, MAX_SEND_ATTEMPTS, DELIVERY_LIMIT).all<{ delivery_id: string; notification_id: string; endpoint_id: string }>()

  const claimed: ClaimedDelivery[] = []
  for (const candidate of candidates.results ?? []) {
    const leaseToken = crypto.randomUUID()
    const updated = await db.prepare(
      "UPDATE social_notification_push_deliveries SET status = 'LEASED', lease_token = ?, lease_expires_at = ?, " +
      'attempt_count = attempt_count + 1, updated_at = ? WHERE delivery_id = ? AND ' +
      "((status IN ('PENDING','RETRY') AND next_attempt_at <= ? AND attempt_count < ?) " +
      "OR (status = 'LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ? AND attempt_count < ?)) " +
      'RETURNING delivery_id, notification_id, endpoint_id, attempt_count',
    ).bind(leaseToken, isoAfter(now, LEASE_SECONDS), nowIso, candidate.delivery_id, nowIso, MAX_SEND_ATTEMPTS, nowIso, MAX_SEND_ATTEMPTS)
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
      pushTokenHash,
      notificationType: notification.notification_type,
      targetType: notification.target_type,
      targetId: notification.target_id,
      leaseToken,
      attemptCount: updated.attempt_count,
    })
  }
  return claimed
}

export async function deactivateInvalidEndpoint(
  endpointDb: D1Database,
  task: Readonly<{ endpointId: string; recipientUserId: string; pushTokenHash: string }>,
  now: Date,
): Promise<boolean> {
  const endpoint = await endpointDb.prepare(
    'SELECT push_token FROM notification_push_endpoints WHERE endpoint_id = ? AND owner_user_id = ? AND provider = ? LIMIT 1',
  ).bind(task.endpointId, task.recipientUserId, 'expo').first<{ push_token: string | null }>()
  if (!endpoint?.push_token || await hashPushToken(endpoint.push_token) !== task.pushTokenHash) return false

  await endpointDb.prepare(
    "UPDATE notification_push_endpoints SET permission_status = 'undetermined', push_token = NULL, " +
    'updated_at = ? WHERE endpoint_id = ? AND owner_user_id = ? AND provider = ? AND push_token = ?',
  ).bind(now.toISOString(), task.endpointId, task.recipientUserId, 'expo', endpoint.push_token).run()
  return true
}

async function scheduleDeliveryRetry(
  store: NotificationPushSendResultStore, task: ClaimedDelivery, now: Date, errorCode: string,
): Promise<'retried' | 'failed' | 'stale'> {
  const canRetry = isRetryableExpoError(errorCode) && task.attemptCount < MAX_SEND_ATTEMPTS
  const updated = await store.scheduleRetry({
    deliveryId: task.deliveryId,
    leaseToken: task.leaseToken,
    status: canRetry ? 'RETRY' : 'FAILED',
    nextAttemptAt: canRetry ? isoAfter(now, calculatePushRetryDelaySeconds(task.attemptCount)) : now.toISOString(),
    errorCode,
    now: now.toISOString(),
  })
  if (!updated) return 'stale'
  return canRetry ? 'retried' : 'failed'
}

async function recordPushTicket(
  store: NotificationPushSendResultStore, endpointDb: D1Database,
  task: ClaimedDelivery, ticket: PushTicketLike, now: Date,
): Promise<'sent' | 'retried' | 'failed' | 'stale'> {
  if (ticket.status === 'ok' && typeof ticket.id === 'string' && ticket.id.trim()) {
    const updated = await store.recordTicket({
      deliveryId: task.deliveryId,
      leaseToken: task.leaseToken,
      ticketId: ticket.id,
      nextAttemptAt: isoAfter(now, RECEIPT_DELAY_SECONDS),
      now: now.toISOString(),
    })
    return updated ? 'sent' : 'stale'
  }
  const errorCode = ticket.status === 'error' ? String(ticket.details?.error ?? 'EXPO_TICKET_ERROR') : 'EXPO_TICKET_INVALID'
  if (errorCode === 'DeviceNotRegistered') await deactivateInvalidEndpoint(endpointDb, task, now)
  return scheduleDeliveryRetry(store, task, now, errorCode)
}

async function claimDueReceipts(db: D1Database, now: Date): Promise<ClaimedReceipt[]> {
  const nowIso = now.toISOString()
  await db.prepare(
    "UPDATE social_notification_push_deliveries SET status = 'FAILED', lease_token = NULL, lease_expires_at = NULL, " +
    "last_error_code = 'RECEIPT_LEASE_EXPIRED_MAX_POLLS', updated_at = ? " +
    "WHERE status = 'RECEIPT_LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ? AND receipt_poll_count >= ?",
  ).bind(nowIso, nowIso, MAX_RECEIPT_POLLS).run()
  const candidates = await db.prepare(
    "SELECT delivery_id, notification_id, endpoint_id, expo_ticket_id FROM social_notification_push_deliveries " +
    "WHERE ((status = 'RECEIPT_PENDING' AND expo_ticket_id IS NOT NULL AND next_attempt_at <= ? AND receipt_poll_count < ?) " +
    "OR (status = 'RECEIPT_LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ? AND receipt_poll_count < ?)) " +
    'ORDER BY next_attempt_at ASC, created_at ASC LIMIT ?',
  ).bind(nowIso, MAX_RECEIPT_POLLS, nowIso, MAX_RECEIPT_POLLS, RECEIPT_LIMIT).all<{
    delivery_id: string; notification_id: string; endpoint_id: string; expo_ticket_id: string
  }>()

  const claimed: ClaimedReceipt[] = []
  for (const candidate of candidates.results ?? []) {
    const leaseToken = crypto.randomUUID()
    const row = await db.prepare(
      "UPDATE social_notification_push_deliveries SET status = 'RECEIPT_LEASED', lease_token = ?, " +
      'lease_expires_at = ?, receipt_poll_count = receipt_poll_count + 1, updated_at = ? ' +
      "WHERE delivery_id = ? AND ((status = 'RECEIPT_PENDING' AND next_attempt_at <= ? AND receipt_poll_count < ?) " +
      "OR (status = 'RECEIPT_LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ? AND receipt_poll_count < ?)) " +
      'RETURNING delivery_id, notification_id, endpoint_id, expo_ticket_id, attempt_count, receipt_poll_count, push_token_hash',
    ).bind(leaseToken, isoAfter(now, LEASE_SECONDS), nowIso, candidate.delivery_id, nowIso, MAX_RECEIPT_POLLS, nowIso, MAX_RECEIPT_POLLS).first<{
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
): Promise<'provider-accepted' | 'retried' | 'failed' | 'pending'> {
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
      "UPDATE social_notification_push_deliveries SET status = 'PROVIDER_ACCEPTED', lease_token = NULL, " +
      "lease_expires_at = NULL, last_error_code = NULL, updated_at = ? " +
      "WHERE delivery_id = ? AND status = 'RECEIPT_LEASED' AND lease_token = ?",
    ).bind(now.toISOString(), task.deliveryId, task.leaseToken).run()
    return 'provider-accepted'
  }

  const errorCode = String(receipt.details?.error ?? 'EXPO_RECEIPT_ERROR')
  if (errorCode === 'DeviceNotRegistered' && task.pushTokenHash) {
    await deactivateInvalidEndpoint(endpointDb, task, now)
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
  store: NotificationPushSendResultStore, endpointDb: D1Database, client: Expo,
  tasks: ClaimedDelivery[], now: Date,
): Promise<{ sent: number; retried: number; failed: number }> {
  const result = { sent: 0, retried: 0, failed: 0 }
  if (!tasks.length) return result
  // A recipient device can receive several notifications in the same batch.
  // Map by the message object, never by Expo token: tokens are intentionally
  // shared across notification rows for the same endpoint.
  const { messages, taskByMessage } = createPushMessageDeliveryIndex(tasks)

  for (const chunk of client.chunkPushNotifications(messages)) {
    const chunkTasks = chunk.map((message) => taskByMessage.get(message))
      .filter((task): task is ClaimedDelivery => Boolean(task))
    try {
      const tickets = await client.sendPushNotificationsAsync(chunk)
      for (let index = 0; index < chunk.length; index += 1) {
        const message = chunk[index]
        const task = message ? taskByMessage.get(message) : undefined
        const ticket = tickets[index]
        if (!task || !ticket) continue
        const outcome = await recordPushTicket(store, endpointDb, task, ticket, now)
        if (outcome === 'sent') result.sent += 1
        else if (outcome === 'retried') result.retried += 1
        else result.failed += 1
      }
    } catch {
      for (const task of chunkTasks) {
        const outcome = await scheduleDeliveryRetry(store, task, now, 'ExpoServerError')
        if (outcome === 'retried') result.retried += 1
        else result.failed += 1
      }
    }
  }
  return result
}

async function processReceiptBatch(
  db: D1Database, endpointDb: D1Database, client: Expo, tasks: ClaimedReceipt[], now: Date,
): Promise<{ providerAccepted: number; retried: number; failed: number; pending: number }> {
  const result = { providerAccepted: 0, retried: 0, failed: 0, pending: 0 }
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
    if (outcome === 'provider-accepted') result.providerAccepted += 1
    else if (outcome === 'retried') result.retried += 1
    else if (outcome === 'failed') result.failed += 1
    else result.pending += 1
  }
  return result
}

export type NotificationPushDeliveryRuntimeDependencies = Readonly<{
  sendResultStore?: NotificationPushSendResultStore
}>

export async function runNotificationPushBatch(
  env: NotificationPushDeliveryEnv,
  now = new Date(),
  dependencies: NotificationPushDeliveryRuntimeDependencies = {},
): Promise<NotificationPushBatchResult> {
  if (env.PUSH_DELIVERY_ENABLED !== 'true') {
    return { status: 'DISABLED', fannedOut: 0, sent: 0, providerAccepted: 0, retried: 0, failed: 0, skipped: 0 }
  }
  if (!env.DB || !env.D1_03) throw new Error('W05_PUSH_DELIVERY_D1_BINDING_MISSING')

  const fannedOut = await fanOutPendingNotifications(env.DB, env.D1_03, now)
  const deliveries = await claimDueDeliveries(env.DB, env.D1_03, now)
  const sendResultStore = dependencies.sendResultStore ?? createD1NotificationPushSendResultStore(env.DB)
  const client = new Expo(env.EXPO_ACCESS_TOKEN?.trim() ? { accessToken: env.EXPO_ACCESS_TOKEN.trim() } : {})
  const sendResult = await processSendBatch(sendResultStore, env.D1_03, client, deliveries, now)
  const receipts = await claimDueReceipts(env.DB, now)
  const receiptResult = await processReceiptBatch(env.DB, env.D1_03, client, receipts, now)

  return {
    status: 'COMPLETED',
    fannedOut,
    sent: sendResult.sent,
    providerAccepted: receiptResult.providerAccepted,
    retried: sendResult.retried + receiptResult.retried,
    failed: sendResult.failed + receiptResult.failed,
    skipped: deliveries.length - sendResult.sent - sendResult.retried - sendResult.failed,
  }
}
