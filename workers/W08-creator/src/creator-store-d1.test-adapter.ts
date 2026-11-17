import type {
  CompleteCreatorGrantInput,
  CreateCreatorApplicationInput,
  CreatorApplicationOwnRow,
  CreatorApplicationReplayRow,
  CreatorApplicationReviewRow,
  CreatorApplicationRow,
  CreatorIdentityRow,
  DecideCreatorApplicationInput,
  W08CreatorStore,
} from './creator-store.js'

/**
 * @deprecated-next-version
 * Reason: The D1-backed creator Store exists only as a unit-test adapter and is not used by the W08 production entrypoint.
 * Replacement: createPostgresW08CreatorStore, with tests injecting in-memory W08CreatorStore fixtures.
 * Removal: Next release.
 * Condition: W08 worker lifecycle tests use in-memory W08CreatorStore fixtures and no longer need D1 SQL execution semantics.
 */
export interface W08D1PreparedStatement {
  bind(...values: unknown[]): W08D1PreparedStatement
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<{ results?: T[] | null }>
}

/**
 * @deprecated-next-version
 * Reason: Legacy D1 database facade is retained only by the isolated W08 unit-test adapter.
 * Replacement: W08CreatorStore port with createPostgresW08CreatorStore in production.
 * Removal: Next release.
 * Condition: W08 unit tests use in-memory W08CreatorStore fixtures and no longer require SQL-level D1 emulation.
 */
export interface W08D1Database {
  prepare(sql: string): W08D1PreparedStatement
  batch(statements: W08D1PreparedStatement[]): Promise<Array<{ meta?: { changes?: number } }>>
}

type AuditEventInput = Readonly<{
  eventKey: string
  actorId: string
  subjectId: string
  eventType: 'CREATOR_APPLICATION_SUBMITTED' | 'CREATOR_APPLICATION_APPROVED' |
    'CREATOR_APPLICATION_REJECTED' | 'CREATOR_ROLE_GRANTED'
  resourceType: 'creator_application' | 'creator' | 'role_assignment'
  resourceId: string
  fromState: string | null
  toState: string | null
  idempotencyKey: string | null
  correlationId: string | null
  occurredAt: string
  details: Record<string, unknown>
}>

function correlationFor(event: AuditEventInput): string | null {
  return event.correlationId?.trim().slice(0, 128) || null
}

function d1AuditStatement(db: W08D1Database, input: AuditEventInput): W08D1PreparedStatement {
  return db.prepare(
    'INSERT OR IGNORE INTO creator_authorization_audit ' +
    '(audit_id,event_key,actor_id,subject_id,event_type,resource_type,resource_id,from_state,to_state,idempotency_key,correlation_id,occurred_at,details_json) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).bind(
    crypto.randomUUID(),
    input.eventKey,
    input.actorId,
    input.subjectId,
    input.eventType,
    input.resourceType,
    input.resourceId,
    input.fromState,
    input.toState,
    input.idempotencyKey,
    correlationFor(input),
    input.occurredAt,
    JSON.stringify(input.details),
  )
}

function d1DecisionAuditStatement(
  db: W08D1Database,
  input: AuditEventInput & Readonly<{ applicationId: string; expectedStatus: 'APPROVED' | 'REJECTED' }>,
): W08D1PreparedStatement {
  return db.prepare(
    'INSERT OR IGNORE INTO creator_authorization_audit ' +
    '(audit_id,event_key,actor_id,subject_id,event_type,resource_type,resource_id,from_state,to_state,idempotency_key,correlation_id,occurred_at,details_json) ' +
    'SELECT ?, ?, ?, user_id, ?, \'creator_application\', application_id, \'PENDING\', ?, ?, ?, ?, ? ' +
    'FROM creator_applications WHERE application_id = ? AND status = ? AND decision_idempotency_key = ? AND decided_by = ?',
  ).bind(
    crypto.randomUUID(),
    input.eventKey,
    input.actorId,
    input.eventType,
    input.toState,
    input.idempotencyKey,
    correlationFor(input),
    input.occurredAt,
    JSON.stringify(input.details),
    input.applicationId,
    input.expectedStatus,
    input.idempotencyKey,
    input.actorId,
  )
}

export function createD1W08CreatorStore(db: W08D1Database): W08CreatorStore {
  return {
    findApplicationByIdempotency(userId, idempotencyKey) {
      return db.prepare(
        'SELECT application_id, user_id, creator_type, statement, status, grant_state, version, created_at ' +
        'FROM creator_applications WHERE user_id = ? AND application_idempotency_key = ? LIMIT 1',
      ).bind(userId, idempotencyKey).first<CreatorApplicationReplayRow>()
    },

    findCreatorByUser(userId) {
      return db.prepare(
        'SELECT creator_id, application_id, status ' +
        'FROM creators WHERE user_id = ? LIMIT 1',
      ).bind(userId).first<CreatorIdentityRow>()
    },

    findPendingApplicationByUser(userId) {
      return db.prepare(
        "SELECT application_id FROM creator_applications WHERE user_id = ? AND status = 'PENDING' LIMIT 1",
      ).bind(userId).first<{ application_id: string }>()
    },

    async createApplication(input) {
      await db.batch([
        db.prepare(
          'INSERT INTO creator_applications ' +
          "(application_id,user_id,creator_type,statement,status,grant_state,version,application_idempotency_key,created_at,updated_at) " +
          "VALUES (?,?,?,?,'PENDING','NOT_REQUESTED',1,?,?,?)",
        ).bind(
          input.applicationId,
          input.userId,
          input.creatorType,
          input.statement,
          input.idempotencyKey,
          input.now,
          input.now,
        ),
        d1AuditStatement(db, {
          eventKey: 'creator-application-submitted:' + input.applicationId,
          actorId: input.userId,
          subjectId: input.userId,
          eventType: 'CREATOR_APPLICATION_SUBMITTED',
          resourceType: 'creator_application',
          resourceId: input.applicationId,
          fromState: null,
          toState: 'PENDING',
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId,
          occurredAt: input.now,
          details: { creatorType: input.creatorType },
        }),
      ])
    },

    findOwnApplication(userId) {
      return db.prepare(
        'SELECT application_id, creator_type, statement, status, grant_state, version, created_at, updated_at, decided_at, decision_reason ' +
        'FROM creator_applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      ).bind(userId).first<CreatorApplicationOwnRow>()
    },

    async listReviewableApplications(reviewerId, limit) {
      const result = await db.prepare(
        "SELECT application_id, user_id, creator_type, statement, status, grant_state, version, created_at " +
        "FROM creator_applications WHERE status = 'PENDING' OR (status = 'APPROVED' AND grant_state = 'PENDING' AND decided_by = ?) ORDER BY created_at ASC LIMIT ?",
      ).bind(reviewerId, limit).all<CreatorApplicationReviewRow>()
      return result.results ?? []
    },

    readApplication(applicationId) {
      return db.prepare(
        'SELECT application_id, user_id, creator_type, statement, status, grant_state, version, ' +
        'application_idempotency_key, decision_idempotency_key, decided_by, decision_reason, created_at, updated_at, decided_at ' +
        'FROM creator_applications WHERE application_id = ? LIMIT 1',
      ).bind(applicationId).first<CreatorApplicationRow>()
    },

    async approveApplication(input) {
      const results = await db.batch([
        db.prepare(
          "UPDATE creator_applications SET status = 'APPROVED', grant_state = 'PENDING', version = version + 1, " +
          'decision_idempotency_key = ?, decided_by = ?, decision_reason = ?, decided_at = ?, updated_at = ? ' +
          "WHERE application_id = ? AND status = 'PENDING' AND version = ?",
        ).bind(
          input.idempotencyKey,
          input.actorId,
          input.reason,
          input.now,
          input.now,
          input.applicationId,
          input.expectedVersion,
        ),
        db.prepare(
          "INSERT INTO creators (creator_id,user_id,application_id,creator_type,status,version,created_at,updated_at) " +
          "SELECT ?, user_id, application_id, creator_type, 'PENDING_ROLE_GRANT', 1, ?, ? " +
          "FROM creator_applications WHERE application_id = ? AND status = 'APPROVED' " +
          "AND decision_idempotency_key = ? AND decided_by = ? " +
          'ON CONFLICT(application_id) DO NOTHING',
        ).bind(
          'creator-' + input.applicationId,
          input.now,
          input.now,
          input.applicationId,
          input.idempotencyKey,
          input.actorId,
        ),
        d1DecisionAuditStatement(db, {
          applicationId: input.applicationId,
          expectedStatus: 'APPROVED',
          eventKey: 'creator-application-decision:' + input.applicationId + ':' + input.idempotencyKey,
          actorId: input.actorId,
          subjectId: input.applicantId,
          eventType: 'CREATOR_APPLICATION_APPROVED',
          resourceType: 'creator_application',
          resourceId: input.applicationId,
          fromState: 'PENDING',
          toState: 'APPROVED',
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId,
          occurredAt: input.now,
          details: { reason: input.reason },
        }),
      ])
      return (results[0]?.meta?.changes ?? 0) === 1
    },

    async rejectApplication(input) {
      const results = await db.batch([
        db.prepare(
          "UPDATE creator_applications SET status = 'REJECTED', grant_state = 'NOT_REQUESTED', version = version + 1, " +
          'decision_idempotency_key = ?, decided_by = ?, decision_reason = ?, decided_at = ?, updated_at = ? ' +
          "WHERE application_id = ? AND status = 'PENDING' AND version = ?",
        ).bind(
          input.idempotencyKey,
          input.actorId,
          input.reason,
          input.now,
          input.now,
          input.applicationId,
          input.expectedVersion,
        ),
        d1DecisionAuditStatement(db, {
          applicationId: input.applicationId,
          expectedStatus: 'REJECTED',
          eventKey: 'creator-application-decision:' + input.applicationId + ':' + input.idempotencyKey,
          actorId: input.actorId,
          subjectId: input.applicantId,
          eventType: 'CREATOR_APPLICATION_REJECTED',
          resourceType: 'creator_application',
          resourceId: input.applicationId,
          fromState: 'PENDING',
          toState: 'REJECTED',
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId,
          occurredAt: input.now,
          details: { reason: input.reason },
        }),
      ])
      return (results[0]?.meta?.changes ?? 0) === 1
    },

    async completeCreatorGrant(input) {
      await db.batch([
        db.prepare(
          "UPDATE creator_applications SET grant_state = 'GRANTED', version = version + 1, updated_at = ? " +
          "WHERE application_id = ? AND status = 'APPROVED' AND grant_state = 'PENDING'",
        ).bind(input.now, input.applicationId),
        db.prepare(
          "UPDATE creators SET status = 'ACTIVE', version = version + 1, updated_at = ? " +
          "WHERE application_id = ? AND status = 'PENDING_ROLE_GRANT'",
        ).bind(input.now, input.applicationId),
        d1AuditStatement(db, {
          eventKey: 'creator-role-granted:' + input.applicationId,
          actorId: input.actorId,
          subjectId: input.applicantId,
          eventType: 'CREATOR_ROLE_GRANTED',
          resourceType: 'creator',
          resourceId: input.creatorId,
          fromState: 'PENDING_ROLE_GRANT',
          toState: 'ACTIVE',
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId,
          occurredAt: input.now,
          details: { roleId: 'creator', approvalRef: 'creator-application-' + input.applicationId },
        }),
      ])
    },

    async findActiveCreator(userId) {
      return db.prepare(
        "SELECT creator_id FROM creators WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1",
      ).bind(userId).first<{ creator_id: string }>()
    },
  }
}

