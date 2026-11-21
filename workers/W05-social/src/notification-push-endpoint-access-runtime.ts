import type { NotificationPushEndpointAccessStore } from './notification-push-endpoint-access-store.js'

export type InvalidPushEndpointTask = Readonly<{
  endpointId: string
  recipientUserId: string
  pushTokenHash: string
}>

/** SHA-256 snapshot used by W05 without persisting the raw provider token. */
export async function hashNotificationPushToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}

/**
 * Clear an invalid endpoint only when its current owner, status and raw token
 * still match the snapshot saved with the delivery. This prevents late Expo
 * receipts from clearing a newly rotated token.
 */
export async function deactivateInvalidNotificationPushEndpoint(
  store: NotificationPushEndpointAccessStore,
  task: InvalidPushEndpointTask,
  now: Date,
): Promise<boolean> {
  const endpoint = await store.findEndpointForOwner(task.endpointId, task.recipientUserId)
  if (
    !endpoint ||
    endpoint.permission_status !== 'granted' ||
    !endpoint.push_token ||
    await hashNotificationPushToken(endpoint.push_token) !== task.pushTokenHash
  ) return false

  return store.clearTokenIfMatches({
    endpointId: task.endpointId,
    ownerUserId: task.recipientUserId,
    expectedPushToken: endpoint.push_token,
    now: now.toISOString(),
  })
}
