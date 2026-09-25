import { DatabaseSync } from 'node:sqlite'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(process.cwd())
const dir = mkdtempSync(join(tmpdir(), 'luckread-w02-role-version-'))
const dbPath = join(dir, 'role-version.sqlite')

try {
  const db = new DatabaseSync(dbPath)
  db.exec(readFileSync(resolve(root, 'workers/W02-content/migrations/0001_role_assignments.sql'), 'utf8'))
  db.exec(readFileSync(resolve(root, 'workers/W02-content/migrations/0003_role_authorization_versions.sql'), 'utf8'))

  const insert = db.prepare(`
    INSERT INTO role_assignments (
      id, subject_id, role_id, scope_type, scope_id, status,
      valid_from, valid_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  insert.run(
    'ra-1',
    'user-1',
    'user',
    'global',
    null,
    'ACTIVE',
    '2026-09-25T00:00:00.000Z',
    null,
    '2026-09-25T00:00:00.000Z',
    '2026-09-25T00:00:00.000Z',
  )

  const first = db.prepare(
    'SELECT role_version AS roleVersion FROM role_authorization_versions WHERE subject_id = ?',
  ).get('user-1')

  if (first?.roleVersion !== 1) {
    throw new Error(`expected role_version 1 after insert, got ${first?.roleVersion ?? 'NULL'}`)
  }

  db.prepare('UPDATE role_assignments SET status = ?, updated_at = ? WHERE id = ?').run(
    'REVOKED',
    '2026-09-25T00:01:00.000Z',
    'ra-1',
  )

  const second = db.prepare(
    'SELECT role_version AS roleVersion FROM role_authorization_versions WHERE subject_id = ?',
  ).get('user-1')

  if (second?.roleVersion !== 2) {
    throw new Error(`expected role_version 2 after revoke, got ${second?.roleVersion ?? 'NULL'}`)
  }

  db.prepare('UPDATE role_assignments SET updated_at = ? WHERE id = ?').run(
    '2026-09-25T00:02:00.000Z',
    'ra-1',
  )

  const third = db.prepare(
    'SELECT role_version AS roleVersion FROM role_authorization_versions WHERE subject_id = ?',
  ).get('user-1')

  if (third?.roleVersion !== 2) {
    throw new Error(`updated_at-only mutation must not bump role_version, got ${third?.roleVersion ?? 'NULL'}`)
  }

  console.log('ROLE_VERSION_TRIGGER_LOCAL_PASS')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
