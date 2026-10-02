/// <reference types="@cloudflare/workers-types" />

export type ReportTargetType = 'content' | 'comment' | 'creator' | 'media' | 'profile'

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

export type ReportResult = {
  reportId: string
  targetType: ReportTargetType
  targetId: string
  reasonCode: string
  status: 'CREATED' | 'DEDUPLICATED'
  createdAt: string
}

export class ReportRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

const MAX_ID = 128
const MAX_REASON = 128
const MAX_DESCRIPTION = 4000
const MAX_EVIDENCE = 20
const MAX_EVIDENCE_REF = 512
const IDEMPOTENCY_TTL_HOURS = 24
const DEDUP_BUCKET_HOURS = 24
const DEFAULT_POLICY_VERSION = 'report-v1'

const resourceId = (value: string, code = 'VALIDATION_FAILED') => {
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_ID) throw new ReportRuntimeError(code, code === 'UNAUTHENTICATED' ? 401 : 400)
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
  db: D1Database,
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

  const requestHash = await hashRequest({
    targetType: input.targetType,
    targetId,
    reasonCode,
    description,
    evidenceRefs: evidenceRefs.map((ref) => ref.trim()),
  })
  const now = new Date()
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000).toISOString()
  const dedupBucket = toBucket(now)
  const policyVersion = (input.policyVersion?.trim() || DEFAULT_POLICY_VERSION)

  const existing = await db.prepare(
    `WITH idem AS (
       SELECT report_id, request_hash, response_json
       FROM moderation_report_idempotency
       WHERE actor_user_id = ? AND idempotency_key = ?
       LIMIT 1
     ),
     prior AS (
       SELECT report_id, target_type, target_id, reason_code, created_at
       FROM moderation_reports
       WHERE actor_user_id = ?
         AND target_type = ?
         AND target_id = ?
         AND reason_code = ?
         AND dedup_bucket = ?
       LIMIT 1
     )
     SELECT
       idem.report_id AS idem_report_id,
       idem.request_hash AS idem_request_hash,
       idem.response_json AS idem_response_json,
       prior.report_id AS prior_report_id,
       prior.target_type AS prior_target_type,
       prior.target_id AS prior_target_id,
       prior.reason_code AS prior_reason_code,
       prior.created_at AS prior_created_at
     FROM (SELECT 1) root
     LEFT JOIN idem ON 1 = 1
     LEFT JOIN prior ON 1 = 1`,
  ).bind(
    actorUserId,
    idempotencyKey,
    actorUserId,
    input.targetType,
    targetId,
    reasonCode,
    dedupBucket,
  ).first<{
    idem_report_id: string | null
    idem_request_hash: string | null
    idem_response_json: string | null
    prior_report_id: string | null
    prior_target_type: ReportTargetType | null
    prior_target_id: string | null
    prior_reason_code: string | null
    prior_created_at: string | null
  }>()

  if (existing?.idem_report_id) {
    if (existing.idem_request_hash !== requestHash) {
      throw new ReportRuntimeError('CONFLICT', 409)
    }
    if (!existing.idem_response_json) throw new ReportRuntimeError('REPORT_WRITE_FAILED', 500)
    return JSON.parse(existing.idem_response_json) as ReportResult
  }

  if (existing?.prior_report_id && existing.prior_target_type && existing.prior_target_id && existing.prior_reason_code && existing.prior_created_at) {
    const result: ReportResult = {
      reportId: existing.prior_report_id,
      targetType: existing.prior_target_type,
      targetId: existing.prior_target_id,
      reasonCode: existing.prior_reason_code,
      status: 'DEDUPLICATED',
      createdAt: existing.prior_created_at,
    }
    await db.prepare(
      'INSERT OR IGNORE INTO moderation_report_idempotency (id, actor_user_id, idempotency_key, request_hash, report_id, response_status, response_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      crypto.randomUUID(),
      actorUserId,
      idempotencyKey,
      requestHash,
      result.reportId,
      201,
      JSON.stringify(result),
      createdAt,
      expiresAt,
    ).run()
    return result
  }

  const reportIdentity = [actorUserId, input.targetType, targetId, reasonCode, dedupBucket].join('|')
  const reportDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(reportIdentity))
  const reportId = 'report_' + Array.from(new Uint8Array(reportDigest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  const result: ReportResult = {
    reportId,
    targetType: input.targetType,
    targetId,
    reasonCode,
    status: 'CREATED',
    createdAt,
  }
  const auditEventId = crypto.randomUUID()

  const reportStatement = db.prepare(
    'INSERT OR IGNORE INTO moderation_reports (report_id, actor_user_id, target_type, target_id, reason_code, description, evidence_refs_json, policy_version, dedup_bucket, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    reportId,
    actorUserId,
    input.targetType,
    targetId,
    reasonCode,
    description || null,
    JSON.stringify(evidenceRefs.map((ref) => ref.trim())),
    policyVersion,
    dedupBucket,
    createdAt,
  )

  const auditStatement = db.prepare(
    `INSERT INTO audit_events (
       event_id, request_id, trace_id, actor_json, action, target_type, target_id,
       before_json, after_json, reason, ip, user_agent, occurred_at
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE changes() = 1`,
  ).bind(
    auditEventId,
    input.requestId,
    input.correlationId,
    JSON.stringify({ actorId: actorUserId, actorType: 'user' }),
    'moderation.report.created',
    'Report',
    reportId,
    JSON.stringify({}),
    JSON.stringify({
      reportId,
      targetType: input.targetType,
      targetId,
      reasonCode,
      policyVersion,
      correlationId: input.correlationId,
    }),
    reasonCode,
    null,
    null,
    createdAt,
  )

  const idempotencyStatement = db.prepare(
    'INSERT OR IGNORE INTO moderation_report_idempotency (id, actor_user_id, idempotency_key, request_hash, report_id, response_status, response_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    crypto.randomUUID(),
    actorUserId,
    idempotencyKey,
    requestHash,
    reportId,
    201,
    JSON.stringify(result),
    createdAt,
    expiresAt,
  )

  const batch = await db.batch([reportStatement, auditStatement, idempotencyStatement])
  if (batch.some((item) => !item.success)) {
    throw new ReportRuntimeError('REPORT_WRITE_FAILED', 500)
  }
  return result
}
