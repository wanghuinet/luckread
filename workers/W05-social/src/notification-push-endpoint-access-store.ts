export type NotificationPushEndpointAccessRow = Readonly<{
  endpoint_id: string
  owner_user_id: string
  push_token: string | null
  permission_status: 'granted' | 'denied' | 'undetermined'
}>

export type ActiveNotificationPushEndpoint = Readonly<{
  endpoint_id: string
  owner_user_id: string
  push_token: string
}>

export type ClearInvalidNotificationPushTokenInput = Readonly<{
  endpointId: string
  ownerUserId: string
  expectedPushToken: string
  now: string
}>

/**
 * W09 owns D1-03 NotificationPushEndpoint. W05 receives only the two delegated
 * operations in NOTIFY-003: bounded recipient-scoped endpoint reads and
 * token-snapshot compare-and-set deactivation.
 */
export interface NotificationPushEndpointAccessStore {
  listActiveForRecipient(
    recipientUserId: string,
    limit: number,
  ): Promise<readonly ActiveNotificationPushEndpoint[]>
  findEndpointForOwner(
    endpointId: string,
    ownerUserId: string,
  ): Promise<NotificationPushEndpointAccessRow | null>
  clearTokenIfMatches(input: ClearInvalidNotificationPushTokenInput): Promise<boolean>
}

export class NotificationPushEndpointAccessStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('NOTIFICATION_PUSH_ENDPOINT_ACCESS_UNAVAILABLE')
    this.name = 'NotificationPushEndpointAccessStoreError'
  }
}
