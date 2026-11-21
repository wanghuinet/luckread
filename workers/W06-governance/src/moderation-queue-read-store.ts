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

export class ModerationQueueReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('MODERATION_QUEUE_READ_UNAVAILABLE')
    this.name = 'ModerationQueueReadStoreError'
  }
}
