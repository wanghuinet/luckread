import { MessagingStoreError, type MessagingMessageRow, type MessagingStore } from './messaging-store.js'

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
const messageSelect = `message_id, conversation_id, sender_user_id, sequence::text AS sequence,
  body, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at`
export function createPostgresMessagingStore(db: MessagingPostgresExecutor): MessagingStore {
  return {
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
             ON CONFLICT (direct_pair_key) DO UPDATE SET updated_at = social_conversations.updated_at
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
          `SELECT c.conversation_id, peer.user_id AS participant_user_id,
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
             ) peer ON TRUE
             LEFT JOIN LATERAL (
               SELECT message_id, body, sender_user_id, created_at FROM social_messages
                WHERE conversation_id = c.conversation_id AND recalled_at IS NULL
                ORDER BY sequence DESC LIMIT 1
             ) latest ON TRUE
            WHERE mine.user_id = $1 AND mine.left_at IS NULL
              AND peer.user_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM social_user_interactions blocked
                 WHERE blocked.relation_type = 'block'
                   AND ((blocked.actor_user_id = $1 AND blocked.target_user_id = peer.user_id)
                     OR (blocked.actor_user_id = peer.user_id AND blocked.target_user_id = $1))
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
             JOIN social_conversation_memberships peer
               ON peer.conversation_id = mine.conversation_id AND peer.user_id <> mine.user_id AND peer.left_at IS NULL
             WHERE mine.conversation_id = $1 AND mine.user_id = $2 AND mine.left_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM social_user_interactions blocked
                  WHERE blocked.relation_type = 'block'
                    AND ((blocked.actor_user_id = mine.user_id AND blocked.target_user_id = peer.user_id)
                      OR (blocked.actor_user_id = peer.user_id AND blocked.target_user_id = mine.user_id))
               ) LIMIT 1`,
          [conversationId, actorUserId])
        if (!membership.rows.length) throw new MessagingStoreError('NOT_FOUND', 404)
        const result = await db.query<MessageRow>(
          `SELECT ${messageSelect} FROM social_messages
            WHERE conversation_id = $1 AND recalled_at IS NULL
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
             JOIN social_conversation_memberships peer
               ON peer.conversation_id = mine.conversation_id AND peer.user_id <> mine.user_id AND peer.left_at IS NULL
             WHERE mine.conversation_id = $1 AND mine.user_id = $2 AND mine.left_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM social_user_interactions blocked
                  WHERE blocked.relation_type = 'block'
                    AND ((blocked.actor_user_id = mine.user_id AND blocked.target_user_id = peer.user_id)
                      OR (blocked.actor_user_id = peer.user_id AND blocked.target_user_id = mine.user_id))
               ) LIMIT 1`,
          [conversationId, actorUserId])
        if (!membership.rows.length) throw new MessagingStoreError('NOT_FOUND', 404)
        const result = await db.query<MessageRow>(
          `SELECT ${messageSelect} FROM social_messages
            WHERE conversation_id = $1 AND recalled_at IS NULL AND sequence > $2::bigint
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
    async sendMessage(actorUserId, conversationId, clientMessageId, body) {
      if (!validId(conversationId) || !validId(clientMessageId) || body.length < 1 || body.length > 10000) {
        throw new MessagingStoreError('VALIDATION_FAILED', 422)
      }
      try {
        return await withTransaction(db, async client => {
          const conversation = await client.query<{ conversation_id: string }>(
            `SELECT c.conversation_id FROM social_conversations c
              JOIN social_conversation_memberships m ON m.conversation_id = c.conversation_id
             WHERE c.conversation_id = $1 AND m.user_id = $2 AND m.left_at IS NULL
             FOR UPDATE OF c`, [conversationId, actorUserId])
          if (!conversation.rows.length) throw new MessagingStoreError('NOT_FOUND', 404)
          const peer = await client.query<{ user_id: string }>(
            `SELECT user_id FROM social_conversation_memberships
              WHERE conversation_id = $1 AND user_id <> $2 AND left_at IS NULL LIMIT 1`,
            [conversationId, actorUserId])
          if (!peer.rows[0]) throw new MessagingStoreError('NOT_FOUND', 404)
          const blocked = await client.query(
            `SELECT 1 FROM social_user_interactions
              WHERE relation_type = 'block'
                AND ((actor_user_id = $1 AND target_user_id = $2)
                  OR (actor_user_id = $2 AND target_user_id = $1))
              LIMIT 1`, [actorUserId, peer.rows[0].user_id])
          if (blocked.rows.length) throw new MessagingStoreError('PERMISSION_DENIED', 403)
          // Check current access before returning an idempotent retry result.
          const prior = await client.query<MessageRow>(
            `SELECT ${messageSelect} FROM social_messages
              WHERE sender_user_id = $1 AND client_message_id = $2 LIMIT 1`,
            [actorUserId, clientMessageId])
          if (prior.rows[0]) {
            if (prior.rows[0].conversation_id !== conversationId || prior.rows[0].body !== body) throw new MessagingStoreError('CONFLICT', 409)
            return prior.rows[0]
          }
          const sequenceResult = await client.query<{ last_sequence: string }>(
            `UPDATE social_conversations SET last_sequence = last_sequence + 1, updated_at = CURRENT_TIMESTAMP
              WHERE conversation_id = $1 RETURNING last_sequence::text AS last_sequence`,
            [conversationId])
          const sequence = sequenceResult.rows[0]?.last_sequence
          if (!sequence) throw new MessagingStoreError()
          const inserted = await client.query<MessageRow>(
            `INSERT INTO social_messages
              (message_id, conversation_id, sender_user_id, sequence, client_message_id, body, created_at)
             VALUES ($1, $2, $3, $4::bigint, $5, $6, CURRENT_TIMESTAMP)
             RETURNING ${messageSelect}`,
            [crypto.randomUUID(), conversationId, actorUserId, sequence, clientMessageId, body])
          const message = inserted.rows[0]
          if (!message) throw new MessagingStoreError()
          await client.query(
            `UPDATE social_conversations SET last_message_id = $2 WHERE conversation_id = $1`,
            [conversationId, message.message_id])
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
               JOIN social_conversation_memberships peer
                 ON peer.conversation_id = message.conversation_id AND peer.user_id <> $1 AND peer.left_at IS NULL
              WHERE message.sender_user_id = $1 AND message.client_message_id = $2
                AND NOT EXISTS (
                  SELECT 1 FROM social_user_interactions blocked
                   WHERE blocked.relation_type = 'block'
                     AND ((blocked.actor_user_id = mine.user_id AND blocked.target_user_id = peer.user_id)
                       OR (blocked.actor_user_id = peer.user_id AND blocked.target_user_id = mine.user_id))
                )
              LIMIT 1`, [actorUserId, clientMessageId])
          if (prior.rows[0]) {
            if (prior.rows[0].conversation_id === conversationId && prior.rows[0].body === body) return prior.rows[0]
            throw new MessagingStoreError('CONFLICT', 409)
          }
        } catch (retryError) {
          if (retryError instanceof MessagingStoreError) throw retryError
        }
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
