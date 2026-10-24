import { MFA_AUDIT_EVENT_NAMES } from './mfa-audit-events.js'

type JournalRow = { journalId: string; payload: string; attempt: number }
type PublicationEnv = { D1_01: D1Database; AUTH013_QUEUE: Queue }

const MAX_BATCH = 10
const MAX_BACKOFF_SECONDS = 300
const validEventNames = new Set<string>(MFA_AUDIT_EVENT_NAMES)

function retryDelaySeconds(attempt: number): number {
  return Math.min(2 ** Math.max(0, attempt - 1), MAX_BACKOFF_SECONDS)
}

/**
 * Publish AUTH-007 events through the already provisioned W02->W06 audit queue.
 * The W02 D1-01 outbox remains durable until queue acceptance; consumer
 * idempotency is required because queue delivery is at-least-once.
 */
export async function publishPendingMfaAuditEvents(
  env: PublicationEnv,
  now = new Date().toISOString(),
): Promise<{ selected: number; published: number; failed: number }> {
  const rows = await env.D1_01.prepare(
    'SELECT journal_id AS journalId, payload, attempt FROM auth_007_mfa_publication_journal ' +
    'WHERE status = ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ' +
    'ORDER BY created_at ASC LIMIT ?',
  ).bind('PENDING', now, MAX_BATCH).all<JournalRow>()

  let published = 0
  let failed = 0

  for (const row of rows.results ?? []) {
    let eventType: unknown
    try {
      const payload = JSON.parse(row.payload) as { eventType?: unknown }
      eventType = payload?.eventType
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
          typeof eventType !== 'string' || !validEventNames.has(eventType)) {
        throw new Error('INVALID_AUTH_007_MFA_EVENT')
      }
      await env.AUTH013_QUEUE.send(payload)
    } catch (error) {
      const malformed = error instanceof Error && error.message === 'INVALID_AUTH_007_MFA_EVENT'
      const delay = retryDelaySeconds(row.attempt)
      const nextAttemptAt = new Date(Date.parse(now) + delay * 1000).toISOString()
      await env.D1_01.prepare(
        'UPDATE auth_007_mfa_publication_journal SET status = ?, attempt = attempt + 1, ' +
        'next_attempt_at = ?, last_error_code = ? WHERE journal_id = ? AND status = ?',
      ).bind(
        malformed ? 'FAILED' : 'PENDING',
        malformed ? null : nextAttemptAt,
        malformed ? 'INVALID_EVENT_PAYLOAD' : 'QUEUE_DESTINATION_FAILED',
        row.journalId,
        'PENDING',
      ).run()
      failed += 1
      continue
    }

    const result = await env.D1_01.prepare(
      'UPDATE auth_007_mfa_publication_journal SET status = ?, published_at = ?, ' +
      'next_attempt_at = NULL, last_error_code = NULL WHERE journal_id = ? AND status = ?',
    ).bind('PUBLISHED', now, row.journalId, 'PENDING').run()

    if (result.meta?.changes === 1) published += 1
  }

  return { selected: rows.results?.length ?? 0, published, failed }
}
