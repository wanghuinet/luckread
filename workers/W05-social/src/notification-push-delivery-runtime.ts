/// <reference types="@cloudflare/workers-types" />
import Expo, { type ExpoPushMessage, type ExpoPushReceipt, type ExpoPushTicket } from 'expo-server-sdk'
import { fanOutPendingNotifications } from './notification-push-fanout-runtime.js'
import {
  createD1NotificationPushSendResultStore,
  type NotificationPushSendResultStore,
} from './notification-push-send-result-store.js'
import { createD1NotificationPushDeliveryClaimStore } from './notification-push-delivery-claim-store-d1.js'
import type { NotificationPushDeliveryClaimStore as NotificationPushDeliveryClaimStorePort } from './notification-push-delivery-claim-store.js'
import { createD1NotificationPushReceiptStore } from './notification-push-receipt-store-d1.js'
import type { NotificationPushReceiptStore } from './notification-push-receipt-store.js'

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


export async function claimDueDeliveries(
  store: NotificationPushDeliveryClaimStorePort,
  endpointDb: D1Database,
  now: Date,
): Promise<ClaimedDelivery[]> {
  const nowIso = now.toISOString()
  const candidates = await store.claimDue({
    now: nowIso,
    leaseExpiresAt: isoAfter(now, LEASE_SECONDS),
    limit: DELIVERY_LIMIT,
    maxAttempts: MAX_SEND_ATTEMPTS,
  })

  const claimed: ClaimedDelivery[] = []
  for (const candidate of candidates) {
    if (!candidate.recipient_user_id || !candidate.notification_type ||
        !candidate.target_type || !candidate.target_id) {
      await store.cancel({
        deliveryId: candidate.delivery_id,
        leaseToken: candidate.lease_token,
        reason: 'NOTIFICATION_NOT_FOUND',
        now: nowIso,
      })
      continue
    }

    // W09 remains the only authority for endpoint state and raw Expo push tokens.
    const endpoint = await endpointDb.prepare(
      "SELECT endpoint_id, owner_user_id, push_token FROM notification_push_endpoints " +
      "WHERE endpoint_id = ? AND owner_user_id = ? AND provider = 'expo' " +
      "AND permission_status = 'granted' AND push_token IS NOT NULL LIMIT 1",
    ).bind(candidate.endpoint_id, candidate.recipient_user_id).first<ActiveEndpointRow>()

    if (!endpoint) {
      await store.cancel({
        deliveryId: candidate.delivery_id,
        leaseToken: candidate.lease_token,
        reason: 'ENDPOINT_NOT_ACTIVE',
        now: nowIso,
      })
      continue
    }

    const pushTokenHash = await hashPushToken(endpoint.push_token)
    const tokenSnapshotSaved = await store.savePushTokenHash({
      deliveryId: candidate.delivery_id,
      leaseToken: candidate.lease_token,
      pushTokenHash,
      now: nowIso,
    })
    if (!tokenSnapshotSaved) continue

    claimed.push({
      deliveryId: candidate.delivery_id,
      notificationId: candidate.notification_id,
      endpointId: candidate.endpoint_id,
      recipientUserId: candidate.recipient_user_id,
      pushToken: endpoint.push_token,
      pushTokenHash,
      notificationType: candidate.notification_type,
      targetType: candidate.target_type,
      targetId: candidate.target_id,
      leaseToken: candidate.lease_token,
      attemptCount: candidate.attempt_count,
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
  const errorCode = ticket.status === 'error' ? String(ticket.details?.error ?? 'EXPO_TICKET_ERROR') :export async function claimDueReceipts(
  store: NotificationPushReceiptStore,
  now: Date,
): Promise<ClaimedReceipt[]> {
  const nowIso = now.toISOString()
  const candidates = await store.claimDue({
    now: nowIso,
    leaseExpiresAt: isoAfter(now, LEASE_SECONDS),
    limit: RECEIPT_LIMIT,
    maxReceiptPolls: MAX_RECEIPT_POLLS,
  })
  const claimed: ClaimedReceipt[] = []
  for (const candidate of candidates) {
    if (!candidate.recipient_user_id) {
      await store.cancelMissingOutbox({
        deliveryId: candidate.delivery_id,
        leaseToken: candidate.lease_token,
        now: nowIso,
      })
      continue
    }
    claimed.push({
      deliveryId: candidate.delivery_id,
      notificationId: candidate.notification_id,
      endpointId: candidate.endpoint_id,
      recipientUserId: candidate.recipient_user_id,
      expoTicketId: candidate.expo_ticket_id,
      leaseToken: candidate.lease_token,
      attemptCount: candidate.attempt_count,
      receiptPollCount: candidate.receipt_poll_count,
      pushTokenHash: candidate.push_token_hash ?? '',
    })
  }
  return claimed
}

async function applyReceipt(
  store: NotificationPushReceiptStore,
  endpointDb: D1Database,
  task: ClaimedReceipt,
  receipt: PushReceiptLike | undefined,
  now: Date,
): Promise<'provider-accepted' | 'retried' | 'failed' | 'pending' | 'stale'> {
  const nowIso = now.toISOString()
  if (!receipt) {
    if (task.receiptPollCount >= MAX_RECEIPT_POLLS) {
      const updated = await store.timeoutReceipt({
        deliveryId: task.deliveryId,
        leaseToken: task.leaseToken,
        now: nowIso,
      })
      return updated ? 'failed' : 'stale'
    }
    const updated = await store.deferReceipt({
      deliveryId: task.deliveryId,
      leaseToken: task.leaseToken,
      nextAttemptAt: isoAfter(now, RECEIPT_RETRY_SECONDS),
      now: nowIso,
    })
    return updated ? 'pending' : 'stale'
  }

  if (receipt.status === 'ok') {
    const updated = await store.acceptReceipt({
      deliveryId: task.deliveryId,
      leaseToken: task.leaseToken,
      now: nowIso,
    })
    return updated ? 'provider-accepted' : 'stale'
  }

  const errorCode = String(receipt.details?.error ?? 'EXPO_RECEIPT_ERROR')
  if (errorCode === 'DeviceNotRegistered' && task.pushTokenHash) {
    await deactivateInvalidEndpoint(endpointDb, task, now)
  }
  const canRetry = isRetryableExpoError(errorCode) && task.attemptCount < MAX_SEND_ATTEMPTS
  const updated = await store.failReceipt({
    deliveryId: task.deliveryId,
    leaseToken: task.leaseToken,
    status: canRetry ? 'RETRY' : 'FAILED',
    nextAttemptAt: canRetry ? isoAfter(now, calculatePushRetryDelaySeconds(task.attemptCount)) : nowIso,
    errorCode,
    now: nowIso,
  })
  if (!updated) return 'stale'
  return canRetry ? 'retried' : 'failed'
}

ySeconds(task.attemptCount)) : now.toISOString(),
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
        else if (outcome === 'failed') result.failed += 1
      }
    } catch {
      for (const task of chunkTasks) {
        const outcome = await scheduleDeliveryRetry(store, task, now, 'ExpoServerError')
        if (outcome === 'retried') result.retried += 1
        else if (outcome === 'failed') result.failed += 1
      }
    }
  }
  return result
}

async function processReceiptBatch(
  store: NotificationPushReceiptStore,
  endpointDb: D1Database,
  client: Expo,
  tasks: ClaimedReceipt[],
  now: Date,
): Promise<{ providerAccepted:number; retried:number; failed:number; pending:number; skipped:number }> {
  const result={providerAccepted:0,retried:0,failed:0,pending:0,skipped:0}
  if(!tasks.length)return result
  let receipts:Record<string,PushReceiptLike>={}
  try {
    for(const chunk of client.chunkPushNotificationReceiptIds(tasks.map(task=>task.expoTicketId))){
      Object.assign(receipts,await client.getPushNotificationReceiptsAsync(chunk))
    }
  }catch{
    for(const task of tasks){
      const outcome=await applyReceipt(store,endpointDb,task,undefined,now)
      if(outcome==='pending')result.pending+=1
      else if(outcome==='failed')result.failed+=1
      else if(outcome==='stale')result.skipped+=1
    }
    return result
  }
  for(const task of tasks){
    const outcome=await applyReceipt(store,endpointDb,task,receipts[task.expoTicketId],now)
    if(outcome==='provider-accepted')result.providerAccepted+=1
    else if(outcome==='retried')result.retried+=1
    else if(outcome==='failed')result.failed+=1
    else if(outcome==='pending')result.pending+=1
    else result.skipped+=1
  }
  return result
}
export type NotificationPushDeliveryRuntimeDependencies = Readonly<{
  sendResultStore?: NotificationPushSendResultStore
  deliveryClaimStore?: NotificationPushDeliveryClaimStorePort
  receiptStore?: NotificationPushReceiptStore
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
  const deliveryClaimStore = dependencies.deliveryClaimStore ?? createD1NotificationPushDeliveryClaimStore(env.DB)
  const deliveries = await claimDueDeliveries(deliveryClaimStore, env.D1_03, now)
  const sendResultStore = dependencies.sendResultStore ?? createD1NotificationPushSendResultStore(env.DB)
  const client = new Expo(env.EXPO_ACCESS_TOKEN?.trim() ? { accessToken: env.EXPO_ACCESS_TOKEN.trim() } : {})
  const sendResult = await processSendBatch(sendResultStore, env.D1_03, client, deliveries, now)
  const receiptStore = dependencies.receiptStore ?? createD1NotificationPushReceiptStore(env.DB)
  const receipts = await claimDueReceipts(receiptStore, now)
  const receiptResult = await processReceiptBatch(receiptStore, env.D1_03, client, receipts, now)

  return {
    status: 'COMPLETED',
    fannedOut,
    sent: sendResult.sent,
    providerAccepted: receiptResult.providerAccepted,
    retried: sendResult.retried + receiptResult.retried,
    failed: sendResult.failed + receiptResult.failed,
    skipped: deliveries.length - sendResult.sent - sendResult.retried - sendResult.failed + receiptResult.skipped,
  }
}
