export type NotificationPreferenceValues = Readonly<{
  follow: boolean
  like: boolean
  comment: boolean
  mention: boolean
}>

export type NotificationPreferencePatch = Partial<NotificationPreferenceValues>

export interface NotificationPreferencesStore {
  get(userId: string): Promise<NotificationPreferenceValues>
  set(userId: string, input: NotificationPreferencePatch): Promise<NotificationPreferenceValues>
}

export class NotificationPreferencesStoreError extends Error {
  readonly code = 'INTERNAL_ERROR'
  readonly status = 500

  constructor() {
    super('NOTIFICATION_PREFERENCES_STORE_UNAVAILABLE')
    this.name = 'NotificationPreferencesStoreError'
  }
}
