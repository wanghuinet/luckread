import {
  createD1SocialTargetsReadStore,
} from './social-targets-read-store.js'
import type {
  SocialTargetsReadInput,
  SocialTargetsReadResult,
  SocialTargetsReadStore,
} from './social-targets-read-store.js'

export type SocialTopicRow = Readonly<{
  topic_id: string
  normalized_name: string
  display_name: string
  status: string
}>

export type SocialTopicContentEdge = Readonly<{
  target_id: string
  created_at: string
}>

export type SocialDiscoveryTopicEdge = Readonly<{
  topic_id: string
  normalized_name: string
  display_name: string
  target_id: string
}>

export type SocialTopicEdgeCursor = Readonly<{
  createdAt: string
  targetId: string
}> | null

export type SocialDiscoveryEdgeCursor = Readonly<{
  topicId: string
  targetId: string
}> | null

export type NotificationInboxType = 'FOLLOW' | 'LIKE' | 'COMMENT' | 'REPLY' | 'MENTION'

export type NotificationInboxRow = Readonly<{
  notification_id: string
  notification_type: NotificationInboxType
  actor_user_id: string
  target_type: string
  target_id: string
  payload_json: string
  read_at: string | null
  created_at: string
}>

export type NotificationInboxListInput = Readonly<{
  recipientUserId: string
  notificationType: NotificationInboxType | null
  notificationId: string | null
  cursor: Readonly<{ createdAt: string; notificationId: string }> | null
  limit: number
}>

export type ContentSocialCounts = Readonly<{
  likes: number
  comments: number
  favorites: number
  shares: number
  reposts: number
  pinned: number | boolean
}>

export type ContentSocialViewerState = Readonly<{
  liked: number | boolean
  favorited: number | boolean
  reposted: number | boolean
}>

export interface SocialClosureReadStore extends SocialTargetsReadStore {
  getTopicByName(normalizedName: string): Promise<SocialTopicRow | null>
  listTopicContentEdges(input: {
    topicId: string
    cursor: SocialTopicEdgeCursor
    limit: number
  }): Promise<readonly SocialTopicContentEdge[]>
  listDiscoveryContentEdges(input: {
    cursor: SocialDiscoveryEdgeCursor
    limit: number
  }): Promise<readonly SocialDiscoveryTopicEdge[]>
  listNotificationRows(input: NotificationInboxListInput): Promise<readonly NotificationInboxRow[]>
  countUnreadNotifications(recipientUserId: string): Promise<number>
  markNotificationRead(recipientUserId: string, notificationId: string): Promise<void>
  markAllNotificationsRead(recipientUserId: string): Promise<void>
  getContentSocialCounts(contentId: string, pinnedOwnerUserId: string | null): Promise<ContentSocialCounts | null>
  getContentSocialViewerState(viewerUserId: string, contentId: string): Promise<ContentSocialViewerState | null>
}

export class SocialClosureReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('SOCIAL_CLOSURE_READ_STORE_UNAVAILABLE')
    this.name = 'SocialClosureReadStoreError'
  }
}

