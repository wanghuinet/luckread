import {
  ModerationReportWriteStoreError,
  type ModerationReportWriteStore,
  type ReportResult,
  type ReportTargetType,
} from './moderation-report-write-store.js'

export type { ReportResult, ReportTargetType } from './moderation-report-write-store.js'

export type ReportCreateInput = {
  actorUserId: string
  targetType: ReportTargetType
  targetId: string
  reasonCode: string
  description?: string
  evidenceRefs?: string[]
  idempotencyKey: string
  requestId: string
  correlationId: string
  policyVersion?: string
}

export class ReportRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

const MAX_REASON = 128
const MAX_DESCRIPTION = 4000
const MAX_EVIDENCE = 20
const MAX_EVIDENCE_REF = 512
const IDEMPOTENCY_TTL_HOURS = 24
const DEDUP_BUCKET_HOURS = 24
const DEFAULT_POLICY_VERSION = 'report-v1'

const resourceId = (value: string, code = 'VALIDATION_FAILED') => {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized)) {
    throw new ReportRuntimeError(code, code === 'UNAUTHENTICATED' ? 401 : 400)
  }
  return normalized
}

const hashRequest = async (input: {
  targetType: string
  targetId: string
  reasonCode: string
  description: string
  evidenceRefs: string[]
}): Promise<string> => {
  const canonical = JSON.stringify(input)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const toBucket = (date: Date): string => {
  const timestamp = Math.floor(date.getTime() / (DEDUP_BUCKET_HOURS * 60 * 60 * 1000))
  return String(timestamp)
}

const isValidTargetType = (value: unknown): value is ReportTargetType =>
  value === 'content' || value === 'comment' || value === 'creator' || value === 'media' || value === 'profile'

export async function createReport(
  store: ModerationReportWriteStore,
  input: ReportCreateInput,
): Promise<ReportResult> {
  const actorUserId = resourceId(input.actorUserId, 'UNAUTHENTICATED')
  const targetId = resourceId(input.targetId)
  if (!isValidTargetType(input.targetType)) throw new ReportRuntimeError('VALIDATION_FAILED', 400)

  const reasonCode = input.reasonCode.trim()
  if (!reasonCode || reasonCode.length > MAX_REASON) throw new ReportRuntimeError('VALIDATION_FAILED', 400)

  const description = input.description?.trim() ?? ''
  if (description.length > MAX_DESCRIPTION) throw new ReportRuntimeError('VALIDATION_FAILED', 400)

  const evidenceRefs = input.evidenceRefs ?? []
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length > MAX_EVIDENCE) {
    throw new ReportRuntimeError('VALIDATION_FAILED', 400)
  }
  for (const ref of evidenceRefs) {
    if (typeof ref !== 'string' || !ref.trim() || ref.length > MAX_EVIDENCE_REF) {
      throw new ReportRuntimeError('VALIDATION_FAILED', 400)
    }
  }

  const idempotencyKey = input.idempotencyKey.trim()
  if (!idempotencyKey || idempotencyKey.length > 256) {
    throw new ReportRuntimeError('PRECONDITION_REQUIRED', 428)
  }

  const normalizedEvidenceRefs = evidenceRefs.map((ref) => ref.trim())
  const requestHash = await hashRequest({
    targetType: input.targetType,
    targetId,
    reasonCode,
    description,
    evidenceRefs: normalizedEvidenceRefs,
  })
  const now = new Date()
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000).toISOString()
  const dedupBucket = toBucket(now)
  const policyVersion = input.policyVersion?.trim() || DEFAULT_POLICY_VERSION

  const reportIdentity = [actorUserId, input.targetType, targetId, reasonCode, dedupBucket].join('|')
  const reportDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(reportIdentity))
  const reportId = 'report_' + Array.from(new Uint8Array(reportDigest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  try {
    return await store.create({
      actorUserId,
      targetType: input.targetType,
      targetId,
      reasonCode,
      description,
      evidenceRefs: normalizedEvidenceRefs,
      policyVersion,
      dedupBucket,
      requestHash,
      idempotencyKey,
      idempotencyId: crypto.randomUUID(),
      reportId,
      auditEventId: crypto.randomUUID(),
      requestId: input.requestId,
      correlationId: input.correlationId,
      createdAt,
      expiresAt,
    })
  } catch (error) {
    if (error instanceof ModerationReportWriteStoreError) {
      throw new ReportRuntimeError(error.code, error.status)
    }
    throw new ReportRuntimeError('REPORT_WRITE_FAILED', 500)
  }
}
