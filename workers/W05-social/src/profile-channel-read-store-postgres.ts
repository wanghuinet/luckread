import {
  ProfileChannelReadStoreError,
  type ProfileBlockRelationRow,
  type ProfileChannelCursor,
  type ProfileChannelReadStore,
  type ProfileLikedContentReadRow,
  type ProfileReplyReadRow,
} from './profile-channel-read-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no Node driver is bundled into W05 Worker code. */
export interface ProfileChannelPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/** PostgreSQL counterpart for bounded W05 profile reply and liked-content reads. */
export function createPostgresProfileChannelReadStore(
  db: ProfileChannelPostgresQueryExecutor,
): ProfileChannelReadStore {
  const query = async <Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[],
  ): Promise<Row[]> => {
    try {
      const result = await db.query<Row>(sql, values)
      return result.rows
    } catch {
      // Never expose driver messages, SQL text or connection metadata.
      throw new ProfileChannelReadStoreError()
    }
  }

  return {
    async profileVisibility(input) {
      const rows = await query<Readonly<{ blocked: boolean; muted: boolean }>>(`
        SELECT
          EXISTS (
            SELECT 1 FROM social_user_interactions block
             WHERE block.relation_type = 'block'
               AND ((block.actor_user_id = $1 AND block.target_user_id = $2)
                 OR (block.actor_user_id = $2 AND block.target_user_id = $1))
          ) AS blocked,
          EXISTS (
            SELECT 1 FROM social_user_interactions mute
             WHERE mute.relation_type = 'mute'
               AND mute.actor_user_id = $1 AND mute.target_user_id = $2
          ) AS muted
      `, [input.viewerUserId, input.profileUserId])
      return {
        blocked: Boolean(rows[0]?.blocked),
        muted: Boolean(rows[0]?.muted),
      }
    },

    async listReplies(input) {
      const values: unknown[] = [input.profileUserId]
      let cursorSql = ''
      if (input.cursor) {
        cursorSql = 'AND (c.created_at < $2::timestamptz OR (c.created_at = $2::timestamptz AND c.id < $3))'
        values.push(input.cursor.createdAt, input.cursor.tieBreaker)
      }
      values.push(input.limit)
      const limitParameter = values.length
      return query<ProfileReplyReadRow>([
        'SELECT c.id, c.content_id, c.author_user_id, c.parent_id, c.body, c.state, c.depth,',
        `       to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,`,
        `       to_char(c.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`,
        '  FROM social_comments c',
        ' WHERE c.author_user_id = $1',
        "   AND c.state = 'PUBLISHED'",
        cursorSql,
        ' ORDER BY c.created_at DESC, c.id DESC',
        ' LIMIT $' + limitParameter,
      ].filter(Boolean).join('\n'), values)
    },

    async listReplyOwnerBlockRelations(input) {
      if (input.ownerUserIds.length === 0) return []
      return query<ProfileBlockRelationRow>(`
        SELECT actor_user_id, target_user_id
          FROM social_user_interactions
         WHERE relation_type = 'block'
           AND (
             (actor_user_id = $1 AND target_user_id = ANY($2::text[]))
             OR (target_user_id = $1 AND actor_user_id = ANY($2::text[]))
           )
      `, [input.profileUserId, [...input.ownerUserIds]])
    },

    async listLikedContents(input) {
      const values: unknown[] = [input.profileUserId]
      let viewerVisibility = ''
      if (input.viewerUserId) {
        viewerVisibility = `
          AND NOT EXISTS (
            SELECT 1 FROM social_user_interactions block_profile
             WHERE block_profile.relation_type = 'block'
               AND ((block_profile.actor_user_id = $2 AND block_profile.target_user_id = il.actor_user_id)
                 OR (block_profile.actor_user_id = il.actor_user_id AND block_profile.target_user_id = $3))
          )
          AND NOT EXISTS (
            SELECT 1 FROM social_user_interactions mute_profile
             WHERE mute_profile.relation_type = 'mute'
               AND mute_profile.actor_user_id = $4 AND mute_profile.target_user_id = il.actor_user_id
          )`
        values.push(input.viewerUserId, input.viewerUserId, input.viewerUserId)
      }
      let cursorSql = ''
      if (input.cursor) {
        const timestampParameter = values.length + 1
        const relationshipParameter = timestampParameter + 1
        cursorSql = 'AND (il.created_at < $' + timestampParameter + '::timestamptz OR (il.created_at = $' + timestampParameter + '::timestamptz AND il.relationship_id < $' + relationshipParameter + '))'
        values.push(input.cursor.createdAt, input.cursor.tieBreaker)
      }
      values.push(input.limit)
      const limitParameter = values.length
      return query<ProfileLikedContentReadRow>([
        'SELECT il.relationship_id, il.target_id,',
        `       to_char(il.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at`,
        '  FROM interaction_likes il',
        ' WHERE il.actor_user_id = $1',
        "   AND il.target_type = 'content'",
        viewerVisibility,
        cursorSql,
        ' ORDER BY il.created_at DESC, il.relationship_id DESC',
        ' LIMIT $' + limitParameter,
      ].filter(Boolean).join('\n'), values)
    },

    async listLikedContentBlockRelations(input) {
      if (input.principalUserIds.length === 0 || input.ownerUserIds.length === 0) return []
      return query<ProfileBlockRelationRow>(`
        SELECT actor_user_id, target_user_id
          FROM social_user_interactions
         WHERE relation_type = 'block'
           AND (
             (actor_user_id = ANY($1::text[]) AND target_user_id = ANY($2::text[]))
             OR (target_user_id = ANY($1::text[]) AND actor_user_id = ANY($2::text[]))
           )
      `, [[...input.principalUserIds], [...input.ownerUserIds]])
    },

    async listMutedOwners(input) {
      if (input.ownerUserIds.length === 0) return []
      return query<Readonly<{ target_user_id: string }>>(`
        SELECT target_user_id
          FROM social_user_interactions
         WHERE relation_type = 'mute'
           AND actor_user_id = $1
           AND target_user_id = ANY($2::text[])
      `, [input.viewerUserId, [...input.ownerUserIds]])
    },
  }
}

/** Keeps the type available to rehearsal scripts without exporting a runtime dependency. */
export type ProfileChannelPostgresCursor = ProfileChannelCursor
