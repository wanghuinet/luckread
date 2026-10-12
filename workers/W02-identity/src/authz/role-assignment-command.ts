import layers from '../../../../contracts/authz/layers.json'

type ScopeType = 'global' | 'organization' | 'ip'
type RoleGrantCommand = {
  subjectId: string
  roleId: 'creator' | 'ip_principal' | 'mcn_admin' | 'mcn_editor'
  scopeType: ScopeType
  scopeId: string | null
  approvalRef: string
}
type PersistedAssignment = {
  id: string
  subjectId: string
  roleId: string
  scopeType: string
  scopeId: string | null
  status: string
  validFrom: string
  validUntil: string | null
}

const roleToLayer = new Map<string, string>()
for (const layer of layers['x-layers']) {
  for (const role of layer.roles ?? []) roleToLayer.set(role, layer.id)
}

const roleScopeMatches = (command: RoleGrantCommand): boolean => {
  if (command.roleId === 'creator') {
    return command.scopeType === 'global' && command.scopeId === null
  }
  if (command.roleId === 'ip_principal') {
    return command.scopeType === 'ip' && typeof command.scopeId === 'string' && command.scopeId.length > 0
  }
  return (command.roleId === 'mcn_admin' || command.roleId === 'mcn_editor') &&
    command.scopeType === 'organization' &&
    typeof command.scopeId === 'string' &&
    command.scopeId.length > 0
}

const sameScope = (row: PersistedAssignment, command: RoleGrantCommand): boolean =>
  row.subjectId === command.subjectId &&
  row.roleId === command.roleId &&
  row.scopeType === command.scopeType &&
  row.scopeId === command.scopeId

export class RoleAssignmentCommandError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

/**
 * Called only after W02 has independently authenticated an L7/L8 approver.
 * The caller (W08) remains responsible for proving the creator application
 * or authoritative organization/IP appointment represented by approvalRef.
 */
export async function grantCreatorBusinessRole(
  db: D1Database,
  command: RoleGrantCommand,
  now = new Date().toISOString(),
): Promise<{ assignmentId: string; roleId: string; replayed: boolean }> {
  if (
    !command ||
    typeof command.subjectId !== 'string' ||
    command.subjectId.length < 1 ||
    command.subjectId.length > 128 ||
    !/^[A-Za-z0-9_-]{8,120}$/.test(command.approvalRef) ||
    !roleScopeMatches(command) ||
    !['creator', 'ip_principal', 'mcn_admin', 'mcn_editor'].includes(command.roleId)
  ) {
    throw new RoleAssignmentCommandError('VALIDATION_FAILED', 'invalid role grant command')
  }

  const expectedLayer = command.roleId === 'creator' ? 'L3' : 'L4'
  if (roleToLayer.get(command.roleId) !== expectedLayer) {
    throw new RoleAssignmentCommandError('ROLE_MAPPING_INVALID', 'role does not map to its contracted layer')
  }
  if (Number.isNaN(Date.parse(now))) {
    throw new RoleAssignmentCommandError('VALIDATION_FAILED', 'invalid role grant timestamp')
  }

  const subject = await db.prepare(
    'SELECT account_state AS accountState, email_verified AS emailVerified FROM "user" WHERE id = ? LIMIT 1',
  ).bind(command.subjectId).first<{ accountState: string; emailVerified: number | boolean }>()

  if (
    !subject ||
    subject.accountState !== 'ACTIVE' ||
    !(subject.emailVerified === true || subject.emailVerified === 1)
  ) {
    throw new RoleAssignmentCommandError('TARGET_NOT_ELIGIBLE', 'target must be an ACTIVE email-verified account')
  }

  const verifiedRole = await db.prepare(
    "SELECT id FROM role_assignments WHERE subject_id = ? AND role_id = 'verified_user' " +
    "AND scope_type = 'global' AND scope_id IS NULL AND status = 'ACTIVE' " +
    "AND valid_from <= ? AND (valid_until IS NULL OR ? < valid_until) LIMIT 1",
  ).bind(command.subjectId, now, now).first<{ id: string }>()

  if (!verifiedRole) {
    throw new RoleAssignmentCommandError('VERIFIED_ROLE_REQUIRED', 'target must hold an effective L2 verified_user role')
  }

  const assignmentId = 'ra-' + command.approvalRef
  const readById = () => db.prepare(
    'SELECT id, subject_id AS subjectId, role_id AS roleId, scope_type AS scopeType, ' +
    'scope_id AS scopeId, status, valid_from AS validFrom, valid_until AS validUntil ' +
    'FROM role_assignments WHERE id = ? LIMIT 1',
  ).bind(assignmentId).first<PersistedAssignment>()

  const existing = await readById()
  if (existing) {
    if (
      sameScope(existing, command) &&
      existing.status === 'ACTIVE' &&
      existing.validFrom <= now &&
      (existing.validUntil === null || now < existing.validUntil)
    ) {
      return { assignmentId, roleId: command.roleId, replayed: true }
    }
    throw new RoleAssignmentCommandError('ROLE_ASSIGNMENT_CONFLICT', 'approval reference already has a different or revoked assignment')
  }

  const otherEffective = await db.prepare(
    'SELECT id FROM role_assignments WHERE subject_id = ? AND role_id = ? AND scope_type = ? ' +
    'AND ((scope_id IS NULL AND ? IS NULL) OR scope_id = ?) AND status = ? AND valid_from <= ? ' +
    'AND (valid_until IS NULL OR ? < valid_until) LIMIT 1',
  ).bind(
    command.subjectId, command.roleId, command.scopeType, command.scopeId, command.scopeId, 'ACTIVE', now, now,
  ).first<{ id: string }>()

  if (otherEffective) {
    throw new RoleAssignmentCommandError('ROLE_ASSIGNMENT_ALREADY_ACTIVE', 'an effective assignment already exists for this role and scope')
  }

  try {
    await db.prepare(
      "INSERT INTO role_assignments " +
      "(id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, NULL, ?, ?)",
    ).bind(
      assignmentId, command.subjectId, command.roleId, command.scopeType, command.scopeId, now, now, now,
    ).run()
  } catch {
    // A concurrent approval may have inserted the same deterministic row.
    // Accept it only when the exact row is active and matches this command.
    const raced = await readById()
    if (
      raced &&
      sameScope(raced, command) &&
      raced.status === 'ACTIVE' &&
      raced.validFrom <= now &&
      (raced.validUntil === null || now < raced.validUntil)
    ) {
      return { assignmentId, roleId: command.roleId, replayed: true }
    }
    throw new RoleAssignmentCommandError('ROLE_ASSIGNMENT_WRITE_FAILED', 'role assignment could not be committed')
  }

  const persisted = await readById()
  if (
    !persisted ||
    !sameScope(persisted, command) ||
    persisted.status !== 'ACTIVE' ||
    persisted.validFrom > now ||
    (persisted.validUntil !== null && now >= persisted.validUntil)
  ) {
    throw new RoleAssignmentCommandError('ROLE_ASSIGNMENT_WRITE_FAILED', 'persisted role assignment failed validation')
  }

  return { assignmentId, roleId: command.roleId, replayed: false }
}
