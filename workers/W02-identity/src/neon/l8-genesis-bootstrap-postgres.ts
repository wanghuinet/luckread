import layers from '../../../../contracts/authz/layers.json'
import type { VerifiedL8BootstrapApproval } from '../authz/l8-genesis-bootstrap-approval.js'
import {
  L8BootstrapCommandError,
} from '../authz/l8-genesis-bootstrap-command.js'
import {
  L8BootstrapReadinessError,
} from '../authz/l8-genesis-bootstrap-readiness.js'
import type { Pool, PoolClient } from 'pg'

type PgConnection = Pool | PoolClient

type ExistingAudit = {
  requestPrNumber: number
  requestHeadSha: string
  requestMergeSha: string
  targetUserId: string
  assignmentId: string
  nonceSha256: string
  validFrom: Date | string
  validUntil: Date | string
}

type ExistingAssignment = {
  id: string
  subjectId: string
  roleId: string
  scopeType: string
  scopeId: string | null
  status: string
  validFrom: Date | string
  validUntil: Date | string | null
}

const L8_BOOTSTRAP_LOCK_KEY = '5232486941235606813'
const BOOTSTRAP_KEY = 'first-l8'
const MAX_GRANT_MS = 4 * 60 * 60 * 1000

const roleToLayer = new Map<string, string>()
const mfaRequiredByLayer = new Map<string, boolean>()
for (const layer of layers['x-layers']) {
  for (const role of layer.roles ?? []) roleToLayer.set(role, layer.id)
  mfaRequiredByLayer.set(layer.id, layer.mfa === true)
}

const toIso = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('invalid persisted L8 bootstrap timestamp')
  return date.toISOString()
}

const nonceSha256 = async (nonce: string): Promise<string> => {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce))
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const assertApprovalShape = (
  approval: VerifiedL8BootstrapApproval,
  now: string,
  errorType: 'readiness' | 'command',
): void => {
  const ErrorType = errorType === 'readiness' ? L8BootstrapReadinessError : L8BootstrapCommandError
  const request = approval?.request
  const reviewer = approval?.approvedReviewers?.[0]
  const invalid =
    !request ||
    request.version !== 1 ||
    request.operation !== 'INITIAL_L8_BOOTSTRAP' ||
    request.roleId !== 'super_admin' ||
    request.scopeType !== 'global' ||
    request.scopeId !== null ||
    typeof request.targetUserId !== 'string' ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(request.targetUserId) ||
    typeof request.reason !== 'string' ||
    request.reason.trim().length < 10 ||
    request.reason.length > 512 ||
    typeof request.nonce !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(request.nonce) ||
    !Number.isSafeInteger(approval.requestPrNumber) ||
    approval.requestPrNumber < 1 ||
    approval.requestPrNumber > 2_147_483_647 ||
    !/^[a-f0-9]{40}$/i.test(approval.requestHeadSha) ||
    !/^[a-f0-9]{40}$/i.test(approval.requestMergeSha) ||
    !/^[0-9]+$/.test(approval.workflowRunId) ||
    !Array.isArray(approval.approvedReviewers) ||
    approval.approvedReviewers.length !== 1 ||
    typeof reviewer !== 'string' ||
    new Set(approval.approvedReviewers.map((name) => name.toLowerCase())).size !== 1 ||
    !approval.reviewerPermissions ||
    Object.keys(approval.reviewerPermissions).length !== 1 ||
    Object.keys(approval.reviewerPermissions)[0]?.toLowerCase() !== reviewer.toLowerCase() ||
    !['admin', 'maintain'].includes(String(approval.reviewerPermissions[reviewer] ?? '').toLowerCase()) ||
    !Number.isFinite(Date.parse(now))
  if (invalid) {
    throw new ErrorType('VALIDATION_FAILED', 'invalid verified L8 bootstrap approval')
  }

  const createdAt = Date.parse(request.createdAt)
  const expiresAt = Date.parse(request.expiresAt)
  const nowMs = Date.parse(now)
  if (
    !Number.isFinite(createdAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= createdAt ||
    expiresAt <= nowMs ||
    createdAt > nowMs ||
    expiresAt - createdAt > MAX_GRANT_MS
  ) {
    throw new ErrorType(
      'REQUEST_EXPIRED_OR_INVALID',
      'approved bootstrap request is outside its validity interval',
    )
  }
}

const validateCanonicalL8 = (
  errorType: 'readiness' | 'command',
): void => {
  const ErrorType = errorType === 'readiness' ? L8BootstrapReadinessError : L8BootstrapCommandError
  if (roleToLayer.get('super_admin') !== 'L8' || mfaRequiredByLayer.get('L8') !== true) {
    throw new ErrorType('ROLE_MAPPING_INVALID', 'super_admin must remain canonical MFA-protected L8')
  }
}

const roleVersionFor = async (db: PgConnection, subjectId: string): Promise<number> => {
  const result = await db.query<{ roleVersion: number }>(
    'SELECT role_version AS "roleVersion" FROM role_authorization_versions WHERE subject_id = $1',
    [subjectId],
  )
  const value = result.rows[0]?.roleVersion
  if (value === undefined) return 0
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('invalid persisted role_version')
  return value
}

const readAssignment = async (db: PgConnection, assignmentId: string): Promise<ExistingAssignment | null> => {
  const result = await db.query<ExistingAssignment>(
    'SELECT id, subject_id AS "subjectId", role_id AS "roleId", scope_type AS "scopeType", ' +
      'scope_id AS "scopeId", status, valid_from AS "validFrom", valid_until AS "validUntil" ' +
      'FROM role_assignments WHERE id = $1 LIMIT 1',
    [assignmentId],
  )
  return result.rows[0] ?? null
}

const isEffectiveL8Assignment = (
  assignment: ExistingAssignment | null,
  targetUserId: string,
  assignmentId: string,
  validFrom: string,
  validUntil: string,
  now: string,
): boolean =>
  !!assignment &&
  assignment.id === assignmentId &&
  assignment.subjectId === targetUserId &&
  assignment.roleId === 'super_admin' &&
  assignment.scopeType === 'global' &&
  assignment.scopeId === null &&
  assignment.status === 'ACTIVE' &&
  toIso(assignment.validFrom) === validFrom &&
  (assignment.validUntil === null ? null : toIso(assignment.validUntil)) === validUntil &&
  Date.parse(now) < Date.parse(validUntil)

/**
 * Read-only PostgreSQL preflight. The independent OIDC / GitHub single-review
 * verifier remains the sole source of approval evidence. The write command
 * rechecks every mutable precondition under the one-time advisory lock.
 */
export async function checkL8BootstrapReadinessPostgres(
  pool: Pool,
  approval: VerifiedL8BootstrapApproval,
  now = new Date().toISOString(),
): Promise<{
  status: 'READY_FOR_BOOTSTRAP'
  targetUserId: string
  roleId: 'super_admin'
  scopeType: 'global'
  maxGrantSeconds: 14400
  requestPrNumber: number
  requestHeadSha: string
  requestMergeSha: string
  approvedReviewers: string[]
  productionMutationPerformed: false
}> {
  assertApprovalShape(approval, now, 'readiness')
  validateCanonicalL8('readiness')
  const request = approval.request
  const nowMs = Date.parse(now)

  try {
    await Promise.all([
      pool.query('SELECT two_factor_enabled, mfa_enrolled_at FROM "user" LIMIT 0'),
      pool.query('SELECT "userId", verified, "lastAcceptedTotpTimeStep" FROM "twoFactor" LIMIT 0'),
      pool.query('SELECT bootstrap_key FROM l8_genesis_bootstrap_audit LIMIT 0'),
      pool.query('SELECT role_id, valid_until FROM role_assignments LIMIT 0'),
      pool.query('SELECT subject_id, role_version, updated_at FROM role_authorization_versions LIMIT 0'),
    ])
  } catch {
    throw new L8BootstrapReadinessError('SCHEMA_NOT_READY', 'required PostgreSQL MFA or L8 bootstrap schema is missing')
  }

  const triggers = await pool.query<{ triggerName: string }>(
    'SELECT t.tgname AS "triggerName" FROM pg_trigger t ' +
      'JOIN pg_class c ON c.oid = t.tgrelid ' +
      'JOIN pg_namespace n ON n.oid = c.relnamespace ' +
      "WHERE n.nspname = current_schema() AND c.relname = 'user' AND NOT t.tgisinternal " +
      'AND t.tgname = ANY($1::text[])',
    [['user_mfa_enable_revoke_sessions', 'user_mfa_disable_clear_enrollment']],
  )
  const installedTriggers = new Set(triggers.rows.map((row) => row.triggerName))
  if (
    !installedTriggers.has('user_mfa_enable_revoke_sessions') ||
    !installedTriggers.has('user_mfa_disable_clear_enrollment')
  ) {
    throw new L8BootstrapReadinessError('SCHEMA_NOT_READY', 'PostgreSQL MFA lifecycle session-revocation triggers are missing')
  }

  const auditTriggers = await pool.query<{ triggerName: string }>(
    'SELECT t.tgname AS "triggerName" FROM pg_trigger t ' +
      'JOIN pg_class c ON c.oid = t.tgrelid ' +
      'JOIN pg_namespace n ON n.oid = c.relnamespace ' +
      "WHERE n.nspname = current_schema() AND c.relname = 'l8_genesis_bootstrap_audit' AND NOT t.tgisinternal",
  )
  const installedAuditTriggers = new Set(auditTriggers.rows.map((row) => row.triggerName))
  if (
    !installedAuditTriggers.has('l8_genesis_bootstrap_audit_no_update_or_delete') ||
    !installedAuditTriggers.has('l8_genesis_bootstrap_audit_no_truncate')
  ) {
    throw new L8BootstrapReadinessError(
      'SCHEMA_NOT_READY',
      'permanent L8 bootstrap audit immutability triggers are missing',
    )
  }

  const targetResult = await pool.query<{ accountState: string | null; emailVerified: boolean | null }>(
    'SELECT account_state AS "accountState", email_verified AS "emailVerified" ' +
      'FROM "user" WHERE id = $1 LIMIT 1',
    [request.targetUserId],
  )
  const target = targetResult.rows[0]
  if (!target || target.accountState !== 'ACTIVE' || target.emailVerified !== true) {
    throw new L8BootstrapReadinessError('TARGET_NOT_ELIGIBLE', 'target must be an ACTIVE email-verified account')
  }

  const mfaResult = await pool.query<{
    twoFactorEnabled: boolean | null
    mfaEnrolledAt: Date | string | null
    totpVerified: boolean | null
  }>(
    'SELECT u.two_factor_enabled AS "twoFactorEnabled", u.mfa_enrolled_at AS "mfaEnrolledAt", ' +
      'tf.verified AS "totpVerified" FROM "user" u ' +
      'LEFT JOIN "twoFactor" tf ON tf."userId" = u.id WHERE u.id = $1 LIMIT 1',
    [request.targetUserId],
  )
  const mfa = mfaResult.rows[0]
  const enrollmentMs = mfa?.mfaEnrolledAt
    ? Date.parse(toIso(mfa.mfaEnrolledAt))
    : Number.NaN
  if (
    mfa?.twoFactorEnabled !== true ||
    mfa.totpVerified !== true ||
    !Number.isFinite(enrollmentMs) ||
    enrollmentMs > nowMs
  ) {
    throw new L8BootstrapReadinessError(
      'MFA_REQUIRED',
      'target must have a currently enabled and verified MFA factor before genesis L8 can be consumed',
    )
  }

  const l2 = await pool.query<{ id: string }>(
    "SELECT id FROM role_assignments WHERE subject_id = $1 AND role_id = 'verified_user' " +
      "AND scope_type = 'global' AND scope_id IS NULL AND status = 'ACTIVE' " +
      'AND valid_from <= $2 AND (valid_until IS NULL OR $3 < valid_until) LIMIT 1',
    [request.targetUserId, now, now],
  )
  if (!l2.rows[0]) {
    throw new L8BootstrapReadinessError('VERIFIED_ROLE_REQUIRED', 'target must hold an effective L2 verified_user role')
  }

  const l8 = await pool.query<{ id: string }>(
    "SELECT id FROM role_assignments WHERE role_id = 'super_admin' AND scope_type = 'global' " +
      "AND scope_id IS NULL AND status = 'ACTIVE' AND valid_from <= $1 " +
      'AND (valid_until IS NULL OR $2 < valid_until) LIMIT 1',
    [now, now],
  )
  if (l8.rows[0]) {
    throw new L8BootstrapReadinessError('L8_ALREADY_EXISTS', 'an effective global L8 already exists')
  }

  const consumed = await pool.query<{ bootstrapKey: string }>(
    'SELECT bootstrap_key AS "bootstrapKey" FROM l8_genesis_bootstrap_audit WHERE bootstrap_key = $1 LIMIT 1',
    [BOOTSTRAP_KEY],
  )
  if (consumed.rows[0]) {
    throw new L8BootstrapReadinessError('BOOTSTRAP_ALREADY_CONSUMED', 'the one-time L8 bootstrap guard has already been consumed')
  }

  return {
    status: 'READY_FOR_BOOTSTRAP',
    targetUserId: request.targetUserId,
    roleId: 'super_admin',
    scopeType: 'global',
    maxGrantSeconds: 14400,
    requestPrNumber: approval.requestPrNumber,
    requestHeadSha: approval.requestHeadSha,
    requestMergeSha: approval.requestMergeSha,
    approvedReviewers: [...approval.approvedReviewers].map((name) => name.toLowerCase()).sort(),
    productionMutationPerformed: false,
  }
}

/**
 * Executes the permanent one-time L8 grant using a transaction-scoped advisory
 * lock. The singleton audit row and RoleAssignment are committed atomically;
 * PostgreSQL triggers own role_version advancement. The audit row itself is
 * protected from UPDATE/DELETE by the additive 0011 migration.
 */
export async function bootstrapSuperAdminPostgres(
  pool: Pool,
  approval: VerifiedL8BootstrapApproval,
  now = new Date().toISOString(),
): Promise<{
  assignmentId: string
  targetUserId: string
  roleId: 'super_admin'
  validFrom: string
  validUntil: string
  replayed: boolean
  roleVersion: number
}> {
  assertApprovalShape(approval, now, 'command')
  validateCanonicalL8('command')

  const request = approval.request
  const hashedNonce = await nonceSha256(request.nonce)
  const assignmentId = 'ra-l8g-' + approval.requestPrNumber + '-' + hashedNonce.slice(0, 24)
  const nowMs = Date.parse(now)
  const validUntil = new Date(nowMs + MAX_GRANT_MS).toISOString()
  const reviewers = [...approval.approvedReviewers].map((login) => login.toLowerCase()).sort()
  const permissions = Object.fromEntries(
    Object.entries(approval.reviewerPermissions).map(([login, permission]) => [login.toLowerCase(), permission.toLowerCase()]),
  )

  const client = await pool.connect()
  let transactionOpen = false
  try {
    await client.query('BEGIN')
    transactionOpen = true
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [L8_BOOTSTRAP_LOCK_KEY])

    const existingAuditResult = await client.query<ExistingAudit>(
      'SELECT request_pr_number AS "requestPrNumber", request_head_sha AS "requestHeadSha", ' +
        'request_merge_sha AS "requestMergeSha", target_user_id AS "targetUserId", ' +
        'role_assignment_id AS "assignmentId", nonce_sha256 AS "nonceSha256", ' +
        'valid_from AS "validFrom", valid_until AS "validUntil" ' +
        'FROM l8_genesis_bootstrap_audit WHERE bootstrap_key = $1 LIMIT 1 FOR UPDATE',
      [BOOTSTRAP_KEY],
    )
    const existingAudit = existingAuditResult.rows[0]
    if (existingAudit) {
      const existingValidFrom = toIso(existingAudit.validFrom)
      const existingValidUntil = toIso(existingAudit.validUntil)
      const sameRequest =
        Number(existingAudit.requestPrNumber) === approval.requestPrNumber &&
        existingAudit.requestHeadSha === approval.requestHeadSha &&
        existingAudit.requestMergeSha === approval.requestMergeSha &&
        existingAudit.targetUserId === request.targetUserId &&
        existingAudit.nonceSha256 === hashedNonce &&
        existingAudit.assignmentId === assignmentId
      if (!sameRequest) {
        throw new L8BootstrapCommandError('BOOTSTRAP_ALREADY_CONSUMED', 'the one-time genesis bootstrap has already been consumed')
      }

      const persisted = await readAssignment(client, existingAudit.assignmentId)
      if (isEffectiveL8Assignment(
        persisted,
        request.targetUserId,
        assignmentId,
        existingValidFrom,
        existingValidUntil,
        now,
      )) {
        const roleVersion = await roleVersionFor(client, request.targetUserId)
        if (roleVersion < 1) {
          throw new L8BootstrapCommandError('ROLE_ASSIGNMENT_WRITE_FAILED', 'bootstrap role version is missing')
        }
        await client.query('COMMIT')
        transactionOpen = false
        return {
          assignmentId,
          targetUserId: request.targetUserId,
          roleId: 'super_admin',
          validFrom: existingValidFrom,
          validUntil: existingValidUntil,
          replayed: true,
          roleVersion,
        }
      }
      throw new L8BootstrapCommandError('BOOTSTRAP_ALREADY_CONSUMED', 'the bootstrap was already consumed and cannot be reissued')
    }

    const userResult = await client.query<{
      accountState: string | null
      emailVerified: boolean | null
    }>(
      'SELECT account_state AS "accountState", email_verified AS "emailVerified" ' +
        'FROM "user" WHERE id = $1 LIMIT 1 FOR UPDATE',
      [request.targetUserId],
    )
    const user = userResult.rows[0]
    if (!user || user.accountState !== 'ACTIVE' || user.emailVerified !== true) {
      throw new L8BootstrapCommandError('TARGET_NOT_ELIGIBLE', 'target must be an ACTIVE email-verified account')
    }

    const mfaResult = await client.query<{
      twoFactorEnabled: boolean | null
      mfaEnrolledAt: Date | string | null
      totpVerified: boolean | null
    }>(
      'SELECT u.two_factor_enabled AS "twoFactorEnabled", u.mfa_enrolled_at AS "mfaEnrolledAt", ' +
        'tf.verified AS "totpVerified" FROM "user" u ' +
        'LEFT JOIN "twoFactor" tf ON tf."userId" = u.id WHERE u.id = $1 LIMIT 1 FOR UPDATE OF u',
      [request.targetUserId],
    )
    const mfa = mfaResult.rows[0]
    const enrollmentMs = mfa?.mfaEnrolledAt ? Date.parse(toIso(mfa.mfaEnrolledAt)) : Number.NaN
    if (
      mfa?.twoFactorEnabled !== true ||
      mfa.totpVerified !== true ||
      !Number.isFinite(enrollmentMs) ||
      enrollmentMs > nowMs
    ) {
      throw new L8BootstrapCommandError(
        'MFA_REQUIRED',
        'target must have a currently enabled and verified MFA factor before genesis L8 can be consumed',
      )
    }

    const verifiedRole = await client.query<{ id: string }>(
      "SELECT id FROM role_assignments WHERE subject_id = $1 AND role_id = 'verified_user' " +
        "AND scope_type = 'global' AND scope_id IS NULL AND status = 'ACTIVE' " +
        'AND valid_from <= $2 AND (valid_until IS NULL OR $3 < valid_until) LIMIT 1',
      [request.targetUserId, now, now],
    )
    if (!verifiedRole.rows[0]) {
      throw new L8BootstrapCommandError('VERIFIED_ROLE_REQUIRED', 'target must hold an effective L2 verified_user role')
    }

    const existingL8 = await client.query<{ id: string }>(
      "SELECT id FROM role_assignments WHERE role_id = 'super_admin' AND scope_type = 'global' " +
        "AND scope_id IS NULL AND status = 'ACTIVE' AND valid_from <= $1 " +
        'AND (valid_until IS NULL OR $2 < valid_until) LIMIT 1',
      [now, now],
    )
    if (existingL8.rows[0]) {
      throw new L8BootstrapCommandError('L8_ALREADY_EXISTS', 'genesis bootstrap is only available before the first effective L8 assignment')
    }

    await client.query(
      'INSERT INTO l8_genesis_bootstrap_audit ' +
        '(bootstrap_key, operation, request_pr_number, request_head_sha, request_merge_sha, target_user_id, ' +
        'role_assignment_id, nonce_sha256, approved_reviewers_json, reviewer_permissions_json, workflow_run_id, ' +
        'valid_from, valid_until, created_at) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14)',
      [
        BOOTSTRAP_KEY,
        'INITIAL_L8_BOOTSTRAP',
        approval.requestPrNumber,
        approval.requestHeadSha,
        approval.requestMergeSha,
        request.targetUserId,
        assignmentId,
        hashedNonce,
        JSON.stringify(reviewers),
        JSON.stringify(permissions),
        approval.workflowRunId,
        now,
        validUntil,
        now,
      ],
    )
    await client.query(
      "INSERT INTO role_assignments " +
        "(id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at) " +
        "VALUES ($1, $2, 'super_admin', 'global', NULL, 'ACTIVE', $3, $4, $3, $3)",
      [assignmentId, request.targetUserId, now, validUntil],
    )

    const persisted = await readAssignment(client, assignmentId)
    if (!isEffectiveL8Assignment(persisted, request.targetUserId, assignmentId, now, validUntil, now)) {
      throw new L8BootstrapCommandError('ROLE_ASSIGNMENT_WRITE_FAILED', 'persisted L8 bootstrap state failed read-back validation')
    }
    const auditReadback = await client.query<{ assignmentId: string }>(
      'SELECT role_assignment_id AS "assignmentId" FROM l8_genesis_bootstrap_audit WHERE bootstrap_key = $1 LIMIT 1',
      [BOOTSTRAP_KEY],
    )
    if (auditReadback.rows[0]?.assignmentId !== assignmentId) {
      throw new L8BootstrapCommandError('ROLE_ASSIGNMENT_WRITE_FAILED', 'persisted L8 bootstrap audit failed read-back validation')
    }
    const roleVersion = await roleVersionFor(client, request.targetUserId)
    if (roleVersion < 1) {
      throw new L8BootstrapCommandError('ROLE_ASSIGNMENT_WRITE_FAILED', 'bootstrap role version read-back failed')
    }

    await client.query('COMMIT')
    transactionOpen = false
    return {
      assignmentId,
      targetUserId: request.targetUserId,
      roleId: 'super_admin',
      validFrom: now,
      validUntil,
      replayed: false,
      roleVersion,
    }
  } catch (error) {
    if (transactionOpen) {
      await client.query('ROLLBACK').catch(() => undefined)
      transactionOpen = false
    }
    if (error instanceof L8BootstrapCommandError) throw error
    const pgCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
    if (pgCode === '42P01' || pgCode === '42703') {
      throw new L8BootstrapCommandError('SCHEMA_NOT_READY', 'L8 bootstrap PostgreSQL schema is not ready')
    }
    if (pgCode === '23P01') {
      throw new L8BootstrapCommandError('L8_ALREADY_EXISTS', 'an effective global L8 assignment already exists')
    }
    if (pgCode === '23505') {
      throw new L8BootstrapCommandError('BOOTSTRAP_ALREADY_CONSUMED', 'the one-time genesis bootstrap has already been consumed')
    }
    throw new L8BootstrapCommandError('ROLE_ASSIGNMENT_WRITE_FAILED', 'L8 bootstrap transaction failed and was rolled back')
  } finally {
    client.release()
  }
}
