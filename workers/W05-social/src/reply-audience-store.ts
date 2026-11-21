import type { ReplyAudience } from './reply-audience-runtime.js'

export type StoredReplyAudiencePolicy = Readonly<{
  contentId: string
  ownerUserId: string
  audience: ReplyAudience
  mentionedUserIdsJson: string
  updatedAt: string
}>

export type WriteReplyAudiencePolicy = Readonly<{
  contentId: string
  ownerUserId: string
  audience: ReplyAudience
  mentionedUserIdsJson: string
  now: string
}>

export interface ReplyAudienceStore {
  /** Returns null when an existing policy belongs to another owner. */
  set(input: WriteReplyAudiencePolicy): Promise<StoredReplyAudiencePolicy | null>
  get(contentId: string, ownerUserId: string): Promise<StoredReplyAudiencePolicy | null>
}

export class ReplyAudienceStoreError extends Error {
  readonly code = 'INTERNAL_ERROR'
  readonly status = 500

  constructor() {
    super('REPLY_AUDIENCE_STORE_UNAVAILABLE')
    this.name = 'ReplyAudienceStoreError'
  }
}

