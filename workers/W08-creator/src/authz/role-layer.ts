import layers from '../../../../contracts/authz/layers.json'
import type { LayerId, ScopedRoleAssignment } from './casl-policy.js'

type RoleAssignmentRow = {
  roleId: string
  scopeType: string
  scopeId: string | null
}

type LayerDefinition = { id: string; roles?: string[] }
const layerDefinitions = (layers as unknown as { 'x-layers': LayerDefinition[] })['x-layers']
const roleToLayer = new Map<string, LayerId>()
for (const layer of layerDefinitions) {
  for (const role of layer.roles ?? []) {
    if (/^L[0-8]$/.test(layer.id)) roleToLayer.set(role, layer.id as LayerId)
  }
}

export type PermissionContext = {
  layer: LayerId
  scopedRoleAssignments: ScopedRoleAssignment[]
}

/**
 * Read the authoritative, time-valid role facts from D1-01. This function is
 * read-only: it never creates or mutates RoleAssignment records.
 */
export async function resolvePermissionContext(
  db: D1Database,
  subjectId: string,
  now = new Date().toISOString(),
): Promise<PermissionContext | null> {
  if (!subjectId || subjectId.length > 128 || Number.isNaN(Date.parse(now))) return null

  const result = await db.prepare(
    "SELECT role_id AS roleId, scope_type AS scopeType, scope_id AS scopeId " +
    "FROM role_assignments " +
    "WHERE subject_id = ? AND status = 'ACTIVE' " +
    "AND valid_from <= ? AND (valid_until IS NULL OR ? < valid_until) " +
    "ORDER BY role_id ASC, id ASC",
  ).bind(subjectId, now, now).all<RoleAssignmentRow>()

  const globalLayers: LayerId[] = []
  const scopedRoleAssignments: ScopedRoleAssignment[] = []

  for (const row of result.results) {
    if (row.scopeType === 'global') {
      const layer = roleToLayer.get(row.roleId)
      // A global role unknown to the canonical L0-L8 contract fails closed.
      if (!layer) return null
      globalLayers.push(layer)
      continue
    }

    if (
      typeof row.scopeId === 'string' &&
      ((row.roleId === 'ip_principal' && row.scopeType === 'ip') ||
        ((row.roleId === 'mcn_admin' || row.roleId === 'mcn_editor') &&
          row.scopeType === 'organization'))
    ) {
      scopedRoleAssignments.push({
        roleId: row.roleId,
        scopeType: row.scopeType as 'organization' | 'ip',
        scopeId: row.scopeId,
      })
    }
  }

  if (globalLayers.length === 0) return null
  const layer = globalLayers.reduce((highest, current) =>
    Number(current.slice(1)) > Number(highest.slice(1)) ? current : highest,
  )

  return { layer, scopedRoleAssignments }
}
