export type ReportTargetType = 'content' | 'comment' | 'creator' | 'media' | 'profile'

export type ReportResult = {
  reportId: string
  targetType: ReportTargetType
  targetId: string
  reasonCode: string
  status: 'CREATED' | 'DEDUPLICATED'
  createdAt: string
}

export type ModerationReportWriteCommand = Readonly<{
  actorUserId: string
  targetType: ReportTargetType
  targetId: string
  reasonCode: string
  description: string
  evidenceRefs: string[]
  policyVersion: string
  dedupBucket: string
  requestHash: string
  idempotencyKey: string
  idempotencyId: string
  reportId: string
  auditEventId: string
  requestId: string
  correlationId: string
  createdAt: string
  expiresAt: string
}>

export interface ModerationReportWriteStore {
  create(command: ModerationReportWriteCommand): Promise<ReportResult>
}

export class ModerationReportWriteStoreError extends Error {
  constructor(readonly code: 'CONFLICT' | 'REPORT_WRITE_FAILED', readonly status: 409 | 500) {
    super(code)
  }
}
