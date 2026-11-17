export type SocialTargetsReadInput = Readonly<{
  targetType: 'content' | 'comment'
  targetId: string
}>

export type SocialTargetTopicRow = Readonly<{
  topic_id: string
  normalized_name: string
  display_name: string
}>

export type SocialTargetMentionRow = Readonly<{
  mentioned_user_id: string
  handle: string
}>

export type SocialTargetsReadResult = Readonly<{
  topics: readonly SocialTargetTopicRow[]
  mentions: readonly SocialTargetMentionRow[]
}>

export interface SocialTargetsReadStore {
  getTargets(input: SocialTargetsReadInput): Promise<SocialTargetsReadResult>
}

export class SocialTargetsReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('SOCIAL_TARGETS_READ_STORE_UNAVAILABLE')
    this.name = 'SocialTargetsReadStoreError'
  }
}

