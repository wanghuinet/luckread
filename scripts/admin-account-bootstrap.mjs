import fs from 'node:fs'

const betterAuthUserId = String(process.env.BETTER_AUTH_USER_ID || '').trim()
const roleAssignmentId = String(process.env.ROLE_ASSIGNMENT_ID || '').trim()
const now = new Date().toISOString()

if (!betterAuthUserId) throw new Error('BETTER_AUTH_USER_ID is required')
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(betterAuthUserId)) {
  throw new Error('BETTER_AUTH_USER_ID has an invalid format')
}
if (!roleAssignmentId) throw new Error('ROLE_ASSIGNMENT_ID is required')
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(roleAssignmentId)) {
  throw new Error('ROLE_ASSIGNMENT_ID has an invalid format')
}

const sqlString = (value) => "'" + String(value).replaceAll("'", "''") + "'"

const values = [roleAssignmentId, betterAuthUserId, 'super_admin', 'global', null, 'ACTIVE', now, null, now, now]
const sql =
  'INSERT INTO role_assignments ' +
  '(id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at) ' +
  'SELECT ' + values.map((value) => value === null ? 'NULL' : sqlString(value)).join(',') +
  " WHERE NOT EXISTS (SELECT 1 FROM role_assignments WHERE subject_id=" + sqlString(betterAuthUserId) +
  " AND role_id='super_admin' AND scope_type='global' AND status='ACTIVE'" +
  ' AND valid_from <= ' + sqlString(now) +
  ' AND (valid_until IS NULL OR ' + sqlString(now) + ' < valid_until));'

fs.writeFileSync('/tmp/luckread-admin-bootstrap.sql', sql, { mode: 0o600 })
fs.writeFileSync('/tmp/luckread-admin-bootstrap-meta.json', JSON.stringify({
  betterAuthUserId,
  roleAssignmentId,
  role: 'super_admin',
  scopeType: 'global',
  now,
}))
