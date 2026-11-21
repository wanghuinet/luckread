export type SocialTokenSyncTargetType = 'content' | 'comment'

export type SocialTokenSyncCommentContext = Readonly<{
  content_id: string
  author_user_id: string
  state: string
}>

export type SocialTokenSyncMentionRow = Readonly<{
  mention_id: string
  mentioned_user_id: string
  handle: string
}>

export type SocialTokenSyncTopicInput = Readonly<{
  topicId: string
  normalizedName: string
  displayName: string
  targetType: SocialTokenSyncTargetType
  targetId: string
  token: string
  relationId: string
  now: string
}>

export type SocialTokenSyncMentionInput = Readonly<{
  mentionId: string
  targetType: SocialTokenSyncTargetType
  targetId: string
  actorUserId: string
  mentionedUserId: string
  handle: string
  now: string
}>

export type SocialTokenSyncTargetInput = Readonly<{
  targetType: SocialTokenSyncTargetType
  targetId: string
  retainedMentionIds: readonly string[]
}>

export interface SocialTokenSyncStore {
  getCommentContext(commentId: string): Promise<SocialTokenSyncCommentContext | null>
  listMentions(targetType: SocialTokenSyncTargetType, targetId: string): Promise<readonly SocialTokenSyncMentionRow[]>
  replaceTargetRelations(input: SocialTokenSyncTargetInput): Promise<void>
  upsertTopicAndAttach(input: SocialTokenSyncTopicInput): Promise<void>
  insertMention(input: SocialTokenSyncMentionInput): Promise<void>
}

export class SocialTokenSyncStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('SOCIAL_TOKEN_SYNC_STORE_UNAVAILABLE')
    this.name = 'SocialTokenSyncStoreError'
  }
}
