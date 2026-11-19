import { assertW09AuditEventStatement } from '../../W09-platform/src/audit-event-postgres-adapter.js'

import type {
  ModerationReportWriteCommand,
  ModerationReportWriteStore,
  ReportResult,
} from './moderation-report-write-store.js'
import { ModerationReportWriteStoreError } from './moderation-report-write-store.js'
import type { W06ModerationPostgresPool } from './neon-postgres-d1-database.js'

type QueryResult<Row extends Record<string, unknown>> = {
  rows: Row[]
  rowCount: number | null
}

const FIND_IDEMPOTENCY_SQL = `
  SELECT report_id, request_hash, response_json
  FROM moderation_report_idempotency
  WHERE actor_user_id = $1 AND idempotency_key = $2
  LIMIT 1
`

const FIND_PRIOR_REPORT_SQL = `
  SELECT report_id, target_type, target_id, reason_code, created_at
  FROM moderation_reports
  WHERE actor_user_id = $1
    AND target_type = $2
    AND target_id = $3
    AND reason_code = $4
    AND dedup_bucket = $5
  LIMIT 1
`

const INSERT_REPORT_SQL = `
  INSERT INTO moderation_reports (
    report_id, actor_user_id, target_type, target_id, reason_code,
    description, evidence_refs_json, policy_version, dedup_bucket, created_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
  ON CONFLICT DO NOTHING
`

const INSERT_AUDIT_EVENT_SQL = `
  INSERT INTO audit_events (
    event_id, request_id, trace_id, actor_json, action, target_type, target_id,
    before_json, after_json, reason, ip, user_agent, occurred_at
  ) VALUES ($1, $2, NULL, $3::jsonb, $4, $5, $6, $7::jsonb, $8::jsonb, $9, NULL, NULL, $10)
`

const INSERT_IDEMPOTENCY_SQL = `
  INSERT INTO moderation_report_idempotency (
    id, actor_user_id, idempotency_key, request_hash, report_id,
    response_status, response_json, created_at, expires_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (actor_user_id, idempotency_key) DO NOTHING
`

function affectedRows<Row extends Record<string, unknown>>(result: QueryResult<Row>): number {
  return result.rowCount ?? result.rows.length
}

function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString()
    return value
  }
  throw new ModerationReportWriteStoreError('REPORT_WRITE_FAILED', 500)
}

function decodeStoredResult(value: unknown): ReportResult {
  if (typeof value !== 'string') {
    throw new ModerationReportWriteStoreError('REPORT_WRITE_FAILED', 500)
  }
  try {
    const parsed = JSON.parse(value) as ReportResult
    if (
      !parsed ||
      typeof parsed.reportId !== 'string' ||
      typeof parsed.targetType !== 'string' ||
      typeof parsed.targetId !== 'string' ||
      typeof parsed.reasonCode !== 'string' ||
      (parsed.status !== 'CREATED' && parsed.status !== 'DEDUPLICATED') ||
      typeof parsed.createdAt !== 'string'
    ) {
      throw new Error('invalid stored report response')
    }
    return parsed
  } catch {
    throw new ModerationReportWriteStoreError('REPORT_WRITE_FAILED', 500)
  }
}

type IdempotencyRow = {
  report_id: string
  request_hash: string
  response_json: string | null
}

function resolveExistingIdempotency(
  row: IdempotencyRow | undefined,
  requestHash: string,
): ReportResult {
  if (!row) throw new ModerationReportWriteStoreError('REPORT_WRITE_FAILED', 500)
  if (row.request_hash !== requestHash) {
    throw new ModerationReportWriteStoreError('CONFLICT', 409)
  }
  return decodeStoredResult(row.response_json)
}

export function createPostgresModerationReportWriteStore(
  pool: W06ModerationPostgresPool,
): ModerationReportWriteStore {
  // W09 owns AuditEvent. Validate this exact append-only INSERT with W09's
  // existing SQL policy before using it inside the W06-owned transaction.
  assertW09AuditEventStatement(INSERT_AUDIT_EVENT_SQL)

  return {
    async create(command: ModerationReportWriteCommand): Promise<ReportResult> {
      const client = await pool.connect()
      let transactionOpen = false
      try {
        await client.query('BEGIN')
        transactionOpen = true

        const existingIdempotency = await client.query<IdempotencyRow>(
          FIND_IDEMPOTENCY_SQL,
          [command.actorUserId, command.idempotencyKey],
        )
        if (existingIdempotency.rows[0]) {
          const result = resolveExistingIdempotency(existingIdempotency.rows[0], command.requestHash)
          await client.query('COMMIT')
          transactionOpen = false
          return result
        }

        const priorReport = await client.query<{
          report_id: string
          target_type: string
          target_id: string
          reason_code: string
          created_at: string | Date
        }>(FIND_PRIOR_REPORT_SQL, [
          command.actorUserId,
          command.targetType,
          command.targetId,
          command.reasonCode,
          command.dedupBucket,
        ])

        if (priorReport.rows[0]) {
          const prior = priorReport.rows[0]
          const result: ReportResult = {
            reportId: prior.report_id,
            targetType: prior.target_type as ReportResult['targetType'],
            targetId: prior.target_id,
            reasonCode: prior.reason_code,
            status: 'DEDUPLICATED',
            createdAt: toIsoTimestamp(prior.created_at),
          }
          const insertedIdempotency = await client.query(
            INSERT_IDEMPOTENCY_SQL,
            [
              command.idempotencyId,
              command.actorUserId,
              command.idempotencyKey,
              command.requestHash,
              result.reportId,
              201,
              JSON.stringify(result),
              command.createdAt,
              command.expiresAt,
            ],
          )
          if (affectedRows(insertedIdempotency) === 0) {
            const raced = await client.query<IdempotencyRow>(
              FIND_IDEMPOTENCY_SQL,
              [command.actorUserId, command.idempotencyKey],
            )
            const replay = resolveExistingIdempotency(raced.rows[0], command.requestHash)
            await client.query('COMMIT')
            transactionOpen = false
            return replay
          }

          await client.query('COMMIT')
          transactionOpen = false
          return result
        }

        const result: ReportResult = {
          reportId: command.reportId,
          targetType: command.targetType,
          targetId: command.targetId,
          reasonCode: command.reasonCode,
          status: 'CREATED',
          createdAt: command.createdAt,
        }

        const insertedReport = await client.query(
          INSERT_REPORT_SQL,
          [
            command.reportId,
            command.actorUserId,
            command.targetType,
            command.targetId,
            command.reasonCode,
            command.description || null,
            JSON.stringify(command.evidenceRefs),
            command.policyVersion,
            command.dedupBucket,
            command.createdAt,
          ],
        )

        // Preserve the old changes() = 1 rule: only the transaction that
        // inserted a new report may append its W09-owned AuditEvent.
        if (affectedRows(insertedReport) > 0) {
          await client.query(INSERT_AUDIT_EVENT_SQL, [
            command.auditEventId,
            command.requestId,
            { actorId: command.actorUserId, actorType: 'user' },
            'moderation.report.created',
            'Report',
            command.reportId,
            {},
            {
              reportId: command.reportId,
              targetType: command.targetType,
              targetId: command.targetId,
              reasonCode: command.reasonCode,
              policyVersion: command.policyVersion,
              correlationId: command.correlationId,
            },
            command.reasonCode,
            command.createdAt,
          ])
        }

        const insertedIdempotency = await client.query(
          INSERT_IDEMPOTENCY_SQL,
          [
            command.idempotencyId,
            command.actorUserId,
            command.idempotencyKey,
            command.requestHash,
            command.reportId,
            201,
            JSON.stringify(result),
            command.createdAt,
            command.expiresAt,
          ],
        )
        if (affectedRows(insertedIdempotency) === 0) {
          // A same-key request may have committed while this transaction was
          // preparing its report. Resolve it before commit; conflicting intent
          // rolls back the report and audit append above.
          const raced = await client.query<IdempotencyRow>(
            FIND_IDEMPOTENCY_SQL,
            [command.actorUserId, command.idempotencyKey],
          )
          const replay = resolveExistingIdempotency(raced.rows[0], command.requestHash)
          await client.query('COMMIT')
          transactionOpen = false
          return replay
        }

        await client.query('COMMIT')
        transactionOpen = false
        return result
      } catch (error) {
        if (transactionOpen) {
          try {
            await client.query('ROLLBACK')
          } catch {
            // Preserve the original safe error.
          }
        }
        if (error instanceof ModerationReportWriteStoreError) throw error
        throw new ModerationReportWriteStoreError('REPORT_WRITE_FAILED', 500)
      } finally {
        client.release()
      }
    },
  }
}
