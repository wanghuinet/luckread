import { MessagingStoreError, type MessagingAttachment, type MessagingMessageRow, type MessagingStore } from './messaging-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[]; rowCount?: number | null }>
interface PgClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>
  release(): void
}
export interface MessagingPostgresExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>
  connect(): Promise<PgClient>
}
type MessageRow = MessagingMessageRow
const validId = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
const encodeCursor = (updatedAt: string, conversationId: string): string =>
  btoa(updatedAt + '|' + conversationId).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
const decodeCursor = (cursor: string): { updatedAt: string; conversationId: string } | null => {
  if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null
  try {
    const raw = atob(cursor.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - cursor.length % 4) % 4))
    const [updatedAt, conversationId, ...extra] = raw.split('|')
    if (extra.length || !updatedAt || !Number.isFinite(Date.parse(updatedAt)) || !conversationId || !validId(conversationId)) return null
    return { updatedAt, conversationId }
  } catch { return null }
}
async function withTransaction<T>(db: MessagingPostgresExecutor, run: (client: PgClient) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await run(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally { client.release() }
}

/** Attach the trusted mutation actor to this transaction for membership outbox triggers. */
async function withActorTransaction<T>(
  db: MessagingPostgresExecutor,
  actorUserId: string,
  run: (client: PgClient) => Promise<T>,
): Promise<T> {
  return withTransaction(db, async client => {
    await client.query("SELECT set_config('luckread.actor_user_id', $1, true)", [actorUserId])
    return run(client)
  })
}
const messageSelect = `message_id, conversation_id, sender_user_id, sequence::text AS sequence,
  body, COALESCE(attachments, '[]'::jsonb) AS attachments, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  CASE WHEN edited_at IS NULL THEN NULL ELSE to_char(edited_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS edited_at,
  CASE WHEN recalled_at IS NULL THEN NULL ELSE to_char(recalled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS recalled_at`
export function createPostgresMessagingStore(db: MessagingPostgresExecutor): MessagingStore {
  return {
    async createGroupConversation(actorUserId, memberUserIds, groupName) {
      const name = groupName.trim().normalize('NFC')
      const members = [...new Set(memberUserIds.map(value => value.trim()))]
      if (!validId(actorUserId) || name.length < 1 || name.length > 80 || members.length < 2 || members.length > 49 ||
        members.some(id => !validId(id) || id === actorUserId)) {
        throw new MessagingStoreError('VALIDATION_FAILED', 422)
      }
      const participants = [actorUserId, ...members]
      try {
        return await withActorTransaction(db, actorUserId, async client => {
          const contacts = await client.query<{ user_id: string }>(
            `SELECT target.user_id
               FROM unnest($2::text[]) AS target(user_id)
              WHERE EXISTS (
                SELECT 1 FROM social_conversations direct
                JOIN social_conversation_memberships mine
                  ON mine.conversation_id = direct.conversation_id
                 AND mine.user_id = $1 AND mine.left_at IS NULL
                JOIN social_conversation_memberships peer
                  ON peer.conversation_id = direct.conversation_id
                 AND peer.user_id = target.user_id AND peer.left_at IS NULL
                WHERE direct.conversation_type = 'direct'
                  AND direct.direct_pair_key = LEAST($1::text, target.user_id) || ':' || GREATEST($1::text, target.user_id)
              ) ORDER BY target.user_id`,
            [actorUserId, members])
          if (contacts.rows.length !== members.length) throw new MessagingStoreError('CONTACT_POLICY_DENIED', 403)
          const blocked = await client.query(
            `SELECT 1 FROM social_user_interactions
              WHERE relation_type = 'block'
                AND actor_user_id = ANY($1::text[])
                AND target_user_id = ANY($1::text[])
              LIMIT 1`, [participants])
          if (blocked.rows.length) throw new MessagingStoreError('PERMISSION_DENIED', 403)
          const conversationId = crypto.randomUUID()
          await client.query(
            `INSERT INTO social_conversations
              (conversation_id, conversation_type, direct_pair_key, group_name, created_by_user_id, last_sequence, created_at, updated_at)
             VALUES ($1, 'group', NULL, $2, $3, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [conversationId, name, actorUserId])
          await client.query(
            `INSERT INTO social_conversation_memberships
              (conversation_id, user_id, member_role, joined_at, last_read_sequence)
             SELECT $1, member_id, CASE WHEN member_id = $2 THEN 'owner' ELSE 'member' END,
                    CURRENT_TIMESTAMP, 0
               FROM unnest($3::text[]) AS members(member_id)`,
            [conversationId, actorUserId, participants])
          return { conversationId }
        })
      } catch (error) {
        if (error instanceof MessagingStoreError) throw error
        throw new MessagingStoreError()
      }
    },
    async listConversationMembers(actorUserId, conversationId) {
      if (!validId(conversationId)) throw new MessagingStoreError('VALIDATION_FAILED', 422)
      try {
        const allowed = await db.query(
          `SELECT 1 FROM social_conversation_memberships mine
            WHERE mine.conversation_id = $1 AND mine.user_id = $2 AND mine.left_at IS NULL
              AND EXISTS (
                SELECT 1 FROM social_conversation_memberships peer
                 WHERE peer.conversation_id = mine.conversation_id
                   AND peer.user_id <> mine.user_id AND peer.left_at IS NULL
              )
              AND NOT EXISTS (
                SELECT 1 FROM social_conversation_memberships peer
                JOIN social_user_interactions blocked
                  ON blocked.relation_type = 'block'
                 AND ((blocked.actor_user_id = mine.user_id AND blocked.target_user_id = peer.user_id)
                   OR (blocked.actor_user_id = peer.user_id AND blocked.target_user_id = mine.user_id))
                WHERE peer.conversation_id = mine.conversation_id
                  AND peer.user_id <> mine.user_id AND peer.left_at IS NULL
              ) LIMIT 1`,
          [conversationId, actorUserId])
        if (!allowed.rows.length) throw new MessagingStoreError('NOT_FOUND', 404)
        const result = await db.query<any>(
          `SELECT user_id, member_role, last_read_sequence::text AS last_read_sequence, membership_version::text AS membership_version,
                  to_char(joined_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS joined_at
             FROM social_conversation_memberships
            WHERE conversation_id = $1 AND left_at IS NULL
            ORDER BY CASE WHEN member_role = 'owner' THEN 0 ELSE 1 END, joined_at ASC, user_id ASC`,
          [conversationId])
        return result.rows
      } catch (error) {
        if (error instanceof MessagingStoreError) throw error
        throw new MessagingStoreError()
      }
    },
    async addGroupMembers(actorUserId, conversationId, memberUserIds) {
      const members = [...new Set(memberUserIds.map(value => value.trim()))]
      if (!validId(conversationId) || members.length < 1 || members.length > 49 ||
        members.some(id => !validId(id) || id === actorUserId)) throw new MessagingStoreError('VALIDATION_FAILED', 422)
      try {
        return await withActorTransaction(db, actorUserId, async client => {
          const group = await client.query<{ conversation_id: string }>(
            `SELECT c.conversation_id FROM social_conversations c
              JOIN social_conversation_memberships mine
                ON mine.conversation_id = c.conversation_id
               AND mine.user_id = $2 AND mine.member_role = 'owner' AND mine.left_at IS NULL
             WHERE c.conversation_id = $1 AND c.conversation_type = 'group'
             FOR UPDATE OF c`,
            [conversationId, actorUserId])
          if (!group.rows.length) throw new MessagingStoreError('PERMISSION_DENIED', 403)
          const current = await client.query<{ user_id: string }>(
            `SELECT user_id FROM social_conversation_memberships
              WHERE conversation_id = $1 AND left_at IS NULL`,
            [conversationId])
          const currentIds = current.rows.map(row => row.user_id)
          const newMembers = members.filter(id => !currentIds.includes(id))
          if (!newMembers.length) return { addedCount: 0 }
          if (currentIds.length + newMembers.length > 50) throw new MessagingStoreError('GROUP_MEMBER_LIMIT_REACHED', 422)
          const contacts = await client.query<{ user_id: string }>(
            `SELECT target.user_id
               FROM unnest($2::text[]) AS target(user_id)
              WHERE EXISTS (
                SELECT 1 FROM social_conversations direct
                JOIN social_conversation_memberships mine
                  ON mine.conversation_id = direct.conversation_id
                 AND mine.user_id = $1 AND mine.left_at IS NULL
                JOIN social_conversation_memberships peer
                  ON peer.conversation_id = direct.conversation_id
                 AND peer.user_id = target.user_id AND peer.left_at IS NULL
                WHERE direct.conversation_type = 'direct'
                  AND direct.direct_pair_key = LEAST($1, target.user_id) || ':' || GREATEST($1, target.user_id)
              ) ORDER BY target.user_id`,
            [actorUserId, newMembers])
          if (contacts.rows.length !== newMembers.length) throw new MessagingStoreError('CONTACT_POLICY_DENIED', 403)
          const allParticipants = [...currentIds, ...newMembers]
          const blocked = await client.query(
            `SELECT 1 FROM social_user_interactions
              WHERE relation_type = 'block'
                AND actor_user_id = ANY($1::text[])
                AND target_user_id = ANY($1::text[])
              LIMIT 1`, [allParticipants])
          if (blocked.rows.length) throw new MessagingStoreError('PERMISSION_DENIED', 403)
          await client.query(
            `INSERT INTO social_conversation_memberships
              (conversation_id, user_id, member_role, joined_at, last_read_sequence)
             SELECT $1, member_id, 'member', CURRENT_TIMESTAMP, 0
               FROM unnest($2::text[]) AS members(member_id)
             ON CONFLICT (conversation_id, user_id) DO UPDATE
               SET left_at = NULL, archived_at = NULL, joined_at = CURRENT_TIMESTAMP, last_read_sequence = 0`,
            [conversationId, newMembers])
          await client.query('UPDATE social_conversations SET updated_at = CURRENT_TIMESTAMP WHERE conversation_id = $1', [conversationId])
          return { addedCount: newMembers.length }
        })
      } catch (error) {
        if (error instanceof MessagingStoreError) throw error
        throw new MessagingStoreError()
      }
    },
    async removeGroupMember(actorUserId, conversationId, memberUserId) {
      if (!validId(conversationId) || !validId(memberUserId) || actorUserId === memberUserId) throw new MessagingStoreError('VALIDATION_FAILED', 422)
      try {
        return await withActorTransaction(db, actorUserId, async client => {
          const group = await client.query(
            `SELECT c.conversation_id FROM social_conversations c
              JOIN social_conversation_memberships owner
                ON owner.conversation_id = c.conversation_id
               AND owner.user_id = $2 AND owner.member_role = 'owner' AND owner.left_at IS NULL
             WHERE c.conversation_id = $1 AND c.conversation_type = 'group'
             FOR UPDATE OF c`,
            [conversationId, actorUserId])
          if (!group.rows.length) throw new MessagingStoreError('PERMISSION_DENIED', 403)
          const removed = await client.query<{ membership_version: string }>(
            `UPDATE social_conversation_memberships
                SET left_at = CURRENT_TIMESTAMP
              WHERE conversation_id = $1 AND user_id = $2 AND member_role <> 'owner' AND left_at IS NULL
              RETURNING membership_version::text AS membership_version`,
            [conversationId, memberUserId])
          if (!removed.rows[0]) throw new MessagingStoreError('NOT_FOUND', 404)
          await client.query('UPDATE social_conversations SET updated_at = CURRENT_TIMESTAMP WHERE conversation_id = $1', [conversationId])
          return { membershipVersion: removed.rows[0].membership_version }
        })
      } catch (error) {
        if (error instanceof MessagingStoreError) throw error
        throw new MessagingStoreError()
      }
    },
    async transferGroupOwnership(actorUserId, conversationId, targetUserId) {
      if (!validId(conversationId) || !validId(targetUserId) || actorUserId === targetUserId) throw new MessagingStoreError('VALIDATION_FAILED', 422)
      try {
        await withActorTransaction(db, actorUserId, async client => {
          const group = await client.query(
            `SELECT c.conversation_id FROM social_conversations c
              JOIN social_conversation_memberships owner
                ON owner.conversation_id = c.conversation_id
               AND owner.user_id = $2 AND owner.member_role = 'owner' AND owner.left_at IS NULL
             WHERE c.conversation_id = $1 AND c.conversation_type = 'group'
             FOR UPDATE OF c`,
            [conversationId, actorUserId])
          if (!group.rows.length) throw new MessagingStoreError('PERMISSION_DENIED', 403)
          const target = await client.query(
            `UPDATE social_conversation_memberships SET member_role = 'owner'
              WHERE conversation_id = $1 AND user_id = $2 AND member_role = 'member' AND left_at IS NULL`,
            [conversationId, targetUserId])
          if (!target.rowCount) throw new MessagingStoreError('TARGET_NOT_ACTIVE_MEMBER', 409)
          await client.query(
            `UPDATE social_conversation_memberships SET member_role = 'member'
              WHERE conversation_id = $1 AND user_id = $2 AND member_role = 'owner' AND left_at IS NULL`,
            [conversationId, actorUserId])
          await client.query('UPDATE social_conversations SET updated_at = CURRENT_TIMESTAMP WHERE conversation_id = $1', [conversationId])
        })
      } catch (error) {
        if (error instanceof MessagingStoreError) throw error
        throw new MessagingStoreError()
      }
    },
    async leaveGroupConversation(actorUserId, conversationId) {
      if (!validId(conversationId)) throw new MessagingStoreError('VALIDATION_FAILED', 422)
      try {
        return await withActorTransaction(db, actorUserId, async client => {
          const member = await client.query<{ member_role: string }>(
            `SELECT m.member_role FROM social_conversation_memberships m
              JOIN social_conversations c ON c.conversation_id = m.conversation_id
             WHERE m.conversation_id = $1 AND m.user_id = $2 AND m.left_at IS NULL
               AND c.conversation_type = 'group'
             FOR UPDATE OF c, m`,
            [conversationId, actorUserId])
          if (!member.rows[0]) throw new MessagingStoreError('NOT_FOUND', 404)
          if (member.rows[0].member_role === 'owner') throw new MessagingStoreError('GROUP_OWNER_CANNOT_LEAVE', 409)
          const left = await client.query<{ membership_version: string }>(
            `UPDATE social_conversation_memberships SET left_at = CURRENT_TIMESTAMP
              WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL
              RETURNING membership_version::text AS membership_version`,
            [conversationId, actorUserId])
          if (!left.rows[0]) throw new MessagingStoreError('NOT_FOUND', 404)
          await client.query('UPDATE social_conversations SET updated_at = CURRENT_TIMESTAMP WHERE conversation_id = $1', [conversationId])
          return { membershipVersion: left.rows[0].membership_version }
        })
      } catch (error) {
        if (error instanceof MessagingStoreError) throw error
        throw new MessagingStoreError()
      }
    },
    async createDirectConversation(actorUserId, recipientUserId) {
      if (!validId(actorUserId) || !validId(recipientUserId) || actorUserId === recipientUserId) {
        throw new MessagingStoreError('VALIDATION_FAILED', 422)
      }
      const [left, right] = [actorUserId, recipientUserId].sort()
      const directPairKey = left + ':' + right
      try {
        return await withTransaction(db, async client => {
          const blocked = await client.query(
            `SELECT 1 FROM social_user_interactions
              WHERE relation_type = 'block'
                AND ((actor_user_id = $1 AND target_user_id = $2)
                  OR (actor_user_id = $2 AND target_user_id = $1))
              LIMIT 1`, [actorUserId, recipientUserId])
          if (blocked.rows.length) throw new MessagingStoreError('PERMISSION_DENIED', 403)
          // Mutual followers may open a new DM. An accepted first-contact request
          // or an already-active direct conversation also grants ongoing access.
          const contactAdmission = await client.query(
            `SELECT 1
              WHERE EXISTS (
                SELECT 1 FROM social_follow_relationships outgoing
                JOIN social_follow_relationships incoming
                  ON incoming.follower_user_id = outgoing.target_user_id
                 AND incoming.target_user_id = outgoing.follower_user_id
                WHERE outgoing.follower_user_id = $1 AND outgoing.target_user_id = $2
              )
              OR EXISTS (
                SELECT 1 FROM social_message_requests request
                WHERE request.status = 'accepted'
                  AND ((request.sender_user_id = $1 AND request.recipient_user_id = $2)
                    OR (request.sender_user_id = $2 AND request.recipient_user_id = $1))
              )
              OR EXISTS (
                SELECT 1 FROM social_conversations conversation
                JOIN social_conversation_memberships actor
                  ON actor.conversation_id = conversation.conversation_id
                 AND actor.user_id = $1 AND actor.left_at IS NULL
                JOIN social_conversation_memberships recipient
                  ON recipient.conversation_id = conversation.conversation_id
                 AND recipient.user_id = $2 AND recipient.left_at IS NULL
                WHERE conversation.direct_pair_key = $3
              ) LIMIT 1`, [actorUserId, recipientUserId, directPairKey])
          if (!contactAdmission.rows.length) throw new MessagingStoreError('CONTACT_POLICY_DENIED', 403)
          const created = await client.query<{ conversation_id: string }>(
            `INSERT INTO social_conversations
              (conversation_id, conversation_type, direct_pair_key, created_by_user_id, last_sequence, created_at, updated_at)
             VALUES ($1, 'direct', $2, $3, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT (direct_pair_key) WHERE conversation_type = 'direct' AND direct_pair_key IS NOT NULL DO UPDATE SET updated_at = social_conversations.updated_at
             RETURNING conversation_id`,
            [crypto.randomUUID(), directPairKey, actorUserId])
          const conversationId = created.rows[0]?.conversation_id
          if (!conversationId) throw new MessagingStoreError()
          await client.query(
            `INSERT INTO social_conversation_memberships
              (conversation_id, user_id, member_role, joined_at, last_read_sequence)
             VALUES ($1, $2, 'owner', CURRENT_TIMESTAMP, 0), ($1, $3, 'member', CURRENT_TIMESTAMP, 0)
             ON CONFLICT (conversation_id, user_id) DO UPDATE
                SET left_at = NULL, archived_at = NULL, joined_at = CURRENT_TIMESTAMP`,
            [conversationId, actorUserId, recipientUserId])
          return { conversationId }
        })
      } catch (error) {
        if (error instanceof MessagingStoreError) throw error
        throw new MessagingStoreError()
      }
    },
    async listConversations(actorUserId, cursor, limit) {
      const decoded = cursor ? decodeCursor(cursor) : null
      if (cursor && !decoded) throw new MessagingStoreError('INVALID_CURSOR', 400)
      try {
        const result = await db.query<any>(
          `SELECT c.conversation_id, c.conversation_type, c.group_name,
                  CASE WHEN c.conversation_type = 'direct' THEN peer.user_id ELSE NULL END AS participant_user_id,
                  (SELECT COUNT(*)::int FROM social_conversation_memberships members
                    WHERE members.conversation_id = c.conversation_id AND members.left_at IS NULL) AS member_count,
                  to_char(c.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at,
                  c.last_sequence::text AS last_sequence,
                  latest.message_id AS last_message_id, latest.body AS last_message_body,
                  latest.sender_user_id AS last_message_sender_user_id,
                  CASE WHEN latest.created_at IS NULL THEN NULL ELSE
                    to_char(latest.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS last_message_created_at,
                  mine.last_read_sequence::text AS last_read_sequence,
                  (SELECT COUNT(*)::int FROM social_messages unread
                    WHERE unread.conversation_id = c.conversation_id
                      AND unread.sender_user_id <> $1
                      AND unread.sequence > mine.last_read_sequence
                      AND unread.recalled_at IS NULL) AS unread_count
             FROM social_conversation_memberships mine
             JOIN social_conversations c ON c.conversation_id = mine.conversation_id
             LEFT JOIN LATERAL (
               SELECT user_id FROM social_conversation_memberships
                WHERE conversation_id = c.conversation_id AND user_id <> $1 AND left_at IS NULL
                ORDER BY joined_at ASC LIMIT 1
             ) peer ON c.conversation_type = 'direct'
             LEFT JOIN LATERAL (
               SELECT message_id, body, sender_user_id, created_at FROM social_messages
                WHERE conversation_id = c.conversation_id AND recalled_at IS NULL
                ORDER BY sequence DESC LIMIT 1
             ) latest ON TRUE
            WHERE mine.user_id = $1 AND mine.left_at IS NULL
              AND (c.conversation_type = 'group' OR peer.user_id IS NOT NULL)
              AND NOT EXISTS (
                SELECT 1 FROM social_conversation_memberships other
                JOIN social_user_interactions blocked
                  ON blocked.relation_type = 'block'
                 AND ((blocked.actor_user_id = $1 AND blocked.target_user_id = other.user_id)
                   OR (blocked.actor_user_id = other.user_id AND blocked.target_user_id = $1))
                WHERE other.conversation_id = c.conversation_id
                  AND other.user_id <> $1 AND other.left_at IS NULL
              )
              AND ($2::timestamptz IS NULL OR (c.updated_at, c.conversation_id) < ($2::timestamptz, $3::text))
            ORDER BY c.updated_at DESC, c.conversation_id DESC
            LIMIT $4`,
          [actorUserId, decoded?.updatedAt ?? null, decoded?.conversationId ?? null, limit + 1])
        const hasMore = result.rows.length > limit
        const rows = result.rows.slice(0, limit)
        const last = rows[rows.length - 1]
        return {
          items: rows,
          nextCursor: hasMore && last ? encodeCursor(last.updated_at, last.conversation_id) : null,
          hasMore,
        }
      } catch (error) {
        if (error instanceof MessagingStoreError) throw error
        throw new MessagingStoreError()
      }
    },
    async listMessages(actorUserId, conversationId, beforeSequence, limit) {
      if (!validId(conversationId) || (beforeSequence !== null && !/^[1-9][0-9]{0,17}$/.test(beforeSequence))) {
        throw new MessagingStoreError('INVALID_CURSOR', 400)
      }
      try {
        const membership = await db.query(
          `SELECT 1 FROM social_conversation_memberships mine
             WHERE mine.conversation_id = $1 AND mine.user_id = $2 AND mine.left_at IS NULL
               AND EXISTS (
                 SELECT 1 FROM social_conversation_memberships peer
                  WHERE peer.conversation_id = mine.conversation_id AND peer.user_id <> mine.user_id AND peer.left_at IS NULL
               )
               AND NOT EXISTS (
                 SELECT 1 FROM social_conversation_memberships peer
                 JOIN social_user_interactions blocked
                   ON blocked.relation_type = 'block'
                  AND ((blocked.actor_user_id = mine.user_id AND blocked.target_user_id = peer.user_id)
                    OR (blocked.actor_user_id = peer.user_id AND blocked.target_user_id = mine.user_id))
                 WHERE peer.conversation_id = mine.conversation_id
                   AND peer.user_id <> mine.user_id AND peer.left_at IS NULL
               ) LIMIT 1`,
          [conversationId, actorUserId])
        if (!membership.rows.length) throw new MessagingStoreError('NOT_FOUND', 404)
        const result = await db.query<MessageRow>(
          `SELECT ${messageSelect} FROM social_messages
            WHERE conversation_id = $1
              AND ($2::bigint IS NULL OR sequence < $2::bigint)
            ORDER BY sequence DESC LIMIT $3`,
          [conversationId, beforeSequence, limit + 1])
        const hasMore = result.rows.length > limit
        const items = result.rows.slice(0, limit)
        return { items, nextCursor: hasMore && items.length ? items[items.length - 1]!.sequence : null, hasMore }
      } catch (error) {
        if (error instanceof MessagingStoreError) throw error
        throw new MessagingStoreError()
      }
    },
    async listMessagesAfter(actorUserId, conversationId, afterSequence, limit) {
      if (!validId(conversationId) || !/^(0|[1-9][0-9]{0,17})$/.test(afterSequence)) {
        throw new MessagingStoreError('INVALID_CURSOR', 400)
      }
      try {
        const membership = await db.query(
          `SELECT 1 FROM social_conversation_memberships mine
             WHERE mine.conversation_id = $1 AND mine.user_id = $2 AND mine.left_at IS NULL
               AND EXISTS (
                 SELECT 1 FROM social_conversation_memberships peer
                  WHERE peer.conversation_id = mine.conversation_id AND peer.user_id <> mine.user_id AND peer.left_at IS NULL
               )
               AND NOT EXISTS (
                 SELECT 1 FROM social_conversation_memberships peer
                 JOIN social_user_interactions blocked
                   ON blocked.relation_type = 'block'
                  AND ((blocked.actor_user_id = mine.user_id AND blocked.target_user_id = peer.user_id)
                    OR (blocked.actor_user_id = peer.user_id AND blocked.target_user_id = mine.user_id))
                 WHERE peer.conversation_id = mine.conversation_id
                   AND peer.user_id <> mine.user_id AND peer.left_at IS NULL
               ) LIMIT 1`,
          [conversationId, actorUserId])
        if (!membership.rows.length) throw new MessagingStoreError('NOT_FOUND', 404)
        const result = await db.query<MessageRow>(
          `SELECT ${messageSelect} FROM social_messages
            WHERE conversation_id = $1 AND sequence > $2::bigint
            ORDER BY sequence ASC LIMIT $3`,
          [conversationId, afterSequence, limit + 1])
        const hasMore = result.rows.length > limit
        const items = result.rows.slice(0, limit)
        return { items, nextCursor: hasMore && items.length ? items[items.length - 1]!.sequence : null, hasMore }
      } catch (error) {
        if (error instanceof MessagingStoreError) throw error
        throw new MessagingStoreError()
      }
    },
    async sendMessage(actorUserId, conversationId, clientMessageId, body, attachments: MessagingAttachment[] = []) {
      if (!validId(conversationId) || !validId(clientMessageId) || body.length > 10000 || (!body && attachments.length === 0) || attachments.length > 4) {
        throw new MessagingStoreError('VALIDATION_FAILED', 422)
      }
      try {
        return await withTransaction(db, async client => {
          // One locked conversation read performs membership, peer, and block checks.
          // All group membership mutations lock the same conversation row.
          const access = await client.query<{ conversation_id: string; has_peer: boolean; has_blocked: boolean }>(
            `SELECT c.conversation_id,
                    EXISTS (
                      SELECT 1 FROM social_conversation_memberships peer
                       WHERE peer.conversation_id = c.conversation_id
                         AND peer.user_id <> $2 AND peer.left_at IS NULL
                    ) AS has_peer,
                    EXISTS (
                      SELECT 1 FROM social_conversation_memberships peer
                      JOIN social_user_interactions interaction
                        ON interaction.relation_type = 'block'
                       AND ((interaction.actor_user_id = $2 AND interaction.target_user_id = peer.user_id)
                         OR (interaction.actor_user_id = peer.user_id AND interaction.target_user_id = $2))
                       WHERE peer.conversation_id = c.conversation_id
                         AND peer.user_id <> $2 AND peer.left_at IS NULL
                    ) AS has_blocked
               FROM social_conversations c
               JOIN social_conversation_memberships mine
                 ON mine.conversation_id = c.conversation_id
                AND mine.user_id = $2 AND mine.left_at IS NULL
              WHERE c.conversation_id = $1
              FOR UPDATE OF c`,
            [conversationId, actorUserId],
          )
          const current = access.rows[0]
          if (!current) throw new MessagingStoreError('NOT_FOUND', 404)
          if (!current.has_peer) throw new MessagingStoreError('NOT_FOUND', 404)
          if (current.has_blocked) throw new MessagingStoreError('PERMISSION_DENIED', 403)

          // Check current access before returning an idempotent retry result.
          const prior = await client.query<MessageRow>(
            `SELECT ${messageSelect} FROM social_messages
              WHERE sender_user_id = $1 AND client_message_id = $2 LIMIT 1`,
            [actorUserId, clientMessageId],
          )
          if (prior.rows[0]) {
            if (prior.rows[0].conversation_id !== conversationId || prior.rows[0].body !== body ||
              JSON.stringify(prior.rows[0].attachments ?? []) !== JSON.stringify(attachments)) {
              throw new MessagingStoreError('CONFLICT', 409)
            }
            return prior.rows[0]
          }

          const messageId = crypto.randomUUID()
          // Allocate sequence and update the conversation preview in one write.
          const sequenceResult = await client.query<{ last_sequence: string }>(
            `UPDATE social_conversations
                SET last_sequence = last_sequence + 1,
                    last_message_id = $2,
                    updated_at = CURRENT_TIMESTAMP
              WHERE conversation_id = $1
              RETURNING last_sequence::text AS last_sequence`,
            [conversationId, messageId],
          )
          const sequence = sequenceResult.rows[0]?.last_sequence
          if (!sequence) throw new MessagingStoreError()
          const inserted = await client.query<MessageRow>(
            `INSERT INTO social_messages
              (message_id, conversation_id, sender_user_id, sequence, client_message_id, body, attachments, created_at)
             VALUES ($1, $2, $3, $4::bigint, $5, $6, $7::jsonb, CURRENT_TIMESTAMP)
             RETURNING ${messageSelect}`,
            [messageId, conversationId, actorUserId, sequence, clientMessageId, body, JSON.stringify(attachments)],
          )
          const message = inserted.rows[0]
          if (!message) throw new MessagingStoreError()
          return message
        })
      } catch (error) {
        if (error instanceof MessagingStoreError) throw error
        // A concurrent retry can win the unique sender/client_message_id constraint.
        try {
          const prior = await db.query<MessageRow>(
            `SELECT ${messageSelect}
               FROM social_messages message
               JOIN social_conversation_memberships mine
                 ON mine.conversation_id = message.conversation_id AND mine.user_id = $1 AND mine.left_at IS NULL
              WHERE message.sender_user_id = $1 AND message.client_message_id = $2
                AND EXISTS (
                  SELECT 1 FROM social_conversation_memberships peer
                   WHERE peer.conversation_id = message.conversation_id
                     AND peer.user_id <> $1 AND peer.left_at IS NULL
                )
                AND NOT EXISTS (
                  SELECT 1 FROM social_conversation_memberships peer
                  JOIN social_user_interactions blocked
                    ON blocked.relation_type = 'block'
                   AND ((blocked.actor_user_id = mine.user_id AND blocked.target_user_id = peer.user_id)
                     OR (blocked.actor_user_id = peer.user_id AND blocked.target_user_id = mine.user_id))
                  WHERE peer.conversation_id = message.conversation_id
                    AND peer.user_id <> $1 AND peer.left_at IS NULL
                )
              LIMIT 1`, [actorUserId, clientMessageId])
          if (prior.rows[0]) {
            if (prior.rows[0].conversation_id === conversationId && prior.rows[0].body === body &&
              JSON.stringify(prior.rows[0].attachments ?? []) === JSON.stringify(attachments)) return prior.rows[0]
            throw new MessagingStoreError('CONFLICT', 409)
          }
        } catch (retryError) {
          if (retryError instanceof MessagingStoreError) throw retryError
        }
        throw new MessagingStoreError()
      }
    },
    async canReadAttachment(actorUserId, conversationId, mediaId) {
      if (!validId(conversationId) || !validId(mediaId)) throw new MessagingStoreError('VALIDATION_FAILED', 422)
      try {
        const result = await db.query(
          `SELECT 1
             FROM social_conversation_memberships mine
             JOIN social_messages message
               ON message.conversation_id = mine.conversation_id
              AND message.recalled_at IS NULL
              AND message.attachments @> jsonb_build_array(jsonb_build_object('mediaId', $3::text))
            WHERE mine.conversation_id = $1
              AND mine.user_id = $2
              AND mine.left_at IS NULL
              AND EXISTS (
                SELECT 1 FROM social_conversation_memberships peer
                 WHERE peer.conversation_id = mine.conversation_id
                   AND peer.user_id <> mine.user_id AND peer.left_at IS NULL
              )
              AND NOT EXISTS (
                SELECT 1 FROM social_conversation_memberships peer
                JOIN social_user_interactions blocked
                  ON blocked.relation_type = 'block'
                 AND ((blocked.actor_user_id = mine.user_id AND blocked.target_user_id = peer.user_id)
                   OR (blocked.actor_user_id = peer.user_id AND blocked.target_user_id = mine.user_id))
                WHERE peer.conversation_id = mine.conversation_id
                  AND peer.user_id <> mine.user_id AND peer.left_at IS NULL
              )
            LIMIT 1`,
          [conversationId, actorUserId, mediaId])
        return result.rows.length > 0
      } catch {
        throw new MessagingStoreError()
      }
    },
    async editMessage(actorUserId, conversationId, messageId, body) {
      if (!validId(conversationId) || !validId(messageId) || !body.trim() || body.length > 10000) {
        throw new MessagingStoreError('VALIDATION_FAILED', 422)
      }
      try {
        return await withTransaction(db, async client => {
          const authorized = await client.query(
            `SELECT 1
               FROM social_conversation_memberships mine
               JOIN social_messages message
                 ON message.conversation_id = mine.conversation_id
                AND message.message_id = $3
                AND message.sender_user_id = mine.user_id
                AND message.recalled_at IS NULL
              WHERE mine.conversation_id = $1 AND mine.user_id = $2 AND mine.left_at IS NULL
                AND EXISTS (
                  SELECT 1 FROM social_conversation_memberships peer
                   WHERE peer.conversation_id = mine.conversation_id
                     AND peer.user_id <> mine.user_id AND peer.left_at IS NULL
                )
                AND NOT EXISTS (
                  SELECT 1 FROM social_conversation_memberships peer
                  JOIN social_user_interactions blocked
                    ON blocked.relation_type = 'block'
                   AND ((blocked.actor_user_id = mine.user_id AND blocked.target_user_id = peer.user_id)
                     OR (blocked.actor_user_id = peer.user_id AND blocked.target_user_id = mine.user_id))
                  WHERE peer.conversation_id = mine.conversation_id
                    AND peer.user_id <> mine.user_id AND peer.left_at IS NULL
                )
              FOR UPDATE OF message`,
            [conversationId, actorUserId, messageId])
          if (!authorized.rows.length) throw new MessagingStoreError('NOT_FOUND', 404)
          const updated = await client.query<MessageRow>(
            `UPDATE social_messages SET body = $4, edited_at = CURRENT_TIMESTAMP
              WHERE conversation_id = $1 AND message_id = $2 AND sender_user_id = $3 AND recalled_at IS NULL
              RETURNING ${messageSelect}`,
            [conversationId, messageId, actorUserId, body])
          if (!updated.rows[0]) throw new MessagingStoreError('NOT_FOUND', 404)
          await client.query('UPDATE social_conversations SET updated_at = CURRENT_TIMESTAMP WHERE conversation_id = $1', [conversationId])
          return updated.rows[0]
        })
      } catch (error) {
        if (error instanceof MessagingStoreError) throw error
        throw new MessagingStoreError()
      }
    },
    async recallMessage(actorUserId, conversationId, messageId) {
      if (!validId(conversationId) || !validId(messageId)) throw new MessagingStoreError('VALIDATION_FAILED', 422)
      try {
        return await withTransaction(db, async client => {
          const authorized = await client.query(
            `SELECT 1
               FROM social_conversation_memberships mine
               JOIN social_messages message
                 ON message.conversation_id = mine.conversation_id
                AND message.message_id = $3
                AND message.sender_user_id = mine.user_id
                AND message.recalled_at IS NULL
              WHERE mine.conversation_id = $1 AND mine.user_id = $2 AND mine.left_at IS NULL
                AND EXISTS (
                  SELECT 1 FROM social_conversation_memberships peer
                   WHERE peer.conversation_id = mine.conversation_id
                     AND peer.user_id <> mine.user_id AND peer.left_at IS NULL
                )
                AND NOT EXISTS (
                  SELECT 1 FROM social_conversation_memberships peer
                  JOIN social_user_interactions blocked
                    ON blocked.relation_type = 'block'
                   AND ((blocked.actor_user_id = mine.user_id AND blocked.target_user_id = peer.user_id)
                     OR (blocked.actor_user_id = peer.user_id AND blocked.target_user_id = mine.user_id))
                  WHERE peer.conversation_id = mine.conversation_id
                    AND peer.user_id <> mine.user_id AND peer.left_at IS NULL
                )
              FOR UPDATE OF message`,
            [conversationId, actorUserId, messageId])
          if (!authorized.rows.length) throw new MessagingStoreError('NOT_FOUND', 404)
          const updated = await client.query<MessageRow>(
            `UPDATE social_messages
                SET body = '', attachments = '[]'::jsonb, recalled_at = CURRENT_TIMESTAMP
              WHERE conversation_id = $1 AND message_id = $2 AND sender_user_id = $3 AND recalled_at IS NULL
              RETURNING ${messageSelect}`,
            [conversationId, messageId, actorUserId])
          if (!updated.rows[0]) throw new MessagingStoreError('NOT_FOUND', 404)
          await client.query('UPDATE social_conversations SET updated_at = CURRENT_TIMESTAMP WHERE conversation_id = $1', [conversationId])
          return updated.rows[0]
        })
      } catch (error) {
        if (error instanceof MessagingStoreError) throw error
        throw new MessagingStoreError()
      }
    },
    async markRead(actorUserId, conversationId, sequence) {
      if (!validId(conversationId) || !/^(0|[1-9][0-9]{0,17})$/.test(sequence)) {
        throw new MessagingStoreError('VALIDATION_FAILED', 422)
      }
      try {
        const result = await db.query(
          `UPDATE social_conversation_memberships m
              SET last_read_sequence = GREATEST(m.last_read_sequence, LEAST($3::bigint, c.last_sequence))
             FROM social_conversations c
            WHERE m.conversation_id = $1 AND m.user_id = $2
              AND m.conversation_id = c.conversation_id AND m.left_at IS NULL
              AND EXISTS (
                SELECT 1 FROM social_conversation_memberships peer
                 WHERE peer.conversation_id = m.conversation_id AND peer.user_id <> m.user_id AND peer.left_at IS NULL
              )
              AND NOT EXISTS (
                SELECT 1 FROM social_conversation_memberships peer
                JOIN social_user_interactions blocked
                  ON blocked.relation_type = 'block'
                 AND ((blocked.actor_user_id = m.user_id AND blocked.target_user_id = peer.user_id)
                   OR (blocked.actor_user_id = peer.user_id AND blocked.target_user_id = m.user_id))
                 WHERE peer.conversation_id = m.conversation_id AND peer.user_id <> m.user_id AND peer.left_at IS NULL
              )`,
          [conversationId, actorUserId, sequence])
        if (!result.rowCount) throw new MessagingStoreError('NOT_FOUND', 404)
      } catch (error) {
        if (error instanceof MessagingStoreError) throw error
        throw new MessagingStoreError()
      }
    },
  }
}
