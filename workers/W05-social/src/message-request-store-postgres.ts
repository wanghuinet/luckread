import { MessageRequestStoreError, type MessageRequestRow, type MessageRequestStore, type MessageRequestPage } from './message-request-store.js'
type QueryResult<Row> = Readonly<{ rows: Row[]; rowCount?: number | null }>
interface PgClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>
  release(): void
}
export interface MessageRequestPostgresExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>
  connect(): Promise<PgClient>
}
const validId = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
const requestSelect = `request_id, sender_user_id, recipient_user_id, initial_message, status,
  conversation_id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  CASE WHEN responded_at IS NULL THEN NULL ELSE to_char(responded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS responded_at`
const encodeCursor = (date: string, id: string) => btoa(date + '|' + id).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '')
function decodeCursor(value: string | null): { date: string; id: string } | null {
  if (!value) return null
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new MessageRequestStoreError('INVALID_CURSOR', 400)
  try {
    const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4))
    const [date, id, ...extra] = raw.split('|')
    if (extra.length || !date || !Number.isFinite(Date.parse(date)) || !id || !validId(id)) throw new Error()
    return { date, id }
  } catch { throw new MessageRequestStoreError('INVALID_CURSOR', 400) }
}
async function transaction<T>(db: MessageRequestPostgresExecutor, run: (client: PgClient) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try { await client.query('BEGIN'); const value = await run(client); await client.query('COMMIT'); return value }
  catch (error) { try { await client.query('ROLLBACK') } catch {} throw error }
  finally { client.release() }
}
export function createPostgresMessageRequestStore(db: MessageRequestPostgresExecutor): MessageRequestStore {
  return {
    async createRequest(actor, recipient, clientRequestId, body) {
      if (![actor, recipient, clientRequestId].every(validId) || actor === recipient || body.length < 1 || body.length > 1000) {
        throw new MessageRequestStoreError('VALIDATION_FAILED', 422)
      }
      try {
        return await transaction(db, async client => {
          const blocked = await client.query(`SELECT 1 FROM social_user_interactions WHERE relation_type = 'block'
            AND ((actor_user_id = $1 AND target_user_id = $2) OR (actor_user_id = $2 AND target_user_id = $1)) LIMIT 1`, [actor, recipient])
          if (blocked.rows.length) throw new MessageRequestStoreError('PERMISSION_DENIED', 403)
          const prior = await client.query<MessageRequestRow>(`SELECT ${requestSelect} FROM social_message_requests
            WHERE sender_user_id = $1 AND client_request_id = $2 LIMIT 1`, [actor, clientRequestId])
          if (prior.rows[0]) {
            if (prior.rows[0].recipient_user_id !== recipient || prior.rows[0].initial_message !== body) throw new MessageRequestStoreError('CONFLICT', 409)
            return prior.rows[0]
          }
          const mutual = await client.query(`SELECT 1 FROM social_follow_relationships a
            JOIN social_follow_relationships b ON b.follower_user_id = a.target_user_id AND b.target_user_id = a.follower_user_id
            WHERE a.follower_user_id = $1 AND a.target_user_id = $2 LIMIT 1`, [actor, recipient])
          if (mutual.rows.length) throw new MessageRequestStoreError('CONTACT_POLICY_ALREADY_OPEN', 409)
          const duplicatePending = await client.query(`SELECT 1 FROM social_message_requests
            WHERE status = 'pending' AND ((sender_user_id = $1 AND recipient_user_id = $2)
              OR (sender_user_id = $2 AND recipient_user_id = $1)) LIMIT 1`, [actor, recipient])
          if (duplicatePending.rows.length) throw new MessageRequestStoreError('REQUEST_ALREADY_PENDING', 409)
          const quota = await client.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM social_message_requests
            WHERE sender_user_id = $1 AND created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'`, [actor])
          if ((quota.rows[0]?.count ?? 0) >= 10) throw new MessageRequestStoreError('RATE_LIMITED', 429)
          const inserted = await client.query<MessageRequestRow>(`INSERT INTO social_message_requests
            (request_id, sender_user_id, recipient_user_id, client_request_id, initial_message, status)
            VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING ${requestSelect}`,
            [crypto.randomUUID(), actor, recipient, clientRequestId, body])
          if (!inserted.rows[0]) throw new MessageRequestStoreError('SERVICE_UNAVAILABLE', 503)
          await client.query(`INSERT INTO social_message_request_audit
            (audit_id, request_id, actor_user_id, action, metadata)
            VALUES ($1, $2, $3, 'created', '{}'::jsonb)`,
            [crypto.randomUUID(), inserted.rows[0].request_id, actor])
          return inserted.rows[0]
        })
      } catch (error) {
        if (error instanceof MessageRequestStoreError) throw error
        if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
          const prior = await db.query<MessageRequestRow>(`SELECT ${requestSelect} FROM social_message_requests
            WHERE sender_user_id = $1 AND client_request_id = $2 LIMIT 1`, [actor, clientRequestId])
          if (prior.rows[0]) {
            if (prior.rows[0].recipient_user_id === recipient && prior.rows[0].initial_message === body) return prior.rows[0]
            throw new MessageRequestStoreError('CONFLICT', 409)
          }
          throw new MessageRequestStoreError('REQUEST_ALREADY_PENDING', 409)
        }
        throw new MessageRequestStoreError('SERVICE_UNAVAILABLE', 503)
      }
    },
    async listRequests(actor, direction, cursor, limit) {
      if (!validId(actor)) throw new MessageRequestStoreError('UNAUTHENTICATED', 401)
      const decoded = decodeCursor(cursor)
      const ownerColumn = direction === 'incoming' ? 'recipient_user_id' : 'sender_user_id'
      const peerColumn = direction === 'incoming' ? 'sender_user_id' : 'recipient_user_id'
      try {
        const result = await db.query<MessageRequestRow>(`SELECT ${requestSelect} FROM social_message_requests r
          WHERE r.${ownerColumn} = $1 AND r.status = 'pending'
            AND ($2::timestamptz IS NULL OR (r.created_at, r.request_id) < ($2::timestamptz, $3::text))
            AND NOT EXISTS (SELECT 1 FROM social_user_interactions b WHERE b.relation_type = 'block'
              AND ((b.actor_user_id = $1 AND b.target_user_id = r.${peerColumn})
                OR (b.actor_user_id = r.${peerColumn} AND b.target_user_id = $1)))
          ORDER BY r.created_at DESC, r.request_id DESC LIMIT $4`,
          [actor, decoded?.date ?? null, decoded?.id ?? null, limit + 1])
        const hasMore = result.rows.length > limit
        const items = result.rows.slice(0, limit)
        const last = items[items.length - 1]
        return { items, hasMore, nextCursor: hasMore && last ? encodeCursor(last.created_at, last.request_id) : null }
      } catch (error) {
        if (error instanceof MessageRequestStoreError) throw error
        throw new MessageRequestStoreError('SERVICE_UNAVAILABLE', 503)
      }
    },
    async respondRequest(actor, requestId, action) {
      if (!validId(actor) || !validId(requestId)) throw new MessageRequestStoreError('VALIDATION_FAILED', 422)
      try {
        return await transaction(db, async client => {
          const locked = await client.query<MessageRequestRow>(`SELECT ${requestSelect} FROM social_message_requests
            WHERE request_id = $1 FOR UPDATE`, [requestId])
          const request = locked.rows[0]
          if (!request) throw new MessageRequestStoreError('NOT_FOUND', 404)
          const expectedOwner = action === 'cancel' ? request.sender_user_id : request.recipient_user_id
          if (expectedOwner !== actor) throw new MessageRequestStoreError('NOT_FOUND', 404)
          if (request.status !== 'pending') {
            if (action === 'accept' && request.status === 'accepted' && request.conversation_id) {
              return { status: request.status, conversationId: request.conversation_id }
            }
            throw new MessageRequestStoreError('CONFLICT', 409)
          }
          if (action === 'cancel' || action === 'decline') {
            const status = action === 'cancel' ? 'cancelled' : 'declined'
            await client.query(`UPDATE social_message_requests SET status = $2, responded_at = CURRENT_TIMESTAMP WHERE request_id = $1`, [requestId, status])
            await client.query(`INSERT INTO social_message_request_audit
              (audit_id, request_id, actor_user_id, action, metadata)
              VALUES ($1, $2, $3, $4, '{}'::jsonb)`,
              [crypto.randomUUID(), requestId, actor, status])
            return { status, conversationId: null }
          }
          const blocked = await client.query(`SELECT 1 FROM social_user_interactions WHERE relation_type = 'block'
            AND ((actor_user_id = $1 AND target_user_id = $2) OR (actor_user_id = $2 AND target_user_id = $1)) LIMIT 1`,
            [request.sender_user_id, request.recipient_user_id])
          if (blocked.rows.length) throw new MessageRequestStoreError('PERMISSION_DENIED', 403)
          const [left, right] = [request.sender_user_id, request.recipient_user_id].sort()
          const pairKey = left + ':' + right
          const created = await client.query<{ conversation_id: string }>(`INSERT INTO social_conversations
            (conversation_id, conversation_type, direct_pair_key, created_by_user_id, last_sequence, created_at, updated_at)
            VALUES ($1, 'direct', $2, $3, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (direct_pair_key) DO UPDATE SET updated_at = social_conversations.updated_at
            RETURNING conversation_id`, [crypto.randomUUID(), pairKey, request.sender_user_id])
          const conversationId = created.rows[0]?.conversation_id
          if (!conversationId) throw new MessageRequestStoreError('SERVICE_UNAVAILABLE', 503)
          await client.query(`INSERT INTO social_conversation_memberships
            (conversation_id, user_id, member_role, joined_at, last_read_sequence)
            VALUES ($1, $2, 'owner', CURRENT_TIMESTAMP, 0), ($1, $3, 'member', CURRENT_TIMESTAMP, 0)
            ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL, archived_at = NULL, joined_at = CURRENT_TIMESTAMP`,
            [conversationId, request.sender_user_id, request.recipient_user_id])
          const seq = await client.query<{ last_sequence: string }>(`UPDATE social_conversations SET last_sequence = last_sequence + 1,
            updated_at = CURRENT_TIMESTAMP WHERE conversation_id = $1 RETURNING last_sequence::text AS last_sequence`, [conversationId])
          const sequence = seq.rows[0]?.last_sequence
          if (!sequence) throw new MessageRequestStoreError('SERVICE_UNAVAILABLE', 503)
          const messageId = crypto.randomUUID()
          await client.query(`INSERT INTO social_messages
            (message_id, conversation_id, sender_user_id, sequence, client_message_id, body, created_at)
            VALUES ($1, $2, $3, $4::bigint, $5, $6, CURRENT_TIMESTAMP)`,
            [messageId, conversationId, request.sender_user_id, sequence, 'request:' + request.request_id, request.initial_message])
          await client.query(`UPDATE social_conversations SET last_message_id = $2 WHERE conversation_id = $1`, [conversationId, messageId])
          await client.query(`UPDATE social_message_requests SET status = 'accepted', conversation_id = $2,
            responded_at = CURRENT_TIMESTAMP WHERE request_id = $1`, [requestId, conversationId])
          await client.query(`INSERT INTO social_message_request_audit
            (audit_id, request_id, actor_user_id, action, metadata)
            VALUES ($1, $2, $3, 'accepted', '{}'::jsonb)`,
            [crypto.randomUUID(), requestId, actor])
          return { status: 'accepted', conversationId }
        })
      } catch (error) {
        if (error instanceof MessageRequestStoreError) throw error
        throw new MessageRequestStoreError('SERVICE_UNAVAILABLE', 503)
      }
    },
  }
}
