import layers from '../../../../contracts/authz/layers.json'
import type { Pool, PoolClient } from 'pg'

export type RoleAssignmentRecord = {
  id: string
  subjectId: string
  roleId: string
  scopeType: 'global' | 'organization' | 'ip'
  scopeId: string | null
  status: 'ACTIVE' | 'REVOKED'
  validFrom: string
  validUntil: string | null
  createdAt: string
  updatedAt: string
}

export type ResolvedRoleAssignment = Pick<RoleAssignmentRecord, 'id' | 'roleId' | 'scopeType' | 'scopeId'>

export type LayerResolution = {
  decision: 'ALLOW' | 'DENY'
  layer?: string
  roleAssignments?: ResolvedRoleAssignment[]
}

export type RoleGrantCommand = {
  subjectId: string
  roleId: 'creator'
  scopeType: 'global'
  scopeId: null
  approvalRef: string
}

export type RoleGrantResult = {
  assignmentId: string
  roleId: string
  replayed: boolean
}

export class RoleAssignmentPostgresError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'RoleAssignmentPostgresError'
  }
}

type PgConnection = Pool | PoolClient

type PersistedAssignment = Pick<
  RoleAssignmentRecord,
  'id' | 'subjectId' | 'roleId' | 'scopeType' | 'scopeId' | 'status' | 'validFrom' | 'validUntil'
>

type RoleAssignmentRow = {
  id: string
  subjectId: string
  roleId: string
  scopeType: string
  scopeId: string | null
  status: string
  validFrom: Date | string
  validUntil: Date | string | null
  createdAt: Date | string
  updatedAt: Date | string
}

const roleToLayer = new Map<string, string>()
const mfaRequiredByLayer = new Map<string, boolean>()

for (const layer of layers['x-layers']) {
  for (const role of layer.roles ?? []) roleToLayer.set(role, layer.id)
  mfaRequiredByLayer.set(layer.id, layer.mfa === true)
}

const toIso = (value: Date | string | null): string | null => {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('invalid persisted role assignment timestamp')
  return date.toISOString()
}

const mapAssignment = (row: RoleAssignmentRow): RoleAssignmentRecord => ({
  id: row.id,
  subjectId: row.subjectId,
  roleId: row.roleId,
  scopeType: row.scopeType as RoleAssignmentRecord['scopeType'],
  scopeId: row.scopeId,
  status: row.status as RoleAssignmentRecord['status'],
  validFrom: toIso(row.validFrom) as string,
  validUntil: toIso(row.validUntil),
  createdAt: toIso(row.createdAt) as string,
  updatedAt: toIso(row.updatedAt) as string,
})

const isTimestampValid = (now: string): boolean => !Number.isNaN(Date.parse(now))

const readAssignmentById = async (
  db: PgConnection,
  assignmentId: string,
): Promise<PersistedAssignment | null> => {
  const result = await db.query<PersistedAssignment>(
    'SELECT id, subject_id AS "subjectId", role_id AS "roleId", scope_type AS "scopeType", ' +
      'scope_id AS "scopeId", status, valid_from AS "validFrom", valid_until AS "validUntil" ' +
      'FROM role_assignments WHERE id = $1 LIMIT 1',
    [assignmentId],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    ...row,
    validFrom: toIso(row.validFrom) as string,
    validUntil: toIso(row.validUntil),
  }
}

const isEffective = (row: PersistedAssignment, now: string): boolean =>
  row.status === 'ACTIVE' &&
  Date.parse(row.validFrom) <= Date.parse(now) &&
  (row.validUntil === null || Date.parse(now) < Date.parse(row.validUntil))

const sameCreatorScope = (
  row: PersistedAssignment,
  command: RoleGrantCommand,
): boolean =>
  row.subjectId === command.subjectId &&
  row.roleId === command.roleId &&
  row.scopeType === command.scopeType &&
  row.scopeId === command.scopeId

const assertSubjectId = (subjectId: string): void => {
  if (typeof subjectId !== 'string' || subjectId.length < 1 || subjectId.length > 128) {
    throw new Error('invalid subject id')
  }
}

const assertNow = (now: string): void => {
  if (!isTimestampValid(now)) throw new Error('invalid role assignment timestamp')
}

/**
 * Idempotently materialize the baseline L1 role using PostgreSQL-native SQL.
 * Authorization-version increments are owned by the reviewed PostgreSQL
 * triggers in 0002_role_authorization_versions.sql, not by application SQL.
 */
export async function ensureBaseUserRolePostgres(
  db: PgConnection,
  subjectId: string,
  now = new Date().toISOString(),
): Promise<void> {
  assertSubjectId(subjectId)
  assertNow(now)

  const roleId = 'base-user-' + subjectId
  await db.query(
    'INSERT INTO role_assignments ' +
      '(id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at) ' +
      "VALUES ($1, $2, 'user', 'global', NULL, 'ACTIVE', $3, NULL, $3, $3) " +
      'ON CONFLICT (id) DO NOTHING',
    [roleId, subjectId, now],
  )

  const persisted = await readAssignmentById(db, roleId)
  if (
    !persisted ||
    persisted.subjectId !== subjectId ||
    persisted.roleId !== 'user' ||
    persisted.scopeType !== 'global' ||
    persisted.scopeId !== null ||
    !isEffective(persisted, now)
  ) {
    throw new Error('base role materialization failed validation')
  }
}

/**
 * Materialize L2 only after Better Auth's authoritative identity row is
 * ACTIVE and email-verified. A concurrent verification callback may create
 * the same deterministic assignment; the database unique key is authoritative.
 */
export async function ensureVerifiedUserRolePostgres(
  db: PgConnection,
  subjectId: string,
  now = new Date().toISOString(),
): Promise<void> {
  assertSubjectId(subjectId)
  assertNow(now)
  if (roleToLayer.get('verified_user') !== 'L2') {
    throw new Error('verified_user role must map to L2')
  }

  const user = await db.query<{ accountState: string | null; emailVerified: boolean | null }>(
    'SELECT account_state AS "accountState", email_verified AS "emailVerified" ' +
      'FROM "user" WHERE id = $1 LIMIT 1',
    [subjectId],
  )
  const subject = user.rows[0]
  if (!subject || subject.accountState !== 'ACTIVE' || subject.emailVerified !== true) {
    throw new Error('verified-user role grant requires an ACTIVE email-verified account')
  }

  const roleId = 'verified-user-' + subjectId
  const existing = await readAssignmentById(db, roleId)
  if (existing) {
    if (
      existing.subjectId !== subjectId ||
      existing.roleId !== 'verified_user' ||
      existing.scopeType !== 'global' ||
      existing.scopeId !== null ||
      !isEffective(existing, now)
    ) {
      throw new Error('verified-user role assignment is not currently valid')
    }
    return
  }

  await db.query(
    'INSERT INTO role_assignments ' +
      '(id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at) ' +
      "VALUES ($1, $2, 'verified_user', 'global', NULL, 'ACTIVE', $3, NULL, $3, $3) " +
      'ON CONFLICT (id) DO NOTHING',
    [roleId, subjectId, now],
  )

  const persisted = await readAssignmentById(db, roleId)
  if (
    !persisted ||
    persisted.subjectId !== subjectId ||
    persisted.roleId !== 'verified_user' ||
    persisted.scopeType !== 'global' ||
    persisted.scopeId !== null ||
    !isEffective(persisted, now)
  ) {
    throw new Error('verified-user role materialization failed validation')
  }
}

export function requireMfaForPrivilegedActionPostgres(layer: string, mfaEnabled: boolean): boolean {
  const mfaRequired = mfaRequiredByLayer.get(layer)
  if (mfaRequired === undefined) return false
  return mfaRequired ? mfaEnabled : true
}

/**
 * Resolve the effective global layer from PostgreSQL-owned RoleAssignment
 * facts. Elevated roles are withheld unless Better Auth's persisted TOTP
 * enrollment state is complete and currently effective.
 */
export async function resolveGlobalLayerPostgres(
  db: PgConnection,
  subjectId: string,
  accountState: string,
  now = new Date().toISOString(),
  includeRoleAssignments = false,
): Promise<LayerResolution> {
  if (!subjectId || (accountState !== 'PENDING_VERIFICATION' && accountState !== 'ACTIVE')) {
    return { decision: 'DENY' }
  }
  assertNow(now)

  const assignmentsResult = await db.query<RoleAssignmentRow>(
    'SELECT id, subject_id AS "subjectId", role_id AS "roleId", scope_type AS "scopeType", ' +
      'scope_id AS "scopeId", status, valid_from AS "validFrom", valid_until AS "validUntil", ' +
      'created_at AS "createdAt", updated_at AS "updatedAt" ' +
      'FROM role_assignments ' +
      'WHERE subject_id = $1 AND status = $2 AND valid_from <= $3 ' +
      'AND (valid_until IS NULL OR $4 < valid_until) ' +
      'ORDER BY role_id ASC, id ASC',
    [subjectId, 'ACTIVE', now, now],
  )
  const assignments = assignmentsResult.rows.map(mapAssignment)

  const hasMfaProtectedAssignment = assignments.some((assignment) => {
    const layer = roleToLayer.get(assignment.roleId)
    return !!layer && mfaRequiredByLayer.get(layer) === true
  })

  let mfaEnabled = false
  if (hasMfaProtectedAssignment) {
    const mfaResult = await db.query<{
      twoFactorEnabled: boolean | null
      mfaEnrolledAt: Date | string | null
      totpVerified: boolean | null
    }>(
      'SELECT u.two_factor_enabled AS "twoFactorEnabled", u.mfa_enrolled_at AS "mfaEnrolledAt", ' +
        'tf.verified AS "totpVerified" ' +
        'FROM "user" u LEFT JOIN "twoFactor" tf ON tf."userId" = u.id ' +
        'WHERE u.id = $1 LIMIT 1',
      [subjectId],
    )
    const mfa = mfaResult.rows[0]
    const enrollmentTimestamp = mfa?.mfaEnrolledAt ? Date.parse(toIso(mfa.mfaEnrolledAt) as string) : Number.NaN
    mfaEnabled =
      mfa?.twoFactorEnabled === true &&
      mfa.totpVerified === true &&
      Number.isFinite(enrollmentTimestamp) &&
      enrollmentTimestamp <= Date.parse(now)
  }

  const eligible: Array<{ assignment: RoleAssignmentRecord; layer: string }> = []
  const resolvedAssignments: ResolvedRoleAssignment[] = []

  for (const assignment of assignments) {
    const layer = roleToLayer.get(assignment.roleId)
    if (includeRoleAssignments && !layer) return { decision: 'DENY' }
    if (includeRoleAssignments && (
      (assignment.scopeType === 'global' && assignment.scopeId !== null) ||
      ((assignment.scopeType === 'organization' || assignment.scopeType === 'ip') &&
        (typeof assignment.scopeId !== 'string' || assignment.scopeId.length === 0)) ||
      !['global', 'organization', 'ip'].includes(assignment.scopeType)
    )) return { decision: 'DENY' }
    if (!layer) return { decision: 'DENY' }
    if (!requireMfaForPrivilegedActionPostgres(layer, mfaEnabled)) continue

    if (includeRoleAssignments) {
      resolvedAssignments.push({
        id: assignment.id,
        roleId: assignment.roleId,
        scopeType: assignment.scopeType,
        scopeId: assignment.scopeId,
      })
    }
    if (assignment.scopeType !== 'global') continue
    eligible.push({ assignment, layer })
  }

  if (eligible.length === 0) return { decision: 'DENY' }
  const selected = eligible.reduce((current, next) =>
    Number(next.layer.slice(1)) > Number(current.layer.slice(1)) ? next : current,
  )

  return {
    decision: 'ALLOW',
    layer: selected.layer,
    ...(includeRoleAssignments ? { roleAssignments: resolvedAssignments } : {}),
  }
}

/**
 * Grant the creator role only after W02 eligibility and an effective L2 role
 * have been established. The transaction pins the write to one PostgreSQL
 * connection; GiST exclusion and primary-key constraints arbitrate concurrent
 * approvals. Only an exact deterministic replay is accepted after a conflict.
 */
export async function grantCreatorBusinessRolePostgres(
  pool: Pool,
  command: RoleGrantCommand,
  now = new Date().toISOString(),
): Promise<RoleGrantResult> {
  if (
    !command ||
    typeof command.subjectId !== 'string' ||
    command.subjectId.length < 1 ||
    command.subjectId.length > 128 ||
    !/^[A-Za-z0-9_-]{8,120}$/.test(command.approvalRef) ||
    command.roleId !== 'creator' ||
    command.scopeType !== 'global' ||
    command.scopeId !== null
  ) {
    throw new RoleAssignmentPostgresError('VALIDATION_FAILED', 'invalid role grant command')
  }
  if (roleToLayer.get(command.roleId) !== 'L3') {
    throw new RoleAssignmentPostgresError('ROLE_MAPPING_INVALID', 'role does not map to its contracted layer')
  }
  if (!isTimestampValid(now)) {
    throw new RoleAssignmentPostgresError('VALIDATION_FAILED', 'invalid role grant timestamp')
  }

  const assignmentId = 'ra-' + command.approvalRef
  const client = await pool.connect()
  let transactionOpen = false

  try {
    await client.query('BEGIN')
    transactionOpen = true

    const subjectResult = await client.query<{
      accountState: string | null
      emailVerified: boolean | null
    }>(
      'SELECT account_state AS "accountState", email_verified AS "emailVerified" ' +
        'FROM "user" WHERE id = $1 LIMIT 1',
      [command.subjectId],
    )
    const subject = subjectResult.rows[0]
    if (!subject || subject.accountState !== 'ACTIVE' || subject.emailVerified !== true) {
      throw new RoleAssignmentPostgresError(
        'TARGET_NOT_ELIGIBLE',
        'target must be an ACTIVE email-verified account',
      )
    }

    const verifiedRole = await client.query<{ id: string }>(
      "SELECT id FROM role_assignments WHERE subject_id = $1 AND role_id = 'verified_user' " +
        "AND scope_type = 'global' AND scope_id IS NULL AND status = 'ACTIVE' " +
        'AND valid_from <= $2 AND (valid_until IS NULL OR $3 < valid_until) LIMIT 1',
      [command.subjectId, now, now],
    )
    if (!verifiedRole.rows[0]) {
      throw new RoleAssignmentPostgresError(
        'VERIFIED_ROLE_REQUIRED',
        'target must hold an effective L2 verified_user role',
      )
    }

    const existing = await readAssignmentById(client, assignmentId)
    if (existing) {
      if (
        sameCreatorScope(existing, command) &&
        isEffective(existing, now)
      ) {
        await client.query('COMMIT')
        transactionOpen = false
        return { assignmentId, roleId: 'creator', replayed: true }
      }
      throw new RoleAssignmentPostgresError(
        'ROLE_ASSIGNMENT_CONFLICT',
        'approval reference already has a different or revoked assignment',
      )
    }

    const otherEffective = await client.query<{ id: string }>(
      'SELECT id FROM role_assignments WHERE subject_id = $1 AND role_id = $2 AND scope_type = $3 ' +
        'AND scope_id IS NOT DISTINCT FROM $4 AND status = $5 AND valid_from <= $6 ' +
        'AND (valid_until IS NULL OR $7 < valid_until) LIMIT 1',
      [command.subjectId, command.roleId, command.scopeType, command.scopeId, 'ACTIVE', now, now],
    )
    if (otherEffective.rows[0]) {
      throw new RoleAssignmentPostgresError(
        'ROLE_ASSIGNMENT_ALREADY_ACTIVE',
        'an effective assignment already exists for this role and scope',
      )
    }

    await client.query(
      "INSERT INTO role_assignments " +
        "(id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at) " +
        "VALUES ($1, $2, 'creator', 'global', NULL, 'ACTIVE', $3, NULL, $3, $3)",
      [assignmentId, command.subjectId, now],
    )

    const persisted = await readAssignmentById(client, assignmentId)
    if (
      !persisted ||
      !sameCreatorScope(persisted, command) ||
      !isEffective(persisted, now)
    ) {
      throw new RoleAssignmentPostgresError(
        'ROLE_ASSIGNMENT_WRITE_FAILED',
        'persisted role assignment failed validation',
      )
    }

    await client.query('COMMIT')
    transactionOpen = false
    return { assignmentId, roleId: 'creator', replayed: false }
  } catch (error) {
    if (transactionOpen) {
      await client.query('ROLLBACK').catch(() => undefined)
      transactionOpen = false
    }

    if (error instanceof RoleAssignmentPostgresError) throw error

    const pgCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''

    if (pgCode === '23505' || pgCode === '23P01') {
      const raced = await readAssignmentById(pool, assignmentId)
      if (raced && sameCreatorScope(raced, command) && isEffective(raced, now)) {
        return { assignmentId, roleId: 'creator', replayed: true }
      }
      if (pgCode === '23P01') {
        throw new RoleAssignmentPostgresError(
          'ROLE_ASSIGNMENT_ALREADY_ACTIVE',
          'an effective assignment already exists for this role and scope',
        )
      }
      throw new RoleAssignmentPostgresError(
        'ROLE_ASSIGNMENT_CONFLICT',
        'approval reference already has a different assignment',
      )
    }

    throw new RoleAssignmentPostgresError(
      'ROLE_ASSIGNMENT_WRITE_FAILED',
      'role assignment could not be committed',
    )
  } finally {
    client.release()
  }
}

/** Missing rows represent initial authorization version zero. */
export async function readRoleVersionPostgres(pool: Pool, subjectId: string): Promise<number> {
  if (typeof subjectId !== 'string' || subjectId.length < 1) {
    throw new Error('role version requires subjectId')
  }

  const result = await pool.query<{ roleVersion: number }>(
    'SELECT role_version AS "roleVersion" FROM role_authorization_versions WHERE subject_id = $1',
    [subjectId],
  )
  const version = result.rows[0]?.roleVersion
  if (version === undefined) return 0
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('invalid persisted role_version')
  return version
}
