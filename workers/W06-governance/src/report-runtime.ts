/// <reference types="@cloudflare/workers-types" />

import { persistAuditEvent } from './audit-event-persistence'

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
  const timestamp = Math.floor(date.getTime() / (DE​DUP_BUCKET_HOURS * 60 * 60 * 1000))
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

  const existingIdempotency = await db.prepare(
    'SELECT report_id, request_hash, response_json FROM moderation_report_idempotency WHERE actor_user_id = ? AND idempotency_key = ? LIMIT 1',
  ).bind(actorUserId, idempotencyKey).first<{
    report_id: string
    request_hash: string
    response_json: string
  }>()

  if (existingIdempotency) {
    if (existingIdempotency.request_hash !== requestHash) {
      throw new ReportRuntimeError('CONFLICT', 409)
    }
    return JSON.parse(existingIdempotency.response_json) as ReportResult
  }

  const existingReport = await db.prepare(
    'SELECT report_id, target_type, target_id, reason_code, created_at FROM moderation_reports WHERE actor_user_id = ? AND target_type = ? AND target_id = ? AND reason_code = ? AND dedup_bucket = ? LIMIT 1',
  ).bind(actorUserId, input.targetType, targetId, reasonCode, dedupBucket).first<{
    report_id: string
    target_type: ReportTargetType
    target_id: string
    reason_code: string
    created_at: string
  }>()

  if (existingReport) {
    const result: ReportResult = {
      reportId: existingReport.report_id,
      targetType: existingReport.target_type,
      targetId: existingReport.target_id,
      reasonCode: existingReport.reason_code,
      status: 'DEDUPLICATED',
      createdAt: existingReport.created_at,
    }
    const idemId = crypto.randomUUID()
    await db.prepare(
      'INSERT OR IGNORE INTO moderation_report_idempotency (id, actor_user_id, idempotency_key, request_hash, report_id, response_status, response_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      idemId,
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

  const reportId = crypto.randomUUID()
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
    'INSERT INTO moderation_reports (report_id, actor_user_id, target_type, target_id, reason_code, description, evidence_refs_json, policy_version, dedup_bucket, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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

  const idempotencyStatement = db.prepare(
    'INSERT INTO moderation_report_idempotency (id, actor_user_id, idempotency_key, request_hash, report_id, response_status, response_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
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

  const auditStatement = db.prepare(
    `INSERT INTO audit_events (
       event_id, request_id, trace_id, actor_json, action, target_type, target_id,
       before_json, after_json, reason, ip, user_agent, occurred_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  try {
    const batch = await db.batch([reportStatement, idempotencyStatement, auditStatement])
    if (batch.some((result) => !result.success)) {
      throw new ReportRuntimeError('REPORT_WRITE_FAILED', 500)
    }
    return result
  } catch (error) {
    if (error instanceof ReportRuntimeError) throw error
    const raced = await db.prepare(
      'SELECT report_id, target_type, target_id, reason_code, created_at FROM moderation_reports WHERE actor_user_id = ? AND target_type = ? AND target_id = ? AND reason_code = ? AND dedup_bucket = ? LIMIT 1',
    ).bind(actorUserId, input.targetType, targetId, reasonCode, dedupBucket).first<{
      report_id: string
      target_type: ReportTargetType
      target_id: string
      reason_code: string
      created_at: string
    }>()
    if (raced) {
      return {
        reportId: raced.report_id,
        targetType: raced.target_type,
        targetId: raced.target_id,
        reasonCode: raced.reason_code,
        status: 'DEDUPLICATED',
        createdAt: raced.created_at,
      }
    }
    throw error
  }
}
