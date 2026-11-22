export interface MessagingOutboxRow extends Record<string, unknown> {
  event_id: string
  conversation_id: string
  actor_user_id: string
  event_type: 'message.created' | 'message.edited' | 'message.recalled' | 'conversation.read' | 'group.member.added' | 'group.member.removed' | 'group.member.left' | 'group.owner.transferred'
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

async function persistDeliveryResults(
  db: MessagingOutboxDatabase,
  deliveredIds: string[],
  retries: Array<{ eventId: string; error: string }>,
): Promise<void> {
  if (!deliveredIds.length && !retries.length) return;
  await db.query(
    `WITH delivered AS (
       UPDATE social_messaging_outbox
          SET delivered_at = CURRENT_TIMESTAMP, locked_until = NULL, last_error = NULL
        WHERE event_id::text = ANY($1::text[]) AND delivered_at IS NULL
       RETURNING event_id
     ),
     retried AS (
       UPDATE social_messaging_outbox outbox
          SET locked_until = NULL,
              available_at = CURRENT_TIMESTAMP +
                make_interval(secs => LEAST(3600, (POWER(2, LEAST(outbox.attempt_count, 12)))::integer)),
              last_error = retry.last_error
         FROM unnest($2::text[], $3::text[]) AS retry(event_id, last_error)
        WHERE outbox.event_id::text = retry.event_id AND outbox.delivered_at IS NULL
       RETURNING outbox.event_id
     )
     SELECT (SELECT COUNT(*) FROM delivered) AS delivered_count,
            (SELECT COUNT(*) FROM retried) AS retried_count`,
    [deliveredIds, retries.map((item) => item.eventId), retries.map((item) => item.error.slice(0, 160))],
  );
}

async function deliverOne(
  hub: MessagingRealtimeNamespace,
  row: ClaimedOutboxRow,
): Promise<{ eventId: string; delivered: boolean; error?: string }> {
  try {
    const room = hub.get(hub.idFromName(row.conversation_id));
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
    });
    return response.ok
      ? { eventId: row.event_id, delivered: true }
      : { eventId: row.event_id, delivered: false, error: 'hub_http_' + response.status };
  } catch (error) {
    return {
      eventId: row.event_id,
      delivered: false,
      error: error instanceof Error ? 'delivery_' + error.name : 'delivery_unknown',
    };
  }
}

/** At-least-once delivery. Hub calls are bounded-concurrent; Neon results flush once per batch. */
export async function dispatchMessagingOutboxBatch(
  db: MessagingOutboxDatabase,
  hub: MessagingRealtimeNamespace | undefined,
  limit = 25,
): Promise<{ claimed: number; delivered: number; retried: number }> {
  if (!hub) return { claimed: 0, delivered: 0, retried: 0 };
  const safeLimit = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 25;
  const rows = await claimBatch(db, safeLimit);
  const results: Array<{ eventId: string; delivered: boolean; error?: string }> = [];
  // Keep fan-out pressure bounded even when the caller requests the hard 100-row batch.
  for (let offset = 0; offset < rows.length; offset += 5) {
    const chunk = rows.slice(offset, offset + 5);
    results.push(...await Promise.all(chunk.map((row) => deliverOne(hub, row))));
  }
  const deliveredIds = results.filter((item) => item.delivered).map((item) => item.eventId);
  const retries = results.filter((item) => !item.delivered).map((item) => ({
    eventId: item.eventId,
    error: item.error ?? 'delivery_unknown',
  }));
  await persistDeliveryResults(db, deliveredIds, retries);
  return { claimed: rows.length, delivered: deliveredIds.length, retried: retries.length };
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
