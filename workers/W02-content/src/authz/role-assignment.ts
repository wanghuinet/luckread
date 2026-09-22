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

const roleToLayer = new Map<string, string>()
for (const layer of layers['x-layers']) {
  for (const role of layer.roles ?? []) roleToLayer.set(role, layer.id)
}

export async function resolveGlobalLayer(
  db: D1Database,
  subjectId: string,
  accountState: string,
  now = new Date().toISOString(),
): Promise<LayerResolution> {
  if (!subjectId || accountState !== 'ACTIVE') return { decision: 'DENY' }

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
