export interface MessagingOutboxRow {
  event_id: string
  conversation_id: string
  actor_user_id: string
  event_type: 'message.created' | 'message.edited' | 'message.recalled' | 'conversation.read'
  payload: Record<string, unknown>
  created_at: string
  occurred_at: number
  attempt_count: number
}

export interface MessagingOutboxClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount?: number | null }>
  release(): void
}

export interface MessagingOutboxDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount?: number | null }>
  connect(): Promise<MessagingOutboxClient>
}

export interface MessagingRealtimeNamespace {
  idFromName(name: string): unknown
  get(id: unknown): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> }
}

type ClaimedOutboxRow = MessagingOutboxRow

async function claimBatch(db: MessagingOutboxDatabase, limit: number): Promise<ClaimedOutboxRow[]> {
  const result = await db.query<ClaimedOutboxRow>(
    `WITH candidates AS (
       SELECT event_id
         FROM social_messaging_outbox
        WHERE delivered_at IS NULL
          AND available_at <= CURRENT_TIMESTAMP
          AND (locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP)
        ORDER BY available_at ASC, created_at ASC, event_id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1
     )
     UPDATE social_messaging_outbox outbox
        SET attempt_count = outbox.attempt_count + 1,
            locked_until = CURRENT_TIMESTAMP + INTERVAL '45 seconds'
       FROM candidates
      WHERE outbox.event_id = candidates.event_id
     RETURNING outbox.event_id::text AS event_id,
               outbox.conversation_id,
               outbox.actor_user_id,
               outbox.event_type,
               outbox.payload,
               outbox.created_at::text AS created_at,
               (EXTRACT(EPOCH FROM outbox.created_at) * 1000)::double precision AS occurred_at,
               outbox.attempt_count`,
    [limit],
  )
  return result.rows
}

async function markDelivered(db: MessagingOutboxDatabase, eventId: string): Promise<void> {
  await db.query(
    `UPDATE social_messaging_outbox
        SET delivered_at = CURRENT_TIMESTAMP, locked_until = NULL, last_error = NULL
      WHERE event_id = $1 AND delivered_at IS NULL`,
    [eventId],
  )
}

async function scheduleRetry(db: MessagingOutboxDatabase, row: ClaimedOutboxRow, error: string): Promise<void> {
  await db.query(
    `UPDATE social_messaging_outbox
        SET locked_until = NULL,
            available_at = CURRENT_TIMESTAMP +
              make_interval(secs => LEAST(3600, (POWER(2, LEAST(attempt_count, 12)))::integer)),
            last_error = $2
      WHERE event_id = $1 AND delivered_at IS NULL`,
    [row.event_id, error.slice(0, 160)],
  )
}

async function deliverOne(
  db: MessagingOutboxDatabase,
  hub: MessagingRealtimeNamespace,
  row: ClaimedOutboxRow,
): Promise<boolean> {
  try {
    const room = hub.get(hub.idFromName(row.conversation_id))
    const response = await room.fetch('https://messaging-hub.internal/broadcast', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-LuckRead-Principal-User-Id': row.actor_user_id,
      },
      body: JSON.stringify({
        type: row.event_type,
        conversationId: row.conversation_id,
        actorUserId: row.actor_user_id,
        eventId: row.event_id,
        occurredAt: row.occurred_at,
        payload: row.payload,
      }),
    })
    if (!response.ok) {
      await scheduleRetry(db, row, 'hub_http_' + response.status)
      return false
    }
    await markDelivered(db, row.event_id)
    return true
  } catch (error) {
    await scheduleRetry(db, row, error instanceof Error ? 'delivery_' + error.name : 'delivery_unknown')
    return false
  }
}

/** At-least-once delivery. A lease recovers abandoned claims; event consumers must be idempotent. */
export async function dispatchMessagingOutboxBatch(
  db: MessagingOutboxDatabase,
  hub: MessagingRealtimeNamespace | undefined,
  limit = 25,
): Promise<{ claimed: number; delivered: number; retried: number }> {
  if (!hub) return { claimed: 0, delivered: 0, retried: 0 }
  const safeLimit = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 25
  const rows = await claimBatch(db, safeLimit)
  let delivered = 0
  for (const row of rows) {
    if (await deliverOne(db, hub, row)) delivered += 1
  }
  return { claimed: rows.length, delivered, retried: rows.length - delivered }
}

/** Bound cleanup work; delivered events are retained for seven days for incident inspection. */
export async function pruneDeliveredMessagingOutbox(
  db: MessagingOutboxDatabase,
  limit = 500,
): Promise<number> {
  const result = await db.query(
    `WITH expired AS (
       SELECT event_id FROM social_messaging_outbox
        WHERE delivered_at < CURRENT_TIMESTAMP - INTERVAL '7 days'
        ORDER BY delivered_at ASC
        LIMIT $1
     )
     DELETE FROM social_messaging_outbox outbox
      USING expired
      WHERE outbox.event_id = expired.event_id`,
    [Math.min(500, Math.max(1, Math.floor(limit)))],
  )
  return result.rowCount ?? 0
}
