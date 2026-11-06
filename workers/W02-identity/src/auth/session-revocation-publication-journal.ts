import { assertSessionRevokedEvent } from './session-revocation-events.js'

type JournalRow = { journalId: string; payload: string; attempt: number }
type PublicationEnv = { D1_01: D1Database; AUTH013_QUEUE: Queue }
type JournalSelectResult = { success?: boolean; results?: JournalRow[] | null }

const MAX_BATCH = 10
const MAX_BACKOFF_SECONDS = 300

type FailureStage = 'select-pending' | 'mark-invalid-payload' | 'mark-retry' | 'mark-published'

function failAtStage(stage: FailureStage): never {
  console.error('W02 scheduled publication stage failed', { task: 'session-audit', stage })
  throw new Error('SESSION_AUDIT_PUBLICATION_STAGE_FAILED')
}

function retryDelaySeconds(attempt: number): number {
  return Math.min(2 ** Math.max(0, attempt - 1), MAX_BACKOFF_SECONDS)
}

/** Publish AUTH-010 session audit events through the already provisioned W02->W06 audit queue. */
export async function publishPendingSessionRevocationEvents(
  env: PublicationEnv,
  now = new Date().toISOString(),
): Promise<{ selected: number; published: number; failed: number }> {
  let rows: JournalSelectResult
  try {
    rows = await env.D1_01.prepare(
      'SELECT journal_id AS journalId, payload, attempt FROM auth_010_session_revocation_journal ' +
      'WHERE status = ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ' +
      'ORDER BY created_at ASC LIMIT ?',
    ).bind('PENDING', now, MAX_BATCH).all<JournalRow>()
    if (rows.success !== true || !Array.isArray(rows.results)) return failAtStage('select-pending')
  } catch {
    return failAtStage('select-pending')
  }

  let published = 0
  let failed = 0
  for (const row of rows.results ?? []) {
    let payload: Awaited<ReturnType<typeof assertSessionRevokedEvent>>
    try {
      payload = await assertSessionRevokedEvent(JSON.parse(row.payload))
    } catch {
      let result: D1Result
      try {
        result = await env.D1_01.prepare(
          'UPDATE auth_010_session_revocation_journal SET status = ?, next_attempt_at = NULL, ' +
          'last_error_code = ? WHERE journal_id = ? AND status = ?',
        ).bind('FAILED', 'INVALID_EVENT_PAYLOAD', row.journalId, 'PENDING').run()
      } catch {
        return failAtStage('mark-invalid-payload')
      }
      if (result.success !== true || result.meta?.changes !== 1) return failAtStage('mark-invalid-payload')
      failed += 1
      continue
    }

    try {
      await env.AUTH013_QUEUE.send(payload)
    } catch {
      const delay = retryDelaySeconds(row.attempt)
      const nextAttemptAt = new Date(Date.parse(now) + delay * 1000).toISOString()
      let result: D1Result
      try {
        result = await env.D1_01.prepare(
          'UPDATE auth_010_session_revocation_journal SET status = ?, attempt = attempt + 1, ' +
          'next_attempt_at = ?, last_error_code = ? WHERE journal_id = ? AND status = ?',
        ).bind('PENDING', nextAttemptAt, 'QUEUE_DESTINATION_FAILED', row.journalId, 'PENDING').run()
      } catch {
        return failAtStage('mark-retry')
      }
      if (result.success !== true || result.meta?.changes !== 1) return failAtStage('mark-retry')
      failed += 1
      continue
    }

    let result: D1Result
    try {
      result = await env.D1_01.prepare(
        'UPDATE auth_010_session_revocation_journal SET status = ?, published_at = ?, ' +
        'next_attempt_at = NULL, last_error_code = NULL WHERE journal_id = ? AND status = ?',
      ).bind('PUBLISHED', now, row.journalId, 'PENDING').run()
    } catch {
      return failAtStage('mark-published')
    }
    if (result.success !== true || result.meta?.changes !== 1) return failAtStage('mark-published')
    published += 1
  }

  return { selected: rows.results?.length ?? 0, published, failed }
}
