export type ProfilePinStorageRow = Readonly<{
  user_id: string
  content_id: string
  pinned_at: string
}>

export interface ProfilePinStore {
  pin(userId: string, contentId: string, pinnedAt: string): Promise<ProfilePinStorageRow | null>
  get(userId: string): Promise<ProfilePinStorageRow | null>
  unpin(userId: string, contentId: string): Promise<void>
}

export class ProfilePinStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('PROFILE_PIN_STORE_UNAVAILABLE')
    this.name = 'ProfilePinStoreError'
  }
}

