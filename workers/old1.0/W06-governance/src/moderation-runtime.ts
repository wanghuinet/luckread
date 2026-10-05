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

const requireText = (name: string, value: string, maxLength: number): void => {
  if (!value.trim() || value.length > maxLength) {
    throw new ModerationRuntimeError(`INVALID_${name.toUpperCase()}`, 400)
  }
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
    const priority = parsed.priority as number
    return { priority, createdAt: parsed.createdAt, caseId: parsed.caseId }
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
    tail = ' AND (c.priority < ? OR (c.priority = ? AND (c.created_at > ? OR (c.created_at = ? AND c.case_id > ?))))'
    params.push(decoded.priority, decoded.priority, decoded.createdAt, decoded.createdAt, decoded.caseId)
  }

  const rows = await db.prepare(
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
        ${tail}
      ORDER BY c.priority DESC, c.created_at ASC, c.case_id ASC
      LIMIT ?`,
  ).bind(...params, pageSize + 1).all<ModerationCaseRow & {
    decision_id: string | null
    case_version: number | null
    outcome: ModerationOutcome | null
    decision_policy_version: string | null
    decision_effective_at: string | null
    decision_request_id: string | null
    decision_created_at: string | null
  }>()

  const hasMore = rows.results.length > pageSize
  const page = rows.results.slice(0, pageSize)
  const last = page.at(-1)
  return {
    items: page.map((row) => responseForCase(row, row.decision_id ? ({
      decision_id: row.decision_id,
      case_id: row.case_id,
      case_version: row.case_version ?? row.version,
      outcome: row.outcome as ModerationOutcome,
      target_type: row.target_type,
      target_id: row.target_id,
      target_version: row.target_version,
      policy_version: row.decision_policy_version ?? row.policy_version,
      reason_code: '',
      severity: '',
      scope: '',
      effective_at: row.decision_effective_at ?? row.updated_at,
      expires_at: null,
      source_kind: 'HUMAN_REVIEW',
      reviewer_id: null,
      reviewer_layer: null,
      request_id: row.decision_request_id ?? 'req_' + row.case_id.replaceAll('-', '').slice(0, 123),
      created_at: row.decision_created_at ?? row.updated_at,
    } satisfies ModerationDecisionRow) : null)),
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
  const row = await db.prepare(
    `SELECT c.case_id,c.target_type,c.target_id,c.target_version,c.policy_version,c.state,c.priority,
            c.assigned_reviewer_id,c.current_decision_id,c.evidence_bundle_ref,c.version,c.created_at,c.updated_at,
            d.decision_id,d.case_version,d.outcome,d.policy_version AS decision_policy_version,
            d.effective_at AS decision_effective_at,d.reason_code,d.severity,d.scope,d.expires_at,
            d.source_kind,d.reviewer_id,d.reviewer_layer,d.request_id,d.created_at AS decision_created_at,
            d.target_type AS decision_target_type,d.target_id AS decision_target_id,
            d.target_version AS decision_target_version
       FROM moderation_cases c
       LEFT JOIN moderation_decisions d ON d.decision_id = c.current_decision_id
      WHERE c.case_id = ?
        AND c.target_type = 'content'
        AND (c.assigned_reviewer_id IS NULL OR c.assigned_reviewer_id = ?)
      LIMIT 1`,
  ).bind(caseId, reviewerId).first<ModerationCaseRow & Partial<ModerationDecisionRow & {
    decision_policy_version: string
    decision_effective_at: string
    decision_created_at: string
    decision_target_type: string
    decision_target_id: string
    decision_target_version: number | null
  }>>()
  if (!row) throw new ModerationRuntimeError('NOT_FOUND', 404)
  const decision = row.decision_id ? ({
    decision_id: row.decision_id,
    case_id: row.case_id,
    case_version: row.case_version ?? row.version,
    outcome: row.outcome as ModerationOutcome,
    target_type: row.decision_target_type ?? row.target_type,
    target_id: row.decision_target_id ?? row.target_id,
    target_version: row.decision_target_version ?? row.target_version,
    policy_version: row.decision_policy_version ?? row.policy_version,
    reason_code: row.reason_code ?? '',
    severity: row.severity ?? '',
    scope: row.scope ?? '',
    effective_at: row.decision_effective_at ?? row.updated_at,
    expires_at: row.expires_at ?? null,
    source_kind: row.source_kind ?? 'HUMAN_REVIEW',
    reviewer_id: row.reviewer_id ?? null,
    reviewer_layer: row.reviewer_layer ?? null,
    request_id: row.request_id ?? '',
    created_at: row.decision_created_at ?? row.updated_at,
  } satisfies ModerationDecisionRow) : null
  return responseForCase(row, decision)
}

export async function deliverModerationOutbox(
  db: D1Database,
  w03: Fetcher,
  outbox: {
    outboxId: string
    decisionId: string
    caseId: string
    targetId: string
    targetVersion: number
    outcome: ModerationOutcome
    policyVersion: string
    idempotencyKey: string
    attempts?: number
    correlationId: string
    requestId: string
    reviewerId: string
    reviewerLayer: string
  },
): Promise<'DELIVERED' | 'RETRY'> {
  const headers = new Headers({
    'X-LuckRead-Caller': 'W06',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Correlation-Id': outbox.correlationId,
    'X-LuckRead-Request-Id': outbox.requestId,
    'X-LuckRead-Principal-User-Id': outbox.reviewerId,
    'X-LuckRead-Principal-Layer': outbox.reviewerLayer,
    'X-LuckRead-Moderation-Decision-Id': outbox.decisionId,
    'X-LuckRead-Moderation-Policy-Version': outbox.policyVersion,
    'X-LuckRead-Moderation-Outcome': outbox.outcome,
    'If-Match': `W/"${outbox.targetVersion}"`,
    'Idempotency-Key': outbox.idempotencyKey,
    'content-type': 'application/json; charset=utf-8',
  })
  const response = await w03.fetch(
    new Request(
      `https://luckread-w03.internal/internal/content/contents/${encodeURIComponent(outbox.targetId)}/state`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          to: outbox.outcome,
          decisionId: outbox.decisionId,
          policyVersion: outbox.policyVersion,
          targetContentState: 'PENDING_REVIEW',
        }),
      },
    ),
  )

  const now = new Date().toISOString()
  if (
    response.ok &&
    response.headers.get('content-type')?.includes('application/json')
  ) {
    const result = await response.json() as { from?: string; to?: string; version?: number; etag?: string }
    if (
      result.from === 'PENDING_REVIEW' &&
      result.to === outbox.outcome &&
      Number.isInteger(result.version) &&
      typeof result.etag === 'string'
    ) {
      await db
        .prepare(
          `UPDATE moderation_enforcement_outbox
              SET status='DELIVERED', attempts=attempts+1, delivered_at=?, last_error=NULL
            WHERE outbox_id=? AND status IN ('PENDING','RETRY')`,
        )
        .bind(now, outbox.outboxId)
        .run()
      return 'DELIVERED'
    }
  }

  const errorCode = `W03_${response.status}`
  const attempts = (outbox.attempts ?? 0) + 1
  const backoffSeconds = Math.min(3600, Math.max(5, 2 ** Math.min(attempts, 10)))
  const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000).toISOString()
  await db
    .prepare(
      `UPDATE moderation_enforcement_outbox
          SET status='RETRY', attempts=?, next_attempt_at=?, last_error=?
        WHERE outbox_id=? AND status IN ('PENDING','RETRY')`,
    )
    .bind(attempts, nextAttemptAt, errorCode, outbox.outboxId)
    .run()
  return 'RETRY'
}

export async function drainModerationOutbox(
  db: D1Database,
  w03: Fetcher,
  limit = 10,
): Promise<{ attempted: number; delivered: number; retry: number }> {
  const boundedLimit = Math.min(Math.max(limit, 1), 20)
  const rows = await db
    .prepare(
      `SELECT o.outbox_id,o.decision_id,o.case_id,o.target_type,o.target_id,o.target_version,o.outcome,
              o.policy_version,o.idempotency_key,o.status,o.attempts,o.next_attempt_at,
              d.reviewer_id,d.reviewer_layer,d.request_id
         FROM moderation_enforcement_outbox o
         JOIN moderation_decisions d ON d.decision_id=o.decision_id
        WHERE o.status IN ('PENDING','RETRY') AND o.next_attempt_at <= ?
        ORDER BY o.next_attempt_at ASC, o.created_at ASC
        LIMIT ?`,
    )
    .bind(new Date().toISOString(), boundedLimit)
    .all<{
      outbox_id: string
      decision_id: string
      case_id: string
      target_type: string
      target_id: string
      target_version: number
      outcome: ModerationOutcome
      policy_version: string
      idempotency_key: string
      status: 'PENDING' | 'RETRY'
      attempts: number
      next_attempt_at: string
      reviewer_id: string | null
      reviewer_layer: string | null
      request_id: string
    }>()

  let delivered = 0
  let retry = 0
  for (const row of rows.results) {
    if (!row.reviewer_id || !row.reviewer_layer) {
      await db
        .prepare(
          `UPDATE moderation_enforcement_outbox
              SET status='RETRY', attempts=attempts+1,
                  next_attempt_at=?, last_error='MISSING_DECISION_ACTOR'
            WHERE outbox_id=?`,
        )
        .bind(new Date(Date.now() + 60000).toISOString(), row.outbox_id)
        .run()
      retry++
      continue
    }

    const delivery = await deliverModerationOutbox(db, w03, {
      outboxId: row.outbox_id,
      decisionId: row.decision_id,
      caseId: row.case_id,
      targetId: row.target_id,
      targetVersion: row.target_version,
      outcome: row.outcome,
      policyVersion: row.policy_version,
      idempotencyKey: row.idempotency_key,
      attempts: row.attempts,
      correlationId: `moderation-${row.decision_id}`,
      requestId: row.request_id,
      reviewerId: row.reviewer_id,
      reviewerLayer: row.reviewer_layer,
    })
    if (delivery === 'DELIVERED') delivered++
    else retry++
  }

  return { attempted: rows.results.length, delivered, retry }
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
    expectedVersion: number
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

  if (!input.ifMatch || !input.idempotencyKey) throw new ModerationRuntimeError('PRECONDITION_REQUIRED', 428)
  if (input.decision !== 'APPROVED' && input.decision !== 'REJECTED') throw new ModerationRuntimeError('VALIDATION_FAILED', 400)
  requireText('policyVersion', input.policyVersion, 128)
  requireText('reasonCode', input.reasonCode, 128)
  if (!input.severity || input.severity.length > 64 || !input.scope || input.scope.length > 128) {
    throw new ModerationRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!Number.isFinite(Date.parse(input.effectiveAt))) throw new ModerationRuntimeError('VALIDATION_FAILED', 400)
  if (input.expiresAt !== null && !Number.isFinite(Date.parse(input.expiresAt))) {
    throw new ModerationRuntimeError('VALIDATION_FAILED', 400)
  }

  const row = await db
    .prepare(
      `SELECT c.case_id,c.target_type,c.target_id,c.target_version,c.policy_version,c.state,c.priority,
              c.assigned_reviewer_id,c.current_decision_id,c.evidence_bundle_ref,c.version,c.created_at,c.updated_at,
              i.request_hash AS idem_request_hash,i.response_json AS idem_response_json,i.expires_at AS idem_expires_at
         FROM moderation_cases c
         LEFT JOIN moderation_decision_idempotency i
           ON i.reviewer_id = ? AND i.case_id = c.case_id AND i.idempotency_key = ?
        WHERE c.case_id = ?
          AND (c.assigned_reviewer_id IS NULL OR c.assigned_reviewer_id = ?)
        LIMIT 1`,
    )
    .bind(input.reviewerId, input.idempotencyKey, input.caseId, input.reviewerId)
    .first<ModerationCaseRow & {
      idem_request_hash: string | null
      idem_response_json: string | null
      idem_expires_at: string | null
    }>()
  if (!row) throw new ModerationRuntimeError('NOT_FOUND', 404)

  const headerExpectedVersion = Number(normalizeEtag(input.ifMatch))
  const hash = await requestHash('decideModerationCase', {
    caseId: input.caseId,
    expectedVersion: input.expectedVersion,
    decision: input.decision,
    policyVersion: input.policyVersion,
    reasonCode: input.reasonCode,
    severity: input.severity,
    scope: input.scope,
    effectiveAt: input.effectiveAt,
    expiresAt: input.expiresAt,
  })
  const decisionId = decisionIdFor(hash)

  const existing = row.idem_request_hash
    ? {
        request_hash: row.idem_request_hash,
        response_json: row.idem_response_json ?? '',
        expires_at: row.idem_expires_at ?? '',
      }
    : null
  if (existing && Date.parse(existing.expires_at) > Date.now()) {
    if (existing.request_hash !== hash) throw new ModerationRuntimeError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 422)
    return JSON.parse(existing.response_json) as {
      caseId: string; decisionId: string; outcome: ModerationOutcome; version: number; effectiveAt: string; requestId: string
    }
  }

  if (input.expectedVersion !== row.version || headerExpectedVersion !== row.version) {
    throw new ModerationRuntimeError('PRECONDITION_FAILED', 412)
  }
  if (row.target_type !== 'content') throw new ModerationRuntimeError('VALIDATION_FAILED', 400)
  if (input.policyVersion !== row.policy_version) throw new ModerationRuntimeError('VALIDATION_FAILED', 400)
  if (!row.target_version || row.target_version < 1) throw new ModerationRuntimeError('VALIDATION_FAILED', 400)
  if (!['OPEN', 'UNDER_REVIEW'].includes(row.state)) throw new ModerationRuntimeError('INVALID_STATE', 409)

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
    before: { caseId: row.case_id, version: row.version, state: row.state, currentDecisionId: row.current_decision_id },
    after: {
      caseId: row.case_id, version: nextCaseVersion, state: 'ACTION_TAKEN',
      currentDecisionId: decisionId, decisionId, outcome: input.decision,
      policyVersion: input.policyVersion, reasonCode: input.reasonCode, severity: input.severity,
      scope: input.scope, effectiveAt: input.effectiveAt, expiresAt: input.expiresAt,
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
      decisionId,row.case_id,row.version,input.decision,row.target_type,row.target_id,row.target_version,
      input.policyVersion,input.reasonCode,input.severity,input.scope,input.effectiveAt,input.expiresAt,
      'HUMAN_REVIEW',input.reviewerId,input.reviewerLayer,input.requestId,now,
    ),
    db.prepare(
      `UPDATE moderation_cases
          SET state='ACTION_TAKEN',current_decision_id=?,version=?,updated_at=?
        WHERE case_id=? AND version=?`,
    ).bind(decisionId,nextCaseVersion,now,row.case_id,row.version),
    db.prepare(
      `INSERT OR REPLACE INTO moderation_txn_guard(id,successful)
       VALUES (1, changes())`,
    ),
    db.prepare(
      `DELETE FROM moderation_decision_idempotency
        WHERE reviewer_id=? AND case_id=? AND idempotency_key=? AND expires_at<=?`,
    ).bind(input.reviewerId,row.case_id,input.idempotencyKey,now),
    db.prepare(
      `INSERT INTO moderation_decision_idempotency (
        id,reviewer_id,case_id,idempotency_key,request_hash,decision_id,response_status,response_json,created_at,expires_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(crypto.randomUUID(),input.reviewerId,row.case_id,input.idempotencyKey,hash,decisionId,200,JSON.stringify(response),now,expiresAt),
    db.prepare(
      `INSERT INTO moderation_enforcement_outbox (
        outbox_id,decision_id,case_id,target_type,target_id,target_version,outcome,
        policy_version,idempotency_key,status,attempts,next_attempt_at,last_error,created_at,delivered_at
      ) VALUES (?,?,?,?,?,?,?,?,?,'PENDING',0,?,NULL,?,NULL)`,
    ).bind(
      crypto.randomUUID(),decisionId,row.case_id,row.target_type,row.target_id,row.target_version,
      input.decision,input.policyVersion,input.idempotencyKey,now,now,
    ),
    db.prepare(
      `INSERT INTO audit_events (
        event_id,request_id,trace_id,actor_json,action,target_type,target_id,
        before_json,after_json,reason,ip,user_agent,occurred_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      audit.eventId,audit.requestId ?? null,audit.traceId ?? null,JSON.stringify(audit.actor),audit.action,
      audit.targetType,audit.targetId,JSON.stringify(audit.before),JSON.stringify(audit.after),audit.reason ?? null,
      audit.ip ?? null,audit.userAgent ?? null,audit.occurredAt,
    ),
  ]

  try {
    const results = await db.batch(statements)
    if (!results.every((result) => result.success)) throw new ModerationRuntimeError('SERVICE_UNAVAILABLE',503)
  } catch (error) {
    if (error instanceof ModerationRuntimeError) throw error
    if (/UNIQUE constraint|constraint failed/i.test(error instanceof Error ? error.message : String(error))) {
      const replay = await db.prepare(
        `SELECT request_hash,response_json
           FROM moderation_decision_idempotency
          WHERE reviewer_id=? AND case_id=? AND idempotency_key=?
          LIMIT 1`,
      ).bind(input.reviewerId,row.case_id,input.idempotencyKey).first<{request_hash:string;response_json:string}>()
      if (replay?.request_hash === hash) return JSON.parse(replay.response_json) as typeof response
      throw new ModerationRuntimeError('PRECONDITION_FAILED',412)
    }
    throw new ModerationRuntimeError('SERVICE_UNAVAILABLE',503)
  }

  try {
    await deliverModerationOutbox(db,w03,{
      outboxId: JSON.parse(JSON.stringify(response)).decisionId ? decisionId : decisionId,
      decisionId,
      caseId: row.case_id,
      targetId: row.target_id,
      targetVersion: row.target_version,
      outcome: input.decision,
      policyVersion: input.policyVersion,
      idempotencyKey: input.idempotencyKey,
      attempts: 0,
      correlationId: input.correlationId,
      requestId: input.requestId,
      reviewerId: input.reviewerId,
      reviewerLayer: input.reviewerLayer,
    })
  } catch {
    // The durable outbox remains pending; scheduled drain will retry.
  }

  return response
}
