import { assertW09AuditEventStatement } from '../../W09-platform/src/audit-event-postgres-adapter.js'
import type { W06ModerationPostgresPool } from './moderation-postgres-pool.js'

export type ModerationDecisionOutcome = 'APPROVED' | 'REJECTED'

export type ModerationDecisionWriteResponse = {
  caseId: string
  decisionId: string
  outcome: ModerationDecisionOutcome
  version: number
  effectiveAt: string
  requestId: string
}

export type ModerationDecisionWriteCommand = {
  reviewerId: string
  reviewerLayer: string
  caseId: string
  ifMatch: string
  idempotencyKey: string
  expectedVersion: number
  requestHash: string
  decisionId: string
  outboxId: string
  requestId: string
  correlationId: string
  outcome: ModerationDecisionOutcome
  policyVersion: string
  reasonCode: string
  severity: string
  scope: string
  effectiveAt: string
  expiresAt: string | null
  now: string
  idempotencyExpiresAt: string
}

export type ModerationDecisionOutboxCommand = {
  outboxId: string
  decisionId: string
  caseId: string
  targetId: string
  targetVersion: number
  outcome: ModerationDecisionOutcome
  policyVersion: string
  idempotencyKey: string
  attempts: number
  correlationId: string
  requestId: string
  reviewerId: string
  reviewerLayer: string
}

export type ModerationReadyOutboxRow = {
  outbox_id: string
  decision_id: string
  case_id: string
  target_type: string
  target_id: string
  target_version: number
  outcome: ModerationDecisionOutcome
  policy_version: string
  idempotency_key: string
  status: 'PENDING' | 'RETRY'
  attempts: number
  reviewer_id: string | null
  reviewer_layer: string | null
  request_id: string
}

export type ModerationDecisionWriteResult = {
  response: ModerationDecisionWriteResponse
  replayed: boolean
  outbox: ModerationDecisionOutboxCommand | null
}

export class ModerationDecisionWriteStoreError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
  }
}

export interface ModerationDecisionWriteStore {
  commit(command: ModerationDecisionWriteCommand): Promise<ModerationDecisionWriteResult>
  listReadyOutbox(now: string, limit: number): Promise<ModerationReadyOutboxRow[]>
  markOutboxDelivered(outboxId: string, deliveredAt: string): Promise<void>
  markOutboxMissingActor(outboxId: string, nextAttemptAt: string): Promise<void>
  markOutboxRetry(
    outboxId: string,
    attempts: number,
    nextAttemptAt: string,
    errorCode: string,
  ): Promise<void>
}

type QueryResult<Row extends Record<string, unknown>> = {
  rows: Row[]
  rowCount: number | null
}

type ModerationCaseRow = {
  case_id: string
  target_type: string
  target_id: string
  target_version: number | null
  policy_version: string
  state: string
  assigned_reviewer_id: string | null
  current_decision_id: string | null
  version: number
}

type IdempotencyRow = {
  request_hash: string
  response_json: string
  expires_at: string | Date
}

const FIND_CASE_FOR_UPDATE_SQL = [
  'SELECT case_id, target_type, target_id, target_version, policy_version,',
  '       state, assigned_reviewer_id, current_decision_id, version',
  '  FROM moderation_cases',
  ' WHERE case_id = $1',
  '   AND (assigned_reviewer_id IS NULL OR assigned_reviewer_id = $2)',
  ' LIMIT 1 FOR UPDATE',
].join(' ')

const FIND_IDEMPOTENCY_SQL = [
  'SELECT request_hash, response_json, expires_at',
  '  FROM moderation_decision_idempotency',
  ' WHERE reviewer_id = $1 AND case_id = $2 AND idempotency_key = $3',
  ' LIMIT 1',
].join(' ')

const INSERT_AUDIT_EVENT_SQL = [
  'INSERT INTO audit_events (',
  '  event_id, request_id, trace_id, actor_json, action, target_type, target_id,',
  '  before_json, after_json, reason, ip, user_agent, occurred_at',
  ') VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13)',
].join(' ')

function affectedRows<Row extends Record<string, unknown>>(result: QueryResult<Row>): number {
  return result.rowCount ?? result.rows.length
}

function normalizeEtag(value: string): number {
  const match = /^(?:W\/)?"?v?(\d+)"?$/.exec(value.trim())
  if (!match) throw new ModerationDecisionWriteStoreError('PRECONDITION_FAILED', 412)
  return Number(match[1])
}

function timestampMilliseconds(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') return Date.parse(value)
  return Number.NaN
}

function decodeResponse(value: unknown): ModerationDecisionWriteResponse {
  if (typeof value !== 'string') {
    throw new ModerationDecisionWriteStoreError('SERVICE_UNAVAILABLE', 503)
  }
  try {
    const result = JSON.parse(value) as Partial<ModerationDecisionWriteResponse>
    if (
      typeof result.caseId !== 'string' ||
      typeof result.decisionId !== 'string' ||
      (result.outcome !== 'APPROVED' && result.outcome !== 'REJECTED') ||
      !Number.isInteger(result.version) ||
      typeof result.effectiveAt !== 'string' ||
      typeof result.requestId !== 'string'
    ) throw new Error('INVALID_STORED_MODERATION_RESPONSE')
    return result as ModerationDecisionWriteResponse
  } catch {
    throw new ModerationDecisionWriteStoreError('SERVICE_UNAVAILABLE', 503)
  }
}

function resolveReplay(row: IdempotencyRow, requestHash: string): ModerationDecisionWriteResponse {
  if (row.request_hash !== requestHash) {
    throw new ModerationDecisionWriteStoreError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 422)
  }
  return decodeResponse(row.response_json)
}

export function createPostgresModerationDecisionWriteStore(
  pool: W06ModerationPostgresPool,
): ModerationDecisionWriteStore {
  if (!assertW09AuditEventStatement(INSERT_AUDIT_EVENT_SQL)) {
    throw new Error('W09_AUDIT_EVENT_APPEND_ONLY_STATEMENT_REQUIRED')
  }

  return {
    async commit(command): Promise<ModerationDecisionWriteResult> {
      const client = await pool.connect()
      let transactionOpen = false
      try {
        await client.query('BEGIN')
        transactionOpen = true

        // Lock the case before checking idempotency. Concurrent same-case
        // requests therefore observe the first committed result before If-Match.
        const caseResult = await client.query<ModerationCaseRow>(
          FIND_CASE_FOR_UPDATE_SQL,
          [command.caseId, command.reviewerId],
        )
        const currentCase = caseResult.rows[0]
        if (!currentCase) throw new ModerationDecisionWriteStoreError('NOT_FOUND', 404)

        const idempotencyResult = await client.query<IdempotencyRow>(
          FIND_IDEMPOTENCY_SQL,
          [command.reviewerId, currentCase.case_id, command.idempotencyKey],
        )
        const existing = idempotencyResult.rows[0]
        if (existing && timestampMilliseconds(existing.expires_at) > Date.now()) {
          const response = resolveReplay(existing, command.requestHash)
          await client.query('COMMIT')
          transactionOpen = false
          return { response, replayed: true, outbox: null }
        }

        if (existing) {
          await client.query(
            'DELETE FROM moderation_decision_idempotency WHERE reviewer_id = $1 AND case_id = $2 AND idempotency_key = $3 AND expires_at <= $4',
            [command.reviewerId, currentCase.case_id, command.idempotencyKey, command.now],
          )
        }

        const currentVersion = Number(currentCase.version)
        const headerExpectedVersion = normalizeEtag(command.ifMatch)
        if (command.expectedVersion !== currentVersion || headerExpectedVersion !== currentVersion) {
          throw new ModerationDecisionWriteStoreError('PRECONDITION_FAILED', 412)
        }
        if (currentCase.target_type !== 'content') {
          throw new ModerationDecisionWriteStoreError('VALIDATION_FAILED', 400)
        }
        if (command.policyVersion !== currentCase.policy_version) {
          throw new ModerationDecisionWriteStoreError('VALIDATION_FAILED', 400)
        }
        const targetVersion = currentCase.target_version === null ? null : Number(currentCase.target_version)
        if (!targetVersion || targetVersion < 1) {
          throw new ModerationDecisionWriteStoreError('VALIDATION_FAILED', 400)
        }
        if (!['OPEN', 'UNDER_REVIEW'].includes(currentCase.state)) {
          throw new ModerationDecisionWriteStoreError('INVALID_STATE', 409)
        }

        const nextCaseVersion = currentVersion + 1
        const response: ModerationDecisionWriteResponse = {
          caseId: currentCase.case_id,
          decisionId: command.decisionId,
          outcome: command.outcome,
          version: nextCaseVersion,
          effectiveAt: command.effectiveAt,
          requestId: command.requestId,
        }

        await client.query(
          'INSERT INTO moderation_decisions (decision_id, case_id, case_version, outcome, target_type, target_id, target_version, policy_version, reason_code, severity, scope, effective_at, expires_at, source_kind, reviewer_id, reviewer_layer, request_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, \'HUMAN_REVIEW\', $14, $15, $16, $17)',
          [
            command.decisionId, currentCase.case_id, currentVersion, command.outcome,
            currentCase.target_type, currentCase.target_id, targetVersion, command.policyVersion,
            command.reasonCode, command.severity, command.scope, command.effectiveAt,
            command.expiresAt, command.reviewerId, command.reviewerLayer, command.requestId, command.now,
          ],
        )

        const updatedCase = await client.query(
          'UPDATE moderation_cases SET state = \'ACTION_TAKEN\', current_decision_id = $1, version = $2, updated_at = $3 WHERE case_id = $4 AND version = $5 RETURNING case_id',
          [command.decisionId, nextCaseVersion, command.now, currentCase.case_id, currentVersion],
        )
        if (affectedRows(updatedCase) !== 1) {
          throw new ModerationDecisionWriteStoreError('SERVICE_UNAVAILABLE', 503)
        }

        await client.query(
          'INSERT INTO moderation_decision_idempotency (id, reviewer_id, case_id, idempotency_key, request_hash, decision_id, response_status, response_json, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, 200, $7, $8, $9)',
          [
            command.outboxId + '-idem', command.reviewerId, currentCase.case_id,
            command.idempotencyKey, command.requestHash, command.decisionId,
            JSON.stringify(response), command.now, command.idempotencyExpiresAt,
          ],
        )

        await client.query(
          'INSERT INTO moderation_enforcement_outbox (outbox_id, decision_id, case_id, target_type, target_id, target_version, outcome, policy_version, idempotency_key, status, attempts, next_attempt_at, last_error, created_at, delivered_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, \'PENDING\', 0, $10, NULL, $10, NULL)',
          [
            command.outboxId, command.decisionId, currentCase.case_id, currentCase.target_type,
            currentCase.target_id, targetVersion, command.outcome, command.policyVersion,
            command.idempotencyKey, command.now,
          ],
        )

        const auditEventId = 'audit_' + command.outboxId
        const before = {
          caseId: currentCase.case_id,
          version: currentVersion,
          state: currentCase.state,
          currentDecisionId: currentCase.current_decision_id,
        }
        const after = {
          caseId: currentCase.case_id,
          version: nextCaseVersion,
          state: 'ACTION_TAKEN',
          currentDecisionId: command.decisionId,
          decisionId: command.decisionId,
          outcome: command.outcome,
          policyVersion: command.policyVersion,
          reasonCode: command.reasonCode,
          severity: command.severity,
          scope: command.scope,
          effectiveAt: command.effectiveAt,
          expiresAt: command.expiresAt,
        }
        await client.query(INSERT_AUDIT_EVENT_SQL, [
          auditEventId,
          command.requestId,
          command.correlationId,
          JSON.stringify({ actorId: command.reviewerId, actorType: 'user', layer: command.reviewerLayer }),
          'moderation.decide',
          'ModerationCase',
          currentCase.case_id,
          JSON.stringify(before),
          JSON.stringify(after),
          command.reasonCode,
          null,
          null,
          command.now,
        ])

        await client.query('COMMIT')
        transactionOpen = false

        return {
          response,
          replayed: false,
          outbox: {
            outboxId: command.outboxId,
            decisionId: command.decisionId,
            caseId: currentCase.case_id,
            targetId: currentCase.target_id,
            targetVersion,
            outcome: command.outcome,
            policyVersion: command.policyVersion,
            idempotencyKey: command.idempotencyKey,
            attempts: 0,
            correlationId: command.correlationId,
            requestId: command.requestId,
            reviewerId: command.reviewerId,
            reviewerLayer: command.reviewerLayer,
          },
        }
      } catch (error) {
        if (transactionOpen) {
          try { await client.query('ROLLBACK') } catch { /* Preserve the original safe error. */ }
        }
        if (error instanceof ModerationDecisionWriteStoreError) throw error

        if ((error as { code?: unknown })?.code === '23505') {
          try {
            const raced = await client.query<IdempotencyRow>(
              FIND_IDEMPOTENCY_SQL,
              [command.reviewerId, command.caseId, command.idempotencyKey],
            )
            const row = raced.rows[0]
            if (row && timestampMilliseconds(row.expires_at) > Date.now()) {
              const response = resolveReplay(row, command.requestHash)
              return { response, replayed: true, outbox: null }
            }
          } catch (replayError) {
            if (replayError instanceof ModerationDecisionWriteStoreError) throw replayError
          }
          throw new ModerationDecisionWriteStoreError('PRECONDITION_FAILED', 412)
        }
        throw new ModerationDecisionWriteStoreError('SERVICE_UNAVAILABLE', 503)
      } finally {
        client.release()
      }
    },

    async listReadyOutbox(now, limit): Promise<ModerationReadyOutboxRow[]> {
      try {
        const result = await pool.query<ModerationReadyOutboxRow>(
          [
            'SELECT o.outbox_id, o.decision_id, o.case_id, o.target_type, o.target_id,',
            '       o.target_version, o.outcome, o.policy_version, o.idempotency_key,',
            '       o.status, o.attempts, d.reviewer_id, d.reviewer_layer, d.request_id',
            '  FROM moderation_enforcement_outbox o',
            '  JOIN moderation_decisions d ON d.decision_id = o.decision_id',
            " WHERE o.status IN ('PENDING', 'RETRY') AND o.next_attempt_at <= $1::timestamptz",
            ' ORDER BY o.next_attempt_at ASC, o.created_at ASC',
            ' LIMIT $2',
          ].join(' '),
          [now, limit],
        )
        return result.rows
      } catch {
        throw new ModerationDecisionWriteStoreError('SERVICE_UNAVAILABLE', 503)
      }
    },

    async markOutboxMissingActor(outboxId, nextAttemptAt): Promise<void> {
      try {
        await pool.query(
          "UPDATE moderation_enforcement_outbox SET status = 'RETRY', attempts = attempts + 1, next_attempt_at = $1, last_error = 'MISSING_DECISION_ACTOR' WHERE outbox_id = $2 AND status IN ('PENDING', 'RETRY')",
          [nextAttemptAt, outboxId],
        )
      } catch {
        throw new ModerationDecisionWriteStoreError('SERVICE_UNAVAILABLE', 503)
      }
    },

    async markOutboxDelivered(outboxId, deliveredAt): Promise<void> {
      try {
        await pool.query(
          'UPDATE moderation_enforcement_outbox SET status = \'DELIVERED\', attempts = attempts + 1, delivered_at = $1, last_error = NULL WHERE outbox_id = $2 AND status IN (\'PENDING\', \'RETRY\')',
          [deliveredAt, outboxId],
        )
      } catch {
        throw new ModerationDecisionWriteStoreError('SERVICE_UNAVAILABLE', 503)
      }
    },

    async markOutboxRetry(outboxId, attempts, nextAttemptAt, errorCode): Promise<void> {
      try {
        await pool.query(
          'UPDATE moderation_enforcement_outbox SET status = \'RETRY\', attempts = $1, next_attempt_at = $2, last_error = $3 WHERE outbox_id = $4 AND status IN (\'PENDING\', \'RETRY\')',
          [attempts, nextAttemptAt, errorCode, outboxId],
        )
      } catch {
        throw new ModerationDecisionWriteStoreError('SERVICE_UNAVAILABLE', 503)
      }
    },
  }
}
