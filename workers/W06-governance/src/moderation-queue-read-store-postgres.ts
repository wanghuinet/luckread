import {
  ModerationQueueReadStoreError,
  type ModerationQueueReadInput,
  type ModerationQueueReadRow,
  type ModerationQueueReadStore,
} from './moderation-queue-read-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; the Worker does not bundle a Node driver. */
export interface ModerationQueuePostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/**
 * PostgreSQL read adapter for the existing W06 reviewer queue.
 * Timestamps are returned as six-digit UTC text so the opaque keyset cursor
 * does not lose PostgreSQL microsecond precision through JavaScript Date.
 */
export function createPostgresModerationQueueReadStore(
  db: ModerationQueuePostgresQueryExecutor,
): ModerationQueueReadStore {
  return {
    async list(input: ModerationQueueReadInput) {
      const values: unknown[] = [[...input.openStates], input.reviewerId]
      let cursorPredicate = ''

      if (input.cursor) {
        const priorityParameter = values.length + 1
        const createdAtParameter = values.length + 2
        const caseIdParameter = values.length + 3
        cursorPredicate = [
          ' AND (c.priority < $' + priorityParameter,
          '      OR (c.priority = $' + priorityParameter + ' AND (',
          '        c.created_at > $' + createdAtParameter + '::timestamptz',
          '        OR (c.created_at = $' + createdAtParameter + '::timestamptz AND c.case_id > $' + caseIdParameter + ')',
          '      )))',
        ].join('\n')
        values.push(
          input.cursor.priority,
          input.cursor.createdAt,
          input.cursor.caseId,
        )
      }

      const limitParameter = values.length + 1
      values.push(input.limit)
      const sql = [
        'SELECT c.case_id,c.target_type,c.target_id,c.target_version,c.policy_version,c.state,c.priority,',
        '       c.assigned_reviewer_id,c.current_decision_id,c.evidence_bundle_ref,c.version,',
        '       to_char(c.created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS created_at,',
        '       to_char(c.updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS updated_at,',
        '       d.decision_id,d.case_version,d.outcome,d.policy_version AS decision_policy_version,',
        '       to_char(d.effective_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS decision_effective_at,',
        '       d.request_id AS decision_request_id,',
        '       to_char(d.created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS decision_created_at',
        '  FROM moderation_cases c',
        '  LEFT JOIN moderation_decisions d ON d.decision_id = c.current_decision_id',
        ' WHERE c.state = ANY($1::text[])',
        '   AND c.target_type = \'content\'',
        '   AND (c.assigned_reviewer_id IS NULL OR c.assigned_reviewer_id = $2)',
        cursorPredicate,
        ' ORDER BY c.priority DESC, c.created_at ASC, c.case_id ASC',
        ' LIMIT $' + limitParameter,
      ].filter((line) => line.length > 0).join('\n')

      try {
        const result = await db.query<ModerationQueueReadRow>(sql, values)
        return result.rows
      } catch {
        // Do not expose database driver errors, SQL, or connection details.
        throw new ModerationQueueReadStoreError()
      }
    },
  }
}
