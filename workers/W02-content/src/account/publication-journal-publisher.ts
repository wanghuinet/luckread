type PublicationJournalRow = {
  journalId: string
  payload: string
  attempt: number
}

type PublicationQueueEnv = {
  D1_01: D1Database
  AUTH013_QUEUE: Queue
}

const MAX_BATCH = 10
const MAX_BACKOFF_SECONDS = 300

function retryDelaySeconds(attempt: number): number {
  return Math.min(2 ** Math.max(0, attempt - 1), MAX_BACKOFF_SECONDS)
}

export async function publishPendingAccountStateEvents(
  env: PublicationQueueEnv,
  now = new Date().toISOString(),
): Promise<{ selected: number; published: number; failed: number }> {
  const rows = await env.D1_01
    .prepare(
      'SELECT journal_id AS journalId, payload, attempt FROM auth_013_publication_journal WHERE status = ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at ASC LIMIT ?',
    )
    .bind('PENDING', now, MAX_BATCH)
    .all<PublicationJournalRow>()

  let published = 0
  let failed = 0

  for (const row of rows.results ?? []) {
    let payload: unknown
    try {
      payload = JSON.parse(row.payload)
    } catch {
      await env.D1_01
        .prepare(
          'UPDATE auth_013_publication_journal SET status = ?, last_error_code = ?, next_attempt_at = NULL WHERE journal_id = ? AND status = ?',
        )
        .bind('FAILED', 'INVALID_EVENT_PAYLOAD', row.journalId, 'PENDING')
        .run()
      failed += 1
      continue
    }

    try {
      await env.AUTH013_QUEUE.send(payload)

      const result = await env.D1_01
        .prepare(
          'UPDATE auth_013_publication_journal SET status = ?, published_at = ?, next_attempt_at = NULL, last_error_code = NULL WHERE journal_id = ? AND status = ?',
        )
        .bind('PUBLISHED', now, row.journalId, 'PENDING')
        .run()

      if (result.meta?.changes === 1) {
        published += 1
      }
    } catch {
      const delay = retryDelaySeconds(row.attempt)
      const nextAttemptAt = new Date(Date.parse(now) + delay * 1000).toISOString()

      await env.D1_01
        .prepare(
          'UPDATE auth_013_publication_journal SET status = ?, attempt = attempt + 1, next_attempt_at = ?, last_error_code = ? WHERE journal_id = ? AND status = ?',
        )
        .bind('PENDING', nextAttemptAt, 'QUEUE_SEND_FAILED', row.journalId, 'PENDING')
        .run()

      failed += 1
    }
  }

  return {
    selected: rows.results?.length ?? 0,
    published,
    failed,
  }
}
