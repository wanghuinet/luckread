import type { AuditActor, AuditEvent } from './audit-event'

const OPEN_QUEUE_STATES = ['OPEN', 'UNDER_REVIEW', 'ESCALATED', 'APPEALED'] as const
type ModerationCaseState =
  | 'OPEN'
  | 'UNDER_REVIEW'
  | 'ACTION_TAKEN'
  | 'NO_ACTION'
  | 'APPEALED'
  | 'APPEAL_UPHELD'
  | 'APPEAL_REJECTED'
  | 'ESCALATED'
  | 'CLOSED'

type ModerationOutcome = 'APPROVED' | 'REJECTED'

interface ModerationCaseRow {
  case_id: string
  target_type: string
  target_id: string
  target_version: number | null
  policy_version: string
  state: ModerationCaseState
  priority: number
  assigned_reviewer_id: string | null
  current_decision_id: string | null
  evidence_bundle_ref: string | null
  version: number
  created_at: string
  updated_at: string
}

interface ModerationDecisionRow {
  decision_id: string
  case_id: string
  case_version: number
  outcome: ModerationOutcome
  target_type: string
  target_id: string
  target_version: number | null
  policy_version: string
  reason_code: string
  severity: string
  scope: string
  effective_at: string
  expires_at: string | null
  source_kind: string
  reviewer_id: string | null
  reviewer_layer: string | null
  request_id: string
  created_at: string
}

interface IdempotencyRow {
  request_hash: string
  decision_id: string
  response_status: number
  response_json: string
  expires_at: string
}

export class ModerationRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
  }
}

const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const LAYER = /^L[0-8]$/
const REQUEST_ID = /^req_[A-Za-z0-9_-]{1,123}$/
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

const requireResource = (name: string, value: string): void => {
  if (!RESOURCE_ID.test(value)) throw new ModerationRuntimeError(`INVALID_${name.toUpperCase()}`, 400)
}

const requireLayer = (layer: string): void => {
  if (!LAYER.test(layer)) throw new ModerationRuntimeError('PERMISSION_DENIED', 403)
  if (Number(layer.slice(1)) < 6) throw new ModerationRuntimeError('PERMISSION_DENIED', 403)
}

const requireRequestId = (value: string): void => {
  if (!REQUEST_ID.test(value)) throw new ModerationRuntimeError('VALIDATION_FAILED', 400)
}

const normalizeEtag = (value: string): string => {
  const trimmed = value.trim()
  const match = /^(?:W\/)?"?v?(\d+)"?$/.exec(trimmed)
  if (!match) throw new ModerationRuntimeError('PRECONDITION_FAILED', 412)
  return match[1]
}

const opaqueCursor = (priority: number, createdAt: string, caseId: string): string => {
  const raw = JSON.stringify({ priority, createdAt, caseId })
  let binary = ''
  for (const byte of new TextEncoder().encode(raw)) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

const decodeCursor = (value: string): { priority: number; createdAt: string; caseId: string } => {
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
      priority?: unknown
      createdAt?: unknown
      caseId?: unknown
    }
    if (
      !Number.isInteger(parsed.priority) ||
      typeof parsed.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.caseId !== 'string'
    ) {
      throw new Error('INVALID')
    }
    requireResource('case_id', parsed.caseId)
    return { priority: parsed.priority, createdAt: parsed.createdAt, caseId: parsed.caseId }
  } catch {
    throw new ModerationRuntimeError('VALIDATION_FAILED', 400)
  }
}

const canonicalJson = (input: Record<string, unknown>): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(input)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, value]),
    ),
  )

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const requestHash = async (operationId: string, input: Record<string, unknown>): Promise<string> =>
  sha256Hex(canonicalJson({ operationId, ...input }))

const decisionIdFor = (hash: string): string => `dec_${hash.slice(0, 64)}`

const responseForCase = (row: ModerationCaseRow, decision: ModerationDecisionRow | null) => ({
  caseId: row.case_id,
  target: { targetType: row.target_type, targetId: row.target_id },
  contentReference: { contentId: row.target_id },
  policyVersion: row.policy_version,
  currentDecision: decision
    ? {
        decisionId: decision.decision_id,
        outcome: decision.outcome,
        policyVersion: decision.policy_version,
        effectiveAt: decision.effective_at,
      }
    : null,
  evidenceRefs: row.evidence_bundle_ref ? [row.evidence_bundle_ref] : [],
  status: row.state,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const readCase = async (db: D1Database, caseId: string, reviewerId: string): Promise<ModerationCaseRow | null> => {
  return db
    .prepare(
      `SELECT case_id,target_type,target_id,target_version,policy_version,state,priority,
              assigned_reviewer_id,current_decision_id,evidence_bundle_ref,version,created_at,updated_at
         FROM moderation_cases
        WHERE case_id = ?
          AND (assigned_reviewer_id IS NULL OR assigned_reviewer_id = ?)
        LIMIT 1`,
    )
    .bind(caseId, reviewerId)
    .first<ModerationCaseRow>()
}

const readCurrentDecision = async (db: D1Database, caseId: string): Promise<ModerationDecisionRow | null> =>
  db
    .prepare(
      `SELECT decision_id,case_id,case_version,outcome,target_type,target_id,target_version,
              policy_version,reason_code,severity,scope,effective_at,expires_at,source_kind,
              reviewer_id,reviewer_layer,request_id,created_at
         FROM moderation_decisions
        WHERE case_id = ?
        ORDER BY case_version DESC, created_at DESC
        LIMIT 1`,
    )
    .bind(caseId)
    .first<ModerationDecisionRow>()

export async function listModerationQueue(
  db: D1Database,
  reviewerId: string,
  cursor: string | null,
  requestedLimit: number | null,
): Promise<{ items: ReturnType<typeof responseForCase>[]; nextCursor: string | null; hasMore: boolean }> {
  requireResource('reviewer_id', reviewerId)
  const pageSize = Math.min(Math.max(Number.isInteger(requestedLimit) ? Number(requestedLimit) : 20, 1), 50)
  const decoded = cursor ? decodeCursor(cursor) : null
  const statePlaceholders = OPEN_QUEUE_STATES.map(() => '?').join(',')
  const params: unknown[] = [...OPEN_QUEUE_STATES, reviewerId]
  let tail = ''

  if (decoded) {
    tail = ' AND (priority < ? OR (priority = ? AND (created_at > ? OR (created_at = ? AND case_id > ?))))'
    params.push(decoded.priority, decoded.priority, decoded.createdAt, decoded.createdAt, decoded.caseId)
  }

  const rows = await db
    .prepare(
      `SELECT case_id,target_type,target_id,target_version,policy_version,state,priority,
              assigned_reviewer_id,current_decision_id,evidence_bundle_ref,version,created_at,updated_at
         FROM moderation_cases
        WHERE state IN (${statePlaceholders})
          AND (assigned_reviewer_id IS NULL OR assigned_reviewer_id = ?)
          ${tail}
        ORDER BY priority DESC, created_at ASC, case_id ASC
        LIMIT ?`,
    )
    .bind(...params, pageSize + 1)
    .all<ModerationCaseRow>()

  const hasMore = rows.results.length > pageSize
  const page = rows.results.slice(0, pageSize)
  const last = page.at(-1)
  const items = await Promise.all(
    page.map(async (row) => responseForCase(row, await readCurrentDecision(db, row.case_id))),
  )

  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? opaqueCursor(last.priority, last.created_at, last.case_id) : null,
  }
}

export async function getModerationCase(
  db: D1Database,
  reviewerId: string,
  caseId: string,
): Promise<ReturnType<typeof responseForCase>> {
  requireResource('reviewer_id', reviewerId)
  requireResource('case_id', caseId)
  const row = await readCase(db, caseId, reviewerId)
  if (!row) throw new ModerationRuntimeError('NOT_FOUND', 404)
  return responseForCase(row, await readCurrentDecision(db, caseId))
}

export async function decideModerationCase(
  db: D1Database,
  w03: Fetcher,
  input: {
    reviewerId: string
    reviewerLayer: string
    caseId: string
    ifMatch: string | null
    idempotencyKey: string | null
    correlationId: string
    requestId: string
    decision: ModerationOutcome
    policyVersion: string
    reasonCode: string
    severity: string
    scope: string
    effectiveAt: string
    expiresAt: string | null
  },
): Promise<{
  caseId: string
  decisionId: string
  outcome: ModerationOutcome
  version: number
  effectiveAt: string
  requestId: string
}> {
  requireResource('reviewer_id', input.reviewerId)
  requireLayer(input.reviewerLayer)
  requireResource('case_id', input.caseId)
  requireRequestId(input.requestId)

  if (!input.ifMatch || !input.idempotencyKey) {
    throw new ModerationRuntimeError('PRECONDITION_REQUIRED', 428)
  }
  if (input.decision !== 'APPROVED' && input.decision !== 'REJECTED') {
    throw new ModerationRuntimeError('VALIDATION_FAILED', 400)
  }
  requireResource('policy_version', input.policyVersion)
  requireResource('reason_code', input.reasonCode)
  if (!input.severity || input.severity.length > 64 || !input.scope || input.scope.length > 128) {
    throw new ModerationRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!Number.isFinite(Date.parse(input.effectiveAt))) {
    throw new ModerationRuntimeError('VALIDATION_FAILED', 400)
  }
  if (input.expiresAt !== null && !Number.isFinite(Date.parse(input.expiresAt))) {
    throw new ModerationRuntimeError('VALIDATION_FAILED', 400)
  }

  const row = await readCase(db, input.caseId, input.reviewerId)
  if (!row) throw new ModerationRuntimeError('NOT_FOUND', 404)

  const expectedVersion = Number(normalizeEtag(input.ifMatch))
  if (expectedVersion !== row.version) throw new ModerationRuntimeError('PRECONDITION_FAILED', 412)
  const bodyExpectedVersion = row.version

  if (row.target_type !== 'content') {
    throw new ModerationRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!row.target_version || row.target_version < 1) {
    throw new ModerationRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!['OPEN', 'UNDER_REVIEW'].includes(row.state)) {
    throw new ModerationRuntimeError('INVALID_STATE', 409)
  }

  const hash = await requestHash('decideModerationCase', {
    caseId: input.caseId,
    expectedVersion: bodyExpectedVersion,
    decision: input.decision,
    policyVersion: input.policyVersion,
    reasonCode: input.reasonCode,
    severity: input.severity,
    scope: input.scope,
    effectiveAt: input.effectiveAt,
    expiresAt: input.expiresAt,
  })
  const decisionId = decisionIdFor(hash)
  const existing = await db
    .prepare(
      `SELECT request_hash,decision_id,response_status,response_json,expires_at
         FROM moderation_decision_idempotency
        WHERE reviewer_id = ? AND case_id = ? AND idempotency_key = ?
        LIMIT 1`,
    )
    .bind(input.reviewerId, input.caseId, input.idempotencyKey)
    .first<IdempotencyRow>()

  if (existing && Date.parse(existing.expires_at) > Date.now()) {
    if (existing.request_hash !== hash) {
      throw new ModerationRuntimeError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 422)
    }
    return JSON.parse(existing.response_json) as {
      caseId: string
      decisionId: string
      outcome: ModerationOutcome
      version: number
      effectiveAt: string
      requestId: string
    }
  }

  const moderationHeaders = new Headers({
    'X-LuckRead-Caller': 'W06',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Correlation-Id': input.correlationId,
    'X-LuckRead-Request-Id': input.requestId,
    'X-LuckRead-Principal-User-Id': input.reviewerId,
    'X-LuckRead-Principal-Layer': input.reviewerLayer,
    'X-LuckRead-Moderation-Decision-Id': decisionId,
    'X-LuckRead-Moderation-Policy-Version': input.policyVersion,
    'X-LuckRead-Moderation-Outcome': input.decision,
    'If-Match': `W/"${row.target_version}"`,
    'Idempotency-Key': input.idempotencyKey,
    'content-type': 'application/json; charset=utf-8',
  })
  const transitionResponse = await w03.fetch(
    new Request(`https://luckread-w03.internal/internal/content/contents/${encodeURIComponent(row.target_id)}/state`, {
      method: 'POST',
      headers: moderationHeaders,
      body: JSON.stringify({
        to: input.decision,
        decisionId,
        policyVersion: input.policyVersion,
        targetContentState: 'PENDING_REVIEW',
      }),
    }),
  )

  if (!transitionResponse.ok) {
    const text = await transitionResponse.text()
    let body: Record<string, unknown> | null = null
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      body = null
    }
    const code = typeof body?.error?.code === 'string' ? body.error.code : 'CONTENT_TRANSITION_FAILED'
    const status = [400, 401, 403, 404, 409, 412, 428, 422].includes(transitionResponse.status)
      ? transitionResponse.status
      : 503
    throw new ModerationRuntimeError(code, status)
  }

  const transition = await transitionResponse.json() as {
    from?: string
    to?: string
    version?: number
    etag?: string
  }
  if (
    transition.from !== 'PENDING_REVIEW' ||
    transition.to !== input.decision ||
    !Number.isInteger(transition.version) ||
    typeof transition.etag !== 'string'
  ) {
    throw new ModerationRuntimeError('SERVICE_UNAVAILABLE', 503)
  }

  const now = new Date().toISOString()
  const nextCaseVersion = row.version + 1
  const response = {
    caseId: row.case_id,
    decisionId,
    outcome: input.decision,
    version: nextCaseVersion,
    effectiveAt: input.effectiveAt,
    requestId: input.requestId,
  }
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString()
  const actor: AuditActor = {
    actorId: input.reviewerId,
    actorType: 'user',
    layer: input.reviewerLayer as AuditActor['layer'],
  }
  const audit: AuditEvent = {
    eventId: `audit_${crypto.randomUUID()}`,
    requestId: input.requestId,
    traceId: input.correlationId,
    actor,
    action: 'moderation.decide',
    targetType: 'ModerationCase',
    targetId: row.case_id,
    before: {
      caseId: row.case_id,
      version: row.version,
      state: row.state,
      currentDecisionId: row.current_decision_id,
    },
    after: {
      caseId: row.case_id,
      version: nextCaseVersion,
      state: 'ACTION_TAKEN',
      currentDecisionId: decisionId,
      decisionId,
      outcome: input.decision,
      policyVersion: input.policyVersion,
      reasonCode: input.reasonCode,
      severity: input.severity,
      scope: input.scope,
      effectiveAt: input.effectiveAt,
      expiresAt: input.expiresAt,
    },
    reason: input.reasonCode,
    occurredAt: now,
  }

  const statements = [
    db.prepare(
      `INSERT INTO moderation_decisions (
        decision_id,case_id,case_version,outcome,target_type,target_id,target_version,
        policy_version,reason_code,severity,scope,effective_at,expires_at,source_kind,
        reviewer_id,reviewer_layer,request_id,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      decisionId,
      row.case_id,
      row.version,
      input.decision,
      row.target_type,
      row.target_id,
      row.target_version,
      input.policyVersion,
      input.reasonCode,
      input.severity,
      input.scope,
      input.effectiveAt,
      input.expiresAt,
      'HUMAN_REVIEW',
      input.reviewerId,
      input.reviewerLayer,
      input.requestId,
      now,
    ),
    db.prepare(
      `UPDATE moderation_cases
          SET state = 'ACTION_TAKEN', current_decision_id = ?, version = ?, updated_at = ?
        WHERE case_id = ? AND version = ?`,
    ).bind(decisionId, nextCaseVersion, now, row.case_id, row.version),
    db.prepare(
      `INSERT INTO moderation_decision_idempotency (
        id,reviewer_id,case_id,idempotency_key,request_hash,decision_id,response_status,response_json,created_at,expires_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      input.reviewerId,
      row.case_id,
      input.idempotencyKey,
      hash,
      decisionId,
      200,
      JSON.stringify(response),
      now,
      expiresAt,
    ),
    db.prepare(
      `INSERT INTO audit_events (
        event_id,request_id,trace_id,actor_json,action,target_type,target_id,
        before_json,after_json,reason,ip,user_agent,occurred_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      audit.eventId,
      audit.requestId ?? null,
      audit.traceId ?? null,
      JSON.stringify(audit.actor),
      audit.action,
      audit.targetType,
      audit.targetId,
      JSON.stringify(audit.before),
      JSON.stringify(audit.after),
      audit.reason ?? null,
      audit.ip ?? null,
      audit.userAgent ?? null,
      audit.occurredAt,
    ),
  ]

  try {
    const results = await db.batch(statements)
    if (!results.every((result) => result.success)) {
      throw new ModerationRuntimeError('SERVICE_UNAVAILABLE', 503)
    }
  } catch (error) {
    if (error instanceof ModerationRuntimeError) throw error
    if (/UNIQUE constraint|constraint failed/i.test(error instanceof Error ? error.message : String(error))) {
      const replay = await db
        .prepare(
          `SELECT request_hash,response_json
             FROM moderation_decision_idempotency
            WHERE reviewer_id = ? AND case_id = ? AND idempotency_key = ?
            LIMIT 1`,
        )
        .bind(input.reviewerId, row.case_id, input.idempotencyKey)
        .first<{ request_hash: string; response_json: string }>()
      if (replay?.request_hash === hash) return JSON.parse(replay.response_json)
      throw new ModerationRuntimeError('PRECONDITION_FAILED', 412)
    }
    throw new ModerationRuntimeError('SERVICE_UNAVAILABLE', 503)
  }

  return response
}
