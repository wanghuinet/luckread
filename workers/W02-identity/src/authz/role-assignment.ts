import layers from '../../../../contracts/authz/layers.json'

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

export type LayerResolution = { decision: 'ALLOW' | 'DENY'; layer?: string }

export async function ensureBaseUserRole(
  db: D1Database,
  subjectId: string,
  now = new Date().toISOString(),
): Promise<void> {
  if (typeof subjectId !== 'string' || subjectId.length < 1 || subjectId.length > 128) {
    throw new Error('invalid subject id')
  }
  if (Number.isNaN(Date.parse(now))) {
    throw new Error('invalid role assignment timestamp')
  }

  const roleId = 'base-user-' + subjectId
  await db
    .prepare(
      "INSERT OR IGNORE INTO role_assignments\n        (id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at)\n       VALUES (?, ?, 'user', 'global', NULL, 'ACTIVE', ?, NULL, ?, ?)",
    )
    .bind(roleId, subjectId, now, now, now)
    .run()

  // D1 metadata can describe changes beyond the single INSERT in some
  // transactional contexts. Verify the deterministic row itself rather
  // than interpreting changes > 1 as ambiguous.
  const persisted = await db
    .prepare(
      "SELECT id, subject_id AS subjectId, role_id AS roleId, scope_type AS scopeType, scope_id AS scopeId, status, valid_from AS validFrom, valid_until AS validUntil FROM role_assignments WHERE id = ? LIMIT 1",
    )
    .bind(roleId)
    .first<{
      id: string
      subjectId: string
      roleId: string
      scopeType: string
      scopeId: string | null
      status: string
      validFrom: string
      validUntil: string | null
    }>()

  if (
    !persisted ||
    persisted.id !== roleId ||
    persisted.subjectId !== subjectId ||
    persisted.roleId !== 'user' ||
    persisted.scopeType !== 'global' ||
    persisted.scopeId !== null ||
    persisted.status !== 'ACTIVE' ||
    persisted.validFrom > now ||
    (persisted.validUntil !== null && now >= persisted.validUntil)
  ) {
    throw new Error('base role materialization failed validation')
  }
}
const roleToLayer = new Map<string, string>()
for (const layer of layers['x-layers']) {
  for (const role of layer.roles ?? []) roleToLayer.set(role, layer.id)
}


/**
 * Materialize the L2 verification role only after W02 has committed both
 * ACTIVE account state and Better Auth's authoritative email_verified flag.
 * The deterministic RoleAssignment row is the authorization fact; the
 * existing role-version trigger invalidates cached authorization decisions.
 */
type VerifiedUserRow = {
  accountState: string
  emailVerified: number | boolean
}

type VerifiedRoleAssignment = Pick<
  RoleAssignmentRecord,
  'id' | 'subjectId' | 'roleId' | 'scopeType' | 'scopeId' | 'status' | 'validFrom' | 'validUntil'
>

export async function ensureVerifiedUserRole(
  db: D1Database,
  subjectId: string,
  now = new Date().toISOString(),
): Promise<void> {
  if (typeof subjectId !== 'string' || subjectId.length < 1 || subjectId.length > 128) {
    throw new Error('invalid subject id')
  }
  if (Number.isNaN(Date.parse(now))) {
    throw new Error('invalid role assignment timestamp')
  }
  if (roleToLayer.get('verified_user') !== 'L2') {
    throw new Error('verified_user role must map to L2')
  }

  const user = await db
    .prepare('SELECT account_state AS accountState, email_verified AS emailVerified FROM "user" WHERE id = ? LIMIT 1')
    .bind(subjectId)
    .first<VerifiedUserRow>()

  const emailVerified = user?.emailVerified === true || user?.emailVerified === 1
  if (!user || user.accountState !== 'ACTIVE' || !emailVerified) {
    throw new Error('verified-user role grant requires an ACTIVE email-verified account')
  }

  const roleId = 'verified-user-' + subjectId
  const readAssignment = () => db
    .prepare(
      'SELECT id, subject_id AS subjectId, role_id AS roleId, scope_type AS scopeType, ' +
      'scope_id AS scopeId, status, valid_from AS validFrom, valid_until AS validUntil ' +
      'FROM role_assignments WHERE id = ? LIMIT 1',
    )
    .bind(roleId)
    .first<VerifiedRoleAssignment>()

  const isValidAssignment = (row: VerifiedRoleAssignment | null): boolean => !!row &&
    row.id === roleId &&
    row.subjectId === subjectId &&
    row.roleId === 'verified_user' &&
    row.scopeType === 'global' &&
    row.scopeId === null &&
    row.status === 'ACTIVE' &&
    row.validFrom <= now &&
    (row.validUntil === null || now < row.validUntil)

  const existing = await readAssignment()
  if (existing) {
    if (!isValidAssignment(existing)) {
      throw new Error('verified-user role assignment is not currently valid')
    }
    return
  }

  try {
    await db
      .prepare(
        "INSERT OR IGNORE INTO role_assignments " +
        "(id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at) " +
        "VALUES (?, ?, 'verified_user', 'global', NULL, 'ACTIVE', ?, NULL, ?, ?)",
      )
      .bind(roleId, subjectId, now, now, now)
      .run()
  } catch (error) {
    // Concurrent verification callbacks can race against the overlap guard.
    // Accept the race only if the exact deterministic assignment now exists.
    const raced = await readAssignment()
    if (isValidAssignment(raced)) return
    throw error
  }

  const persisted = await readAssignment()
  if (!isValidAssignment(persisted)) {
    throw new Error('verified-user role materialization failed validation')
  }
}

export async function resolveGlobalLayer(
  db: D1Database,
  subjectId: string,
  accountState: string,
  now = new Date().toISOString(),
): Promise<LayerResolution> {
  if (!subjectId || (accountState !== 'PENDING_VERIFICATION' && accountState !== 'ACTIVE')) return { decision: 'DENY' }

  const sql = [
    'SELECT id, subject_id AS subjectId, role_id AS roleId,',
    'scope_type AS scopeType, scope_id AS scopeId, status,',
    'valid_from AS validFrom, valid_until AS validUntil,',
    'created_at AS createdAt, updated_at AS updatedAt',
    'FROM role_assignments',
    'WHERE subject_id = ? AND status = ? AND valid_from <= ?',
    'AND (valid_until IS NULL OR ? < valid_until)',
    'ORDER BY role_id ASC, id ASC',
  ].join(' ')

  const result = await db.prepare(sql).bind(subjectId, 'ACTIVE', now, now).all<RoleAssignmentRecord>()
  const eligible: Array<{ assignment: RoleAssignmentRecord; layer: string }> = []

  for (const assignment of result.results) {
    if (assignment.scopeType !== 'global') continue
    const layer = roleToLayer.get(assignment.roleId)
    if (!layer) return { decision: 'DENY' }
    eligible.push({ assignment, layer })
  }

  if (eligible.length === 0) return { decision: 'DENY' }

  const selected = eligible.reduce((current, next) =>
    Number(next.layer.slice(1)) > Number(current.layer.slice(1)) ? next : current,
  )

  return { decision: 'ALLOW', layer: selected.layer }
}
