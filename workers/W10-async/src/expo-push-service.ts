import Expo, {
  type ExpoPushMessage,
  type ExpoPushReceipt,
  type ExpoPushReceiptId,
  type ExpoPushTicket,
} from 'expo-server-sdk'

export type ExpoPushClientOptions = Readonly<{
  accessToken?: string
}>

/**
 * Create the official Expo server client.
 *
 * The client uses the Worker's native fetch implementation. Do not supply a
 * Node HTTP dispatcher in Cloudflare Workers.
 */
export function createExpoPushClient(options: ExpoPushClientOptions = {}): Expo {
  const accessToken = options.accessToken?.trim()
  return new Expo(accessToken ? { accessToken } : {})
}

/**
 * Validate recipients without including private push tokens in thrown errors,
 * then delegate chunking, concurrency limits, compression and HTTP 429 retry
 * behavior to expo-server-sdk.
 */
export async function sendExpoPushMessages(
  client: Expo,
  messages: readonly ExpoPushMessage[],
): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return []

  for (const message of messages) {
    const recipients = Array.isArray(message.to) ? message.to : [message.to]
    if (recipients.length === 0 || recipients.some((token) => !Expo.isExpoPushToken(token))) {
      throw new Error('EXPO_PUSH_TOKEN_INVALID')
    }
  }

  const tickets: ExpoPushTicket[] = []
  for (const chunk of client.chunkPushNotifications([...messages])) {
    tickets.push(...await client.sendPushNotificationsAsync(chunk))
  }
  return tickets
}

/**
 * Delegate receipt chunking and receipt retrieval to Expo's maintained SDK.
 * Workflow-level durable retries are applied by the caller around this
 * function, not duplicated here.
 */
export async function getExpoPushReceipts(
  client: Expo,
  receiptIds: readonly ExpoPushReceiptId[],
): Promise<Record<string, ExpoPushReceipt>> {
  if (receiptIds.length === 0) return {}
  if (receiptIds.some((id) => typeof id !== 'string' || id.trim().length === 0)) {
    throw new Error('EXPO_PUSH_RECEIPT_ID_INVALID')
  }

  const receipts: Record<string, ExpoPushReceipt> = {}
  for (const chunk of client.chunkPushNotificationReceiptIds([...receiptIds])) {
    Object.assign(receipts, await client.getPushNotificationReceiptsAsync(chunk))
  }
  return receipts
}
