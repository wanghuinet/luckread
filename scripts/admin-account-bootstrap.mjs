import crypto from 'node:crypto'
import fs from 'node:fs'

const password = process.env.LUCKREAD_ADMIN_BOOTSTRAP_PASSWORD
const userId = String(process.env.USER_ID || '1')
const username = String(process.env.USERNAME || 'wanghui')
const roleAssignmentId = String(process.env.ROLE_ASSIGNMENT_ID)
const now = new Date().toISOString()

if (!password) throw new Error('LUCKREAD_ADMIN_BOOTSTRAP_PASSWORD secret is required')
if (!roleAssignmentId) throw new Error('ROLE_ASSIGNMENT_ID is required')

const salt = crypto.randomBytes(32).toString('hex')
const rawHash = crypto.pbkdf2Sync(password, salt, 600000, 32, 'sha256').toString('hex')
const hash = 'pbkdf2-sha256-v1:' + rawHash

const sqlString = (value) => "'" + String(value).replaceAll("'", "''") + "'"

const sql = [
  "UPDATE users SET username=" + sqlString(username) + ", hash=" + sqlString(hash) + ", salt=" + sqlString(salt) + ", login_attempts=0, lock_until=NULL, updated_at=" + sqlString(now) + " WHERE id=" + sqlString(userId) + ";",
  "INSERT INTO role_assignments (id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at) SELECT " + [roleAssignmentId,userId,'super_admin','global',null,'ACTIVE',now,null,now,now].map(v => v === null ? 'NULL' : sqlString(v)).join(',') + " WHERE NOT EXISTS (SELECT 1 FROM role_assignments WHERE subject_id=" + sqlString(userId) + " AND role_id='super_admin' AND scope_type='global' AND status='ACTIVE' AND valid_from <= " + sqlString(now) + " AND (valid_until IS NULL OR " + sqlString(now) + " < valid_until));"
].join('\n')

fs.writeFileSync('/tmp/luckread-admin-bootstrap.sql', sql, { mode: 0o600 })
fs.writeFileSync('/tmp/luckread-admin-bootstrap-meta.json', JSON.stringify({userId, username, now, roleAssignmentId, hashAlgorithm:'pbkdf2-sha256-v1', iterations:600000, keyLength:32}))
