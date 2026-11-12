import type { Pool, PoolClient } from 'pg'

export type CreatorApplicationRow = {
  application_id: string
  user_id: string
  creator_type: string
  statement: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  grant_state: 'NOT_REQUESTED' | 'PENDING' | 'GRANTED'
  version: number
  application_idempotency_key: string
  decision_idempotency_key: string | null
  decided_by: string | null
  decision_reason: string | null
  created_at: string
  updated_at: string
  decided_at: string | null
}

export type CreatorApplicationReplayRow = Pick<
  CreatorApplicationRow,
  'application_id' | 'user_id' | 'creator_type' | 'statement' | 'status' |
  'grant_state' | 'version' | 'created_at'
>

export type CreatorApplicationOwnRow = Pick<
  CreatorApplicationRow,
  'application_id' | 'creator_type' | 'statement' | 'status' |
  'grant_state' | 'version' | 'created_at' | 'updated_at' | 'decided_at' | 'decision_reason'
>

export type CreatorApplicationReviewRow = Pick<
  CreatorApplicationRow,
  'application_id' | 'user_id' | 'creator_type' | 'statement' |
  'status' | 'grant_state' | 'version' | 'created_at'
>

export type CreatorIdentityRow = Readonly<{
  creator_id: string
  application_id: string
  status: string
}>

export type CreatorStoreAuditContext = Readonly<{
  correlationId: string | null
  now: string
}>

export type CreateCreatorApplicationInput = CreatorStoreAuditContext & Readonly<{
  applicationId: string
  userId: string
  creatorType: string
  statement: string
  idempotencyKey: string
}>

export type DecideCreatorApplicationInput = CreatorStoreAuditContext & Readonly<{
  applicationId: string
  applicantId: string
  creatorType: string
  actorId: string
  idempotencyKey: string
  reason: string
  expectedVersion: number
}>

export type CompleteCreatorGrantInput = CreatorStoreAuditContext & Readonly<{
  applicationId: string
  applicantId: string
  creatorId: string
  actorId: string
  idempotencyKey: string | null
}>

export interface W08CreatorStore {
  findApplicationByIdempotency(userId: string, idempotencyKey: string): Promise<CreatorApplicationReplayRow | null>
  findCreatorByUser(userId: string): Promise<CreatorIdentityRow | null>
  findPendingApplicationByUser(userId: string): Promise<{ application_id: string } | null>
  createApplication(input: CreateCreatorApplicationInput): Promise<void>
  findOwnApplication(userId: string): Promise<CreatorApplicationOwnRow | null>
  listReviewableApplications(reviewerId: string, limit: number): Promise<CreatorApplicationReviewRow[]>
  readApplication(applicationId: string): Promise<CreatorApplicationRow | null>
  approveApplication(input: DecideCreatorApplicationInput): Promise<boolean>
  rejectApplication(input: DecideCreatorApplicationInput): Promise<boolean>
  completeCreatorGrant(input: CompleteCreatorGrantInput): Promise<void>
  findActiveCreator(userId: string): Promise<{ creator_id: string } | null>
}

export interface W08D1PreparedStatement {
  bind(...values: unknown[]): W08D1PreparedStatement
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<{ results?: T[] | null }>
}

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

function postgresAuditValues(input: AuditEventInput): unknown[] {
  return [
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
  ]
}

const auditInsertSql =
  'INSERT INTO creator_authorization_audit ' +
  '(audit_id,event_key,actor_id,subject_id,event_type,resource_type,resource_id,from_state,to_state,idempotency_key,correlation_id,occurred_at,details_json) ' +
  'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ' +
  'ON CONFLICT (event_key) DO NOTHING'

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

const isoTimestamp = (column: string): string =>
  "to_char(" + column + " AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')"

const applicationColumns = [
  'application_id',
  'user_id',
  'creator_type',
  'statement',
  'status',
  'grant_state',
  'version',
  'application_idempotency_key',
  'decision_idempotency_key',
  'decided_by',
  'decision_reason',
  isoTimestamp('created_at') + ' AS created_at',
  isoTimestamp('updated_at') + ' AS updated_at',
  isoTimestamp('decided_at') + ' AS decided_at',
].join(', ')

async function inTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  let open = false
  try {
    await client.query('BEGIN')
    open = true
    const result = await work(client)
    await client.query('COMMIT')
    open = false
    return result
  } catch (error) {
    if (open) await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export function createPostgresW08CreatorStore(pool: Pool): W08CreatorStore {
  return {
    async findApplicationByIdempotency(userId, idempotencyKey) {
      const result = await pool.query<CreatorApplicationReplayRow>(
        'SELECT application_id, user_id, creator_type, statement, status, grant_state, version, ' +
          isoTimestamp('created_at') + ' AS created_at ' +
          'FROM creator_applications WHERE user_id = $1 AND application_idempotency_key = $2 LIMIT 1',
        [userId, idempotencyKey],
      )
      return result.rows[0] ?? null
    },

    async findCreatorByUser(userId) {
      const result = await pool.query<CreatorIdentityRow>(
        'SELECT creator_id, application_id, status ' +
          'FROM creators WHERE user_id = $1 LIMIT 1',
        [userId],
      )
      return result.rows[0] ?? null
    },

    async findPendingApplicationByUser(userId) {
      const result = await pool.query<{ application_id: string }>(
        "SELECT application_id FROM creator_applications WHERE user_id = $1 AND status = 'PENDING' LIMIT 1",
        [userId],
      )
      return result.rows[0] ?? null
    },

    async createApplication(input) {
      await inTransaction(pool, async (client) => {
        await client.query(
          'INSERT INTO creator_applications ' +
            "(application_id,user_id,creator_type,statement,status,grant_state,version,application_idempotency_key,created_at,updated_at) " +
            "VALUES ($1,$2,$3,$4,'PENDING','NOT_REQUESTED',1,$5,$6,$7)",
          [
            input.applicationId,
            input.userId,
            input.creatorType,
            input.statement,
            input.idempotencyKey,
            input.now,
            input.now,
          ],
        )
        await client.query(auditInsertSql, postgresAuditValues({
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
        }))
      })
    },

    async findOwnApplication(userId) {
      const result = await pool.query<CreatorApplicationOwnRow>(
        'SELECT application_id, creator_type, statement, status, grant_state, version, ' +
          isoTimestamp('created_at') + ' AS created_at, ' +
          isoTimestamp('updated_at') + ' AS updated_at, ' +
          isoTimestamp('decided_at') + ' AS decided_at, decision_reason ' +
          'FROM creator_applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [userId],
      )
      return result.rows[0] ?? null
    },

    async listReviewableApplications(reviewerId, limit) {
      const result = await pool.query<CreatorApplicationReviewRow>(
        "SELECT application_id, user_id, creator_type, statement, status, grant_state, version, " +
          isoTimestamp('created_at') + ' AS created_at ' +
          "FROM creator_applications WHERE status = 'PENDING' OR (status = 'APPROVED' AND grant_state = 'PENDING' AND decided_by = $1) " +
          'ORDER BY created_at ASC LIMIT $2',
        [reviewerId, limit],
      )
      return result.rows
    },

    async readApplication(applicationId) {
      const result = await pool.query<CreatorApplicationRow>(
        'SELECT ' + applicationColumns + ' FROM creator_applications WHERE application_id = $1 LIMIT 1',
        [applicationId],
      )
      return result.rows[0] ?? null
    },

    async approveApplication(input) {
      return inTransaction(pool, async (client) => {
        const updated = await client.query<{ userId: string }>(
          "UPDATE creator_applications SET status = 'APPROVED', grant_state = 'PENDING', version = version + 1, " +
            'decision_idempotency_key = $1, decided_by = $2, decision_reason = $3, decided_at = $4, updated_at = $5 ' +
            "WHERE application_id = $6 AND status = 'PENDING' AND version = $7 RETURNING user_id AS \"userId\"",
          [
            input.idempotencyKey,
            input.actorId,
            input.reason,
            input.now,
            input.now,
            input.applicationId,
            input.expectedVersion,
          ],
        )
        if (updated.rowCount !== 1) return false
        await client.query(
          "INSERT INTO creators (creator_id,user_id,application_id,creator_type,status,version,created_at,updated_at) " +
            "VALUES ($1,$2,$3,$4,'PENDING_ROLE_GRANT',1,$5,$6) " +
            'ON CONFLICT (application_id) DO NOTHING',
          [
            'creator-' + input.applicationId,
            updated.rows[0]?.userId ?? input.applicantId,
            input.applicationId,
            input.creatorType,
            input.now,
            input.now,
          ],
        )
        await client.query(auditInsertSql, postgresAuditValues({
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
        }))
        return true
      })
    },

    async rejectApplication(input) {
      return inTransaction(pool, async (client) => {
        const updated = await client.query<{ userId: string }>(
          "UPDATE creator_applications SET status = 'REJECTED', grant_state = 'NOT_REQUESTED', version = version + 1, " +
            'decision_idempotency_key = $1, decided_by = $2, decision_reason = $3, decided_at = $4, updated_at = $5 ' +
            "WHERE application_id = $6 AND status = 'PENDING' AND version = $7 RETURNING user_id AS \"userId\"",
          [
            input.idempotencyKey,
            input.actorId,
            input.reason,
            input.now,
            input.now,
            input.applicationId,
            input.expectedVersion,
          ],
        )
        if (updated.rowCount !== 1) return false
        await client.query(auditInsertSql, postgresAuditValues({
          eventKey: 'creator-application-decision:' + input.applicationId + ':' + input.idempotencyKey,
          actorId: input.actorId,
          subjectId: updated.rows[0]?.userId ?? input.applicantId,
          eventType: 'CREATOR_APPLICATION_REJECTED',
          resourceType: 'creator_application',
          resourceId: input.applicationId,
          fromState: 'PENDING',
          toState: 'REJECTED',
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId,
          occurredAt: input.now,
          details: { reason: input.reason },
        }))
        return true
      })
    },

    async completeCreatorGrant(input) {
      await inTransaction(pool, async (client) => {
        await client.query(
          "UPDATE creator_applications SET grant_state = 'GRANTED', version = version + 1, updated_at = $1 " +
            "WHERE application_id = $2 AND status = 'APPROVED' AND grant_state = 'PENDING'",
          [input.now, input.applicationId],
        )
        await client.query(
          "UPDATE creators SET status = 'ACTIVE', version = version + 1, updated_at = $1 " +
            "WHERE application_id = $2 AND status = 'PENDING_ROLE_GRANT'",
          [input.now, input.applicationId],
        )
        await client.query(auditInsertSql, postgresAuditValues({
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
        }))
      })
    },

    async findActiveCreator(userId) {
      const result = await pool.query<{ creator_id: string }>(
        "SELECT creator_id AS \"creatorId\" FROM creators WHERE user_id = $1 AND status = 'ACTIVE' LIMIT 1",
        [userId],
      )
      return result.rows[0] ?? null
    },
  }
}
