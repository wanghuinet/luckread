import {
  ModerationDecisionWriteStoreError,
  type ModerationDecisionWriteStore,
} from './moderation-decision-write-store-postgres.js'
import {
  ModerationQueueReadStoreError,
  type ModerationQueueReadCursor,
  type ModerationQueueReadStore,
} from './moderation-queue-read-store.js'
import {
  ModerationCaseDetailReadStoreError,
  type ModerationCaseDetailReadStore,
  type ModerationCaseDetailReadRow,
} from './moderation-case-detail-read-store-postgres.js'

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

const opaqueCursor = (priority: number, createdAt: string, caseId: string, reviewerId: string): string => {
  const raw = JSON.stringify({ version: 1, reviewerId, priority, createdAt, caseId })
  let binary = ''
  for (const byte of new TextEncoder().encode(raw)) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

const decodeCursor = (value: string, reviewerId: string): { priority: number; createdAt: string; caseId: string } => {
  try {
    if (!value || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('INVALID')
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
      version?: unknown
      reviewerId?: unknown
      priority?: unknown
      createdAt?: unknown
      caseId?: unknown
    }
    if (
      parsed.version !== 1 ||
      parsed.reviewerId !== reviewerId ||
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
    throw new ModerationRuntimeError('INVALID_CURSOR', 400)
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

export async function listModerationQueue(
  source: ModerationQueueReadStore,
  reviewerId: string,
  cursor: string | null,
  requestedLimit: number | null,
): Promise<{ items: ReturnType<typeof responseForCase>[]; nextCursor: string | null; hasMore: boolean }> {
  requireResource('reviewer_id', reviewerId)
  const pageSize = Math.min(Math.max(Number.isInteger(requestedLimit) ? Number(requestedLimit) : 20, 1), 50)
  const decoded: ModerationQueueReadCursor = cursor ? decodeCursor(cursor, reviewerId) : null

  let rows
  try {
    rows = await source.list({
      reviewerId,
      openStates: OPEN_QUEUE_STATES,
      cursor: decoded,
      limit: pageSize + 1,
    })
  } catch (error) {
    if (error instanceof ModerationQueueReadStoreError) {
      throw new ModerationRuntimeError(error.code, error.status)
    }
    throw error
  }

  const hasMore = rows.length > pageSize
  const page = rows.slice(0, pageSize)
  const last = page.at(-1)
  return {
    items: page.map((row) => responseForCase(row as ModerationCaseRow, row.decision_id ? ({
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
    nextCursor: hasMore && last ? opaqueCursor(last.priority, last.created_at, last.case_id, reviewerId) : null,
  }
}
export async function getModerationCase(
  source: ModerationCaseDetailReadStore,
  reviewerId: string,
  caseId: string,
): Promise<ReturnType<typeof responseForCase>> {
  requireResource('reviewer_id', reviewerId)
  requireResource('case_id', caseId)

  let row: ModerationCaseDetailReadRow | null
  try {
    row = await source.get(caseId, reviewerId)
  } catch (error) {
    if (error instanceof ModerationCaseDetailReadStoreError) {
      throw new ModerationRuntimeError(error.code, error.status)
    }
    throw error
  }

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
  return responseForCase(row as ModerationCaseRow, decision)
}

export async function deliverModerationOutbox(
  db: ModerationDecisionWriteStore,
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
      await db.markOutboxDelivered(outbox.outboxId, now)
      return 'DELIVERED'
    }
  }

  const errorCode = `W03_${response.status}`
  const attempts = (outbox.attempts ?? 0) + 1
  const backoffSeconds = Math.min(3600, Math.max(5, 2 ** Math.min(attempts, 10)))
  const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000).toISOString()
  await db.markOutboxRetry(outbox.outboxId, attempts, nextAttemptAt, errorCode)
  return 'RETRY'
}

export async function drainModerationOutbox(
  db: ModerationDecisionWriteStore,
  w03: Fetcher,
  limit = 10,
): Promise<{ attempted: number; delivered: number; retry: number }> {
  const boundedLimit = Math.min(Math.max(limit, 1), 20)
  const now = new Date().toISOString()
  const rows = await db.listReadyOutbox(now, boundedLimit)

  let delivered = 0
  let retry = 0
  for (const row of rows) {
    if (!row.reviewer_id || !row.reviewer_layer) {
      const nextAttemptAt = new Date(Date.now() + 60000).toISOString()
      await db.markOutboxMissingActor(row.outbox_id, nextAttemptAt)
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

  return { attempted: rows.length, delivered, retry }
}

export async function decideModerationCase(
  db: ModerationDecisionWriteStore,
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
  const now = new Date().toISOString()
  let committed: Awaited<ReturnType<ModerationDecisionWriteStore['commit']>>
  try {
    committed = await db.commit({
      reviewerId: input.reviewerId,
      reviewerLayer: input.reviewerLayer,
      caseId: input.caseId,
      ifMatch: input.ifMatch,
      idempotencyKey: input.idempotencyKey,
      expectedVersion: input.expectedVersion,
      requestHash: hash,
      decisionId: decisionIdFor(hash),
      outboxId: crypto.randomUUID(),
      requestId: input.requestId,
      correlationId: input.correlationId,
      outcome: input.decision,
      policyVersion: input.policyVersion,
      reasonCode: input.reasonCode,
      severity: input.severity,
      scope: input.scope,
      effectiveAt: input.effectiveAt,
      expiresAt: input.expiresAt,
      now,
      idempotencyExpiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString(),
    })
  } catch (error) {
    if (error instanceof ModerationDecisionWriteStoreError) {
      throw new ModerationRuntimeError(error.code, error.status)
    }
    throw error
  }

  if (!committed.replayed && committed.outbox) {
    try {
      await deliverModerationOutbox(db, w03, committed.outbox)
    } catch {
      // The committed outbox remains durable; scheduled drain is the recovery path.
    }
  }
  return committed.response

}
