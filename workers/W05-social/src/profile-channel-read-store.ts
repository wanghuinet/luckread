export type ProfileChannelCursor = Readonly<{
  createdAt: string
  tieBreaker: string
}>

export type ProfileReplyReadRow = Readonly<{
  id: string
  content_id: string
  author_user_id: string
  parent_id: string | null
  body: string
  state: 'PUBLISHED'
  depth: number
  created_at: string
  updated_at: string
}>

export type ProfileLikedContentReadRow = Readonly<{
  relationship_id: string
  target_id: string
  created_at: string
}>

export type ProfileBlockRelationRow = Readonly<{
  actor_user_id: string
  target_user_id: string
}>

export type ProfileChannelReadStore = Readonly<{
  profileVisibility(input: Readonly<{
    profileUserId: string
    viewerUserId: string
  }>): Promise<Readonly<{ blocked: boolean; muted: boolean }>>
  listReplies(input: Readonly<{
    profileUserId: string
    cursor: ProfileChannelCursor | null
    limit: number
  }>): Promise<readonly ProfileReplyReadRow[]>
  listReplyOwnerBlockRelations(input: Readonly<{
    profileUserId: string
    ownerUserIds: readonly string[]
  }>): Promise<readonly ProfileBlockRelationRow[]>
  listLikedContents(input: Readonly<{
    profileUserId: string
    viewerUserId: string | null
    cursor: ProfileChannelCursor | null
    limit: number
  }>): Promise<readonly ProfileLikedContentReadRow[]>
  listLikedContentBlockRelations(input: Readonly<{
    principalUserIds: readonly string[]
    ownerUserIds: readonly string[]
  }>): Promise<readonly ProfileBlockRelationRow[]>
  listMutedOwners(input: Readonly<{
    viewerUserId: string
    ownerUserIds: readonly string[]
  }>): Promise<readonly Readonly<{ target_user_id: string }>[]>
}>

export class ProfileChannelReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('PROFILE_CHANNEL_READ_UNAVAILABLE')
    this.name = 'ProfileChannelReadStoreError'
  }
}

type D1ReadResult<Row> = Readonly<{ results?: Row[] | null }>
type D1FirstResult<Row> = Promise<Row | null>

export interface ProfileChannelD1QueryExecutor {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<Row>(): Promise<D1ReadResult<Row>>
      first<Row>(): D1FirstResult<Row>
    }
  }
}

/** D1 remains the production adapter until a separately authorized cutover. */
export function createD1ProfileChannelReadStore(
  db: ProfileChannelD1QueryExecutor,
): ProfileChannelReadStore {
  return {
    async profileVisibility(input) {
      try {
        const row = await db.prepare(`
          SELECT
            EXISTS (
              SELECT 1 FROM social_user_interactions block
               WHERE block.relation_type = 'block'
                 AND ((block.actor_user_id = ? AND block.target_user_id = ?)
                   OR (block.actor_user_id = ? AND block.target_user_id = ?))
            ) AS blocked,
            EXISTS (
              SELECT 1 FROM social_user_interactions mute
               WHERE mute.relation_type = 'mute'
                 AND mute.actor_user_id = ? AND mute.target_user_id = ?
            ) AS muted
        `).bind(
          input.viewerUserId,
          input.profileUserId,
          input.profileUserId,
          input.viewerUserId,
          input.viewerUserId,
          input.profileUserId,
        ).first<{ blocked: number | boolean; muted: number | boolean }>()
        return {
          blocked: Number(row?.blocked ?? 0) === 1,
          muted: Number(row?.muted ?? 0) === 1,
        }
      } catch {
        throw new ProfileChannelReadStoreError()
      }
    },

    async listReplies(input) {
      const values: unknown[] = [input.profileUserId]
      const cursorSql = input.cursor
        ? ' AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))'
        : ''
      if (input.cursor) values.push(input.cursor.createdAt, input.cursor.createdAt, input.cursor.tieBreaker)
      values.push(input.limit)
      try {
        const result = await db.prepare(`
          SELECT c.id, c.content_id, c.author_user_id, c.parent_id, c.body, c.state, c.depth, c.created_at, c.updated_at
            FROM social_comments c
           WHERE c.author_user_id = ?
             AND c.state = 'PUBLISHED'
             ${cursorSql}
           ORDER BY c.created_at DESC, c.id DESC
           LIMIT ?
        `).bind(...values).all<ProfileReplyReadRow>()
        return result.results ?? []
      } catch {
        throw new ProfileChannelReadStoreError()
      }
    },

    async listReplyOwnerBlockRelations(input) {
      if (input.ownerUserIds.length === 0) return []
      const placeholders = input.ownerUserIds.map(() => '?').join(', ')
      try {
        const result = await db.prepare(`
          SELECT actor_user_id, target_user_id
            FROM social_user_interactions
           WHERE relation_type = 'block'
             AND (
               (actor_user_id = ? AND target_user_id IN (${placeholders}))
               OR (target_user_id = ? AND actor_user_id IN (${placeholders}))
             )
        `).bind(input.profileUserId, ...input.ownerUserIds, input.profileUserId, ...input.ownerUserIds)
          .all<ProfileBlockRelationRow>()
        return result.results ?? []
      } catch {
        throw new ProfileChannelReadStoreError()
      }
    },

    async listLikedContents(input) {
      const values: unknown[] = [input.profileUserId]
      let viewerVisibility = ''
      if (input.viewerUserId) {
        viewerVisibility = `
          AND NOT EXISTS (
            SELECT 1 FROM social_user_interactions block_profile
             WHERE block_profile.relation_type = 'block'
               AND ((block_profile.actor_user_id = ? AND block_profile.target_user_id = il.actor_user_id)
                 OR (block_profile.actor_user_id = il.actor_user_id AND block_profile.target_user_id = ?))
          )
          AND NOT EXISTS (
            SELECT 1 FROM social_user_interactions mute_profile
             WHERE mute_profile.relation_type = 'mute'
               AND mute_profile.actor_user_id = ? AND mute_profile.target_user_id = il.actor_user_id
          )`
        values.push(input.viewerUserId, input.viewerUserId, input.viewerUserId)
      }
      const cursorSql = input.cursor
        ? ' AND (il.created_at < ? OR (il.created_at = ? AND il.relationship_id < ?))'
        : ''
      if (input.cursor) values.push(input.cursor.createdAt, input.cursor.createdAt, input.cursor.tieBreaker)
      values.push(input.limit)
      try {
        const result = await db.prepare(`
          SELECT il.relationship_id, il.target_id, il.created_at
            FROM interaction_likes il
           WHERE il.actor_user_id = ?
             AND il.target_type = 'content'
             ${viewerVisibility}
             ${cursorSql}
           ORDER BY il.created_at DESC, il.relationship_id DESC
           LIMIT ?
        `).bind(...values).all<ProfileLikedContentReadRow>()
        return result.results ?? []
      } catch {
        throw new ProfileChannelReadStoreError()
      }
    },

    async listLikedContentBlockRelations(input) {
      if (input.principalUserIds.length === 0 || input.ownerUserIds.length === 0) return []
      const principals = input.principalUserIds.map(() => '?').join(', ')
      const owners = input.ownerUserIds.map(() => '?').join(', ')
      try {
        const result = await db.prepare(`
          SELECT actor_user_id, target_user_id
            FROM social_user_interactions
           WHERE relation_type = 'block'
             AND (
               (actor_user_id IN (${principals}) AND target_user_id IN (${owners}))
               OR (target_user_id IN (${principals}) AND actor_user_id IN (${owners}))
             )
        `).bind(
          ...input.principalUserIds,
          ...input.ownerUserIds,
          ...input.principalUserIds,
          ...input.ownerUserIds,
        ).all<ProfileBlockRelationRow>()
        return result.results ?? []
      } catch {
        throw new ProfileChannelReadStoreError()
      }
    },

    async listMutedOwners(input) {
      if (input.ownerUserIds.length === 0) return []
      const owners = input.ownerUserIds.map(() => '?').join(', ')
      try {
        const result = await db.prepare(`
          SELECT target_user_id
            FROM social_user_interactions
           WHERE relation_type = 'mute'
             AND actor_user_id = ?
             AND target_user_id IN (${owners})
        `).bind(input.viewerUserId, ...input.ownerUserIds)
          .all<{ target_user_id: string }>()
        return result.results ?? []
      } catch {
        throw new ProfileChannelReadStoreError()
      }
    },
  }
}
