import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const migrationPath = new URL('../workers/W02-identity/migrations/0010_auth_username_change_history.sql', import.meta.url)
const migration = readFileSync(migrationPath, 'utf8')
for (const required of [
  'CREATE TABLE auth_username_change_history',
  'UNIQUE (user_id, version)',
  'UNIQUE (user_id, idempotency_key_hash)',
  'username_normalized TEXT NOT NULL UNIQUE',
  'CREATE TRIGGER auth_username_identity_projection_sync',
  "normalization_version = 'unicode-nfc-casefold-v1'",
]) assert.ok(migration.includes(required), 'migration missing ' + required)
assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|ALTER TABLE|RENAME TABLE/i)

const db = new DatabaseSync(':memory:')
try {
  db.exec(`
    CREATE TABLE "user" (id TEXT PRIMARY KEY NOT NULL, username TEXT UNIQUE, account_state TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE auth_identities (
      id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL UNIQUE, username TEXT,
      username_normalized TEXT UNIQUE, normalization_version TEXT NOT NULL
    );
    CREATE TABLE auth_credentials (
      id TEXT PRIMARY KEY NOT NULL, identity_id TEXT NOT NULL, kind TEXT NOT NULL,
      normalized_value TEXT NOT NULL, active INTEGER NOT NULL
    );
  `)
  db.exec(migration)
  db.prepare('INSERT INTO "user" (id, username, account_state, updated_at) VALUES (?, ?, ?, ?)')
    .run('u1', 'OldName', 'ACTIVE', '2026-11-02T00:00:00.000Z')
  db.prepare('INSERT INTO auth_identities (id, user_id, username, username_normalized, normalization_version) VALUES (?, ?, ?, ?, ?)')
    .run('i1', 'u1', 'OldName', 'oldname', 'unicode-nfc-casefold-v1')
  db.prepare('UPDATE "user" SET username = ?, updated_at = ? WHERE id = ?')
    .run('NewName', '2026-11-02T00:01:00.000Z', 'u1')
  const identity = db.prepare('SELECT username, username_normalized, normalization_version FROM auth_identities WHERE user_id = ?').get('u1')
  assert.equal(identity.username, 'NewName')
  assert.equal(identity.username_normalized, 'newname')
  assert.equal(identity.normalization_version, 'unicode-nfc-casefold-v1')

  const insertHistory = db.prepare(`
    INSERT INTO auth_username_change_history (
      change_id, user_id, version, old_username, username_normalized,
      new_username, new_username_normalized, idempotency_key_hash,
      request_fingerprint, session_id, correlation_id, changed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  insertHistory.run('c1', 'u1', 1, 'OldName', 'oldname', 'NewName', 'newname',
    'a'.repeat(64), 'b'.repeat(64), 's1', 'req_1', '2026-11-02T00:01:00.000Z')
  assert.throws(() => insertHistory.run('c2', 'u2', 1, 'OldName', 'oldname', 'OtherName', 'othername',
    'c'.repeat(64), 'd'.repeat(64), 's2', 'req_2', '2026-11-02T00:02:00.000Z'))
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = 'auth_username_identity_projection_sync'").get().count, 1)
  console.log(JSON.stringify({
    migration:'0010_auth_username_change_history.sql',triggerSync:'PASS',
    permanentOldHandleUniqueness:'PASS',additiveOnly:'PASS',
    productionD1Access:false,result:'PASS'
  },null,2))
} finally { db.close() }
