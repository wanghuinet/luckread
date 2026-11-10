export type ModerationQueueReadCursor = Readonly<{
  priority: number
  createdAt: string
  caseId: string
}> | null

export type ModerationQueueReadInput = Readonly<{
  reviewerId: string
  openStates: readonly string[]
  cursor: ModerationQueueReadCursor
  limit: number
}>

export type ModerationQueueReadRow = Readonly<{
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
  decision_request_id: string | null
  decision_created_at: string | null
}>

export interface ModerationQueueReadStore {
  list(input: ModerationQueueReadInput): Promise<readonly ModerationQueueReadRow[]>
}

export interface ModerationQueueD1QueryExecutor {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results?: T[] | null }>
    }
  }
}

export class ModerationQueueReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('MODERATION_QUEUE_READ_UNAVAILABLE')
    this.name = 'ModerationQueueReadStoreError'
  }
}

/** D1 remains the production default and preserves the current queue query. */
export function createD1ModerationQueueReadStore(
  db: ModerationQueueD1QueryExecutor,
): ModerationQueueReadStore {
  return {
    async list(input) {
      const statePlaceholders = input.openStates.map(() => '?').join(',')
      const values: unknown[] = [...input.openStates, input.reviewerId]
      let cursorPredicate = ''

      if (input.cursor) {
        cursorPredicate = [
          ' AND (c.priority < ? OR (c.priority = ? AND (c.created_at > ? OR (c.created_at = ? AND c.case_id > ?))))',
        ].join('')
        values.push(
          input.cursor.priority,
          input.cursor.priority,
          input.cursor.createdAt,
          input.cursor.createdAt,
          input.cursor.caseId,
        )
      }

      values.push(input.limit)
      const result = await db.prepare(
        `SELECT c.case_id,c.target_type,c.target_id,c.target_version,c.policy_version,c.state,c.priority,
                c.assigned_reviewer_id,c.current_decision_id,c.evidence_bundle_ref,c.version,c.created_at,c.updated_at,
                d.decision_id,d.case_version,d.outcome,d.policy_version AS decision_policy_version,
                d.effective_at AS decision_effective_at,d.request_id AS decision_request_id,
                d.created_at AS decision_created_at
           FROM moderation_cases c
           LEFT JOIN moderation_decisions d ON d.decision_id = c.current_decision_id
          WHERE c.state IN (${statePlaceholders})
            AND c.target_type = 'content'
            AND (c.assigned_reviewer_id IS NULL OR c.assigned_reviewer_id = ?)
            ${cursorPredicate}
          ORDER BY c.priority DESC, c.created_at ASC, c.case_id ASC
          LIMIT ?`,
      ).bind(...values).all<ModerationQueueReadRow>()

      return result.results ?? []
    },
  }
}
