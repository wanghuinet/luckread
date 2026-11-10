import { createPostgresSocialTargetsReadStore } from './social-targets-read-store-postgres.js'
import type { SocialTargetsReadInput, SocialTargetsReadResult } from './social-targets-read-store.js'
import { SocialClosureReadStoreError } from './social-closure-read-store.js'
import type {
  ContentSocialCounts,
  ContentSocialViewerState,
  NotificationInboxListInput,
  NotificationInboxRow,
  SocialClosureReadStore,
  SocialDiscoveryTopicEdge,
  SocialTopicContentEdge,
  SocialTopicRow,
} from './social-closure-read-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

export interface SocialClosurePostgresQueryExecutor {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/** PostgreSQL counterpart for W05's bounded topic, inbox and content-summary reads. */
export function createPostgresSocialClosureReadStore(
  db: SocialClosurePostgresQueryExecutor,
): SocialClosureReadStore {
  const socialTargets = createPostgresSocialTargetsReadStore(db)
  const fail = (): never => { throw new SocialClosureReadStoreError() }
  return {
    getTargets(input: SocialTargetsReadInput): Promise<SocialTargetsReadResult> {
      return socialTargets.getTargets(input)
    },

    async getTopicByName(normalizedName): Promise<SocialTopicRow | null> {
      try {
        const result = await db.query<SocialTopicRow>(
          'SELECT topic_id, normalized_name, display_name, status FROM social_topics WHERE normalized_name = $1 LIMIT 1',
          [normalizedName],
        )
        return result.rows[0] ?? null
      } catch {
        return fail()
      }
    },

    async listTopicContentEdges(input): Promise<readonly SocialTopicContentEdge[]> {
      try {
        const result = await db.query<SocialTopicContentEdge>(
          `SELECT st.target_id,
                  to_char(st.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
             FROM social_target_topics st
            WHERE st.target_type = 'content'
              AND st.topic_id = $1
              AND ($2::timestamptz IS NULL OR (st.created_at, st.target_id) < ($2::timestamptz, $3::text))
            ORDER BY st.created_at DESC, st.target_id DESC
            LIMIT $4`,
          [input.topicId, input.cursor?.createdAt ?? null, input.cursor?.targetId ?? null, input.limit],
        )
        return result.rows
      } catch {
        return fail()
      }
    },

    async listDiscoveryContentEdges(input): Promise<readonly SocialDiscoveryTopicEdge[]> {
      try {
        const result = await db.query<SocialDiscoveryTopicEdge>(
          `SELECT t.topic_id, t.normalized_name, t.display_name, st.target_id
             FROM social_target_topics st
             JOIN social_topics t ON t.topic_id = st.topic_id
            WHERE st.target_type = 'content'
              AND t.status = 'ACTIVE'
              AND ($1::text IS NULL OR (st.topic_id, st.target_id) > ($1::text, $2::text))
            ORDER BY st.topic_id ASC, st.target_id ASC
            LIMIT $3`,
          [input.cursor?.topicId ?? null, input.cursor?.targetId ?? null, input.limit],
        )
        return result.rows
      } catch {
        return fail()
      }
    },

    async listNotificationRows(input: NotificationInboxListInput): Promise<readonly NotificationInboxRow[]> {
      try {
        const values: unknown[] = [input.recipientUserId]
        const where: string[] = ['recipient_user_id = $1']
        if (input.notificationType) {
          values.push(input.notificationType)
          where.push(`notification_type = $${values.length}`)
        }
        if (input.notificationId) {
          values.push(input.notificationId)
          where.push(`notification_id = $${values.length}`)
        }
        if (input.cursor) {
          values.push(input.cursor.createdAt, input.cursor.notificationId)
          where.push(`(created_at, notification_id) < ($${values.length - 1}::timestamptz, $${values.length}::text)`)
        }
        values.push(input.limit)
        const result = await db.query<NotificationInboxRow>(
          `SELECT notification_id, notification_type, actor_user_id, target_type, target_id, payload_json,
                  CASE WHEN read_at IS NULL THEN NULL
                       ELSE to_char(read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                  END AS read_at,
                  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
             FROM social_notifications
            WHERE ${where.join(' AND ')}
            ORDER BY created_at DESC, notification_id DESC
            LIMIT $${values.length}`,
          values,
        )
        return result.rows
      } catch {
        return fail()
      }
    },

    async countUnreadNotifications(recipientUserId): Promise<number> {
      try {
        const result = await db.query<{ count: number }>(
          'SELECT COUNT(*)::int AS count FROM social_notifications WHERE recipient_user_id = $1 AND read_at IS NULL',
          [recipientUserId],
        )
        return Number(result.rows[0]?.count ?? 0)
      } catch {
        return fail()
      }
    },

    async markNotificationRead(recipientUserId, notificationId): Promise<void> {
      try {
        await db.query(
          'UPDATE social_notifications SET read_at = CURRENT_TIMESTAMP WHERE notification_id = $1 AND recipient_user_id = $2',
          [notificationId, recipientUserId],
        )
      } catch {
        return fail()
      }
    },

    async markAllNotificationsRead(recipientUserId): Promise<void> {
      try {
        await db.query(
          'UPDATE social_notifications SET read_at = CURRENT_TIMESTAMP WHERE recipient_user_id = $1 AND read_at IS NULL',
          [recipientUserId],
        )
      } catch {
        return fail()
      }
    },

    async getContentSocialCounts(contentId, pinnedOwnerUserId): Promise<ContentSocialCounts | null> {
      try {
        const result = await db.query<ContentSocialCounts>(
          `SELECT
             (SELECT COUNT(*)::int FROM interaction_likes WHERE target_type = 'content' AND target_id = $1) AS likes,
             (SELECT COUNT(*)::int FROM social_comments WHERE content_id = $2 AND state = 'PUBLISHED') AS comments,
             (SELECT COUNT(*)::int FROM interaction_favorites WHERE target_type = 'content' AND target_id = $3) AS favorites,
             (SELECT COUNT(*)::int FROM social_share_links WHERE content_id = $4) AS shares,
             (SELECT COUNT(*)::int FROM social_reposts WHERE content_id = $5) AS reposts,
             EXISTS (
               SELECT 1 FROM social_profile_pins p
                WHERE p.content_id = $6 AND p.user_id = $7
             ) AS pinned`,
          [contentId, contentId, contentId, contentId, contentId, contentId, pinnedOwnerUserId],
        )
        return result.rows[0] ?? null
      } catch {
        return fail()
      }
    },

    async getContentSocialViewerState(viewerUserId, contentId): Promise<ContentSocialViewerState | null> {
      try {
        const result = await db.query<ContentSocialViewerState>(
          `SELECT
             EXISTS (SELECT 1 FROM interaction_likes WHERE actor_user_id = $1 AND target_type = 'content' AND target_id = $2) AS liked,
             EXISTS (SELECT 1 FROM interaction_favorites WHERE actor_user_id = $3 AND target_type = 'content' AND target_id = $4) AS favorited,
             EXISTS (SELECT 1 FROM social_reposts WHERE actor_user_id = $5 AND content_id = $6) AS reposted`,
          [viewerUserId, contentId, viewerUserId, contentId, viewerUserId, contentId],
        )
        return result.rows[0] ?? null
      } catch {
        return fail()
      }
    },
  }
}
