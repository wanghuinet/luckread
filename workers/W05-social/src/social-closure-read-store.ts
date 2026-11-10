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

export interface SocialClosureD1Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
      all<T>(): Promise<{ results?: T[] | null }>
      run(): Promise<unknown>
    }
  }
}

/** D1 remains the production-default implementation for all W05 social-closure reads. */
export function createD1SocialClosureReadStore(
  db: SocialClosureD1Database,
): SocialClosureReadStore {
  const socialTargets = createD1SocialTargetsReadStore(db)
  return {
    getTargets(input: SocialTargetsReadInput): Promise<SocialTargetsReadResult> {
      return socialTargets.getTargets(input)
    },

    async getTopicByName(normalizedName) {
      return db.prepare(
        'SELECT topic_id, normalized_name, display_name, status FROM social_topics WHERE normalized_name = ? LIMIT 1',
      ).bind(normalizedName).first<SocialTopicRow>()
    },

    async listTopicContentEdges(input) {
      const where = input.cursor
        ? ' AND (st.created_at < ? OR (st.created_at = ? AND st.target_id < ?))'
        : ''
      const values = input.cursor
        ? [input.topicId, input.cursor.createdAt, input.cursor.createdAt, input.cursor.targetId, input.limit]
        : [input.topicId, input.limit]
      const result = await db.prepare(
        `SELECT st.target_id, st.created_at
           FROM social_target_topics st
          WHERE st.target_type = 'content'
            AND st.topic_id = ?${where}
          ORDER BY st.created_at DESC, st.target_id DESC
          LIMIT ?`,
      ).bind(...values).all<SocialTopicContentEdge>()
      return result.results ?? []
    },

    async listDiscoveryContentEdges(input) {
      const cursorClause = input.cursor
        ? 'AND (st.topic_id, st.target_id) > (?, ?)'
        : ''
      const cursorValues = input.cursor
        ? [input.cursor.topicId, input.cursor.targetId]
        : []
      const result = await db.prepare(`
        SELECT t.topic_id, t.normalized_name, t.display_name, st.target_id
          FROM social_target_topics st
            INDEXED BY ix_social_target_topics_content_topic_target
          CROSS JOIN social_topics t
         WHERE st.target_type = 'content'
           AND t.topic_id = st.topic_id
           AND t.status = 'ACTIVE'
           ${cursorClause}
         ORDER BY st.topic_id ASC, st.target_id ASC
         LIMIT ?
      `).bind(...cursorValues, input.limit).all<SocialDiscoveryTopicEdge>()
      return result.results ?? []
    },

    async listNotificationRows(input) {
      const whereType = input.notificationType ? ' AND notification_type = ?' : ''
      const whereNotificationId = input.notificationId ? ' AND notification_id = ?' : ''
      const whereCursor = input.cursor
        ? ' AND (created_at < ? OR (created_at = ? AND notification_id < ?))'
        : ''
      const cursorValues = input.cursor
        ? [input.cursor.createdAt, input.cursor.createdAt, input.cursor.notificationId]
        : []
      const values = [
        input.recipientUserId,
        ...(input.notificationType ? [input.notificationType] : []),
        ...(input.notificationId ? [input.notificationId] : []),
        ...cursorValues,
        input.limit,
      ]
      const result = await db.prepare(
        `SELECT notification_id, notification_type, actor_user_id, target_type, target_id, payload_json, read_at, created_at
           FROM social_notifications
          WHERE recipient_user_id = ?${whereType}${whereNotificationId}${whereCursor}
          ORDER BY created_at DESC, notification_id DESC
          LIMIT ?`,
      ).bind(...values).all<NotificationInboxRow>()
      return result.results ?? []
    },

    async countUnreadNotifications(recipientUserId) {
      const row = await db.prepare(
        'SELECT COUNT(*) AS count FROM social_notifications WHERE recipient_user_id = ? AND read_at IS NULL',
      ).bind(recipientUserId).first<{ count: number }>()
      return Number(row?.count ?? 0)
    },

    async markNotificationRead(recipientUserId, notificationId) {
      await db.prepare(
        'UPDATE social_notifications SET read_at = CURRENT_TIMESTAMP WHERE notification_id = ? AND recipient_user_id = ?',
      ).bind(notificationId, recipientUserId).run()
    },

    async markAllNotificationsRead(recipientUserId) {
      await db.prepare(
        'UPDATE social_notifications SET read_at = CURRENT_TIMESTAMP WHERE recipient_user_id = ? AND read_at IS NULL',
      ).bind(recipientUserId).run()
    },

    async getContentSocialCounts(contentId, pinnedOwnerUserId) {
      return db.prepare(
        `SELECT
           (SELECT COUNT(*) FROM interaction_likes WHERE target_type = 'content' AND target_id = ?) AS likes,
           (SELECT COUNT(*) FROM social_comments WHERE content_id = ? AND state = 'PUBLISHED') AS comments,
           (SELECT COUNT(*) FROM interaction_favorites WHERE target_type = 'content' AND target_id = ?) AS favorites,
           (SELECT COUNT(*) FROM social_share_links WHERE content_id = ?) AS shares,
           (SELECT COUNT(*) FROM social_reposts WHERE content_id = ?) AS reposts,
           EXISTS (
             SELECT 1 FROM social_profile_pins p
             WHERE p.content_id = ? AND p.user_id = ?
           ) AS pinned`,
      ).bind(
        contentId, contentId, contentId, contentId, contentId, contentId, pinnedOwnerUserId,
      ).first<ContentSocialCounts>()
    },

    async getContentSocialViewerState(viewerUserId, contentId) {
      return db.prepare(
        `SELECT
           EXISTS (SELECT 1 FROM interaction_likes WHERE actor_user_id = ? AND target_type = 'content' AND target_id = ?) AS liked,
           EXISTS (SELECT 1 FROM interaction_favorites WHERE actor_user_id = ? AND target_type = 'content' AND target_id = ?) AS favorited,
           EXISTS (SELECT 1 FROM social_reposts WHERE actor_user_id = ? AND content_id = ?) AS reposted`,
      ).bind(viewerUserId, contentId, viewerUserId, contentId, viewerUserId, contentId)
        .first<ContentSocialViewerState>()
    },
  }
}
