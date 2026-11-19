export interface ModerationCaseDetailReadRow extends Record<string, unknown> {
  case_id: string
  target_type: string
  target_id: string
  target_version: number | null
  policy_version: string
  state: string
  priority: number
  assigned_reviewer_id: string | null
  current_decision_id: string | null
  evidence_bundle_ref: string | null
  version: number
  created_at: string
  updated_at: string
  decision_id: string | null
  case_version: number | null
  outcome: string | null
  decision_policy_version: string | null
  decision_effective_at: string | null
  reason_code: string | null
  severity: string | null
  scope: string | null
  decision_expires_at: string | null
  source_kind: string | null
  reviewer_id: string | null
  reviewer_layer: string | null
  request_id: string | null
  decision_created_at: string | null
  decision_target_type: string | null
  decision_target_id: string | null
  decision_target_version: number | null
}

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres contract; W06 obtains the shared pool from Hyperdrive. */
export interface ModerationCaseDetailPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

export class ModerationCaseDetailReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('MODERATION_CASE_READ_UNAVAILABLE')
    this.name = 'ModerationCaseDetailReadStoreError'
  }
}

export interface ModerationCaseDetailReadStore {
  get(caseId: string, reviewerId: string): Promise<ModerationCaseDetailReadRow | null>
}

const CASE_DETAIL_SQL = [
  'SELECT c.case_id,c.target_type,c.target_id,c.target_version,c.policy_version,c.state,c.priority,',
  '       c.assigned_reviewer_id,c.current_decision_id,c.evidence_bundle_ref,c.version,',
  '       to_char(c.created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS created_at,',
  '       to_char(c.updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS updated_at,',
  '       d.decision_id,d.case_version,d.outcome,',
  '       d.policy_version AS decision_policy_version,',
  '       to_char(d.effective_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS decision_effective_at,',
  '       d.reason_code,d.severity,d.scope,',
  '       to_char(d.expires_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS decision_expires_at,',
  '       d.source_kind,d.reviewer_id,d.reviewer_layer,d.request_id,',
  '       to_char(d.created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS decision_created_at,',
  '       d.target_type AS decision_target_type,d.target_id AS decision_target_id,',
  '       d.target_version AS decision_target_version',
  '  FROM moderation_cases c',
  '  LEFT JOIN moderation_decisions d ON d.decision_id = c.current_decision_id',
  ' WHERE c.case_id = $1',
  '   AND c.target_type = \'content\'',
  '   AND (c.assigned_reviewer_id IS NULL OR c.assigned_reviewer_id = $2)',
  ' LIMIT 1',
].join('\n')

/** Native PostgreSQL detail read, preserving reviewer scope and UTC microseconds. */
export function createPostgresModerationCaseDetailReadStore(
  db: ModerationCaseDetailPostgresQueryExecutor,
): ModerationCaseDetailReadStore {
  return {
    async get(caseId, reviewerId) {
      try {
        const result = await db.query<ModerationCaseDetailReadRow>(
          CASE_DETAIL_SQL,
          [caseId, reviewerId],
        )
        return result.rows[0] ?? null
      } catch {
        // Keep driver errors, connection details and SQL out of the API boundary.
        throw new ModerationCaseDetailReadStoreError()
      }
    },
  }
}
