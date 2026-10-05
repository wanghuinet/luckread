const UPSERT_ROLE_VERSION = [
  'INSERT INTO role_authorization_versions (subject_id, role_version, updated_at)',
  'VALUES (?, 1, ?)',
  'ON CONFLICT(subject_id) DO UPDATE SET',
  'role_version = role_authorization_versions.role_version + 1,',
  'updated_at = excluded.updated_at',
  'RETURNING role_version AS roleVersion',
].join(' ')

const SELECT_ROLE_VERSION = [
  'SELECT role_version AS roleVersion',
  'FROM role_authorization_versions',
  'WHERE subject_id = ?',
].join(' ')

/**
 * role_version is the authoritative per-subject authorization version.
 *
 * Missing rows represent the initial logical value 0. The first effective
 * role-assignment mutation creates the row at version 1. Subsequent mutations
 * advance it atomically in D1/SQLite.
 */
export async function readRoleVersion(db: D1Database, subjectId: string): Promise<number> {
  if (!subjectId) throw new Error('role version requires subjectId')

  const row = await db.prepare(SELECT_ROLE_VERSION).bind(subjectId).first<{ roleVersion: number }>()
  if (row === null) return 0

  if (!Number.isSafeInteger(row.roleVersion) || row.roleVersion < 1) {
    throw new Error('invalid persisted role_version')
  }

  return row.roleVersion
}

export async function advanceRoleVersion(
  db: D1Database,
  subjectId: string,
  now = new Date().toISOString(),
): Promise<number> {
  if (!subjectId) throw new Error('role version requires subjectId')

  const row = await db
    .prepare(UPSERT_ROLE_VERSION)
    .bind(subjectId, now)
    .first<{ roleVersion: number }>()

  if (row === null || !Number.isSafeInteger(row.roleVersion) || row.roleVersion < 1) {
    throw new Error('role_version mutation did not return a valid version')
  }

  return row.roleVersion
}
