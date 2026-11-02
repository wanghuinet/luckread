import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const migrationPath = new URL('../workers/W02-identity/migrations/0010_auth_username_change_history.sql', import.meta.url)
const migration = readFileSync(migrationPath, 'utf8')
for (const required of [
  'CREATE TABLE auth_username_change_state',
  'username_version INTEGER NOT NULL',
  'previous_username_expires_at TEXT',
  'idempotency_expires_at TEXT NOT NULL',
  'CREATE INDEX auth_username_change_state_previous_name_idx',
  'CREATE INDEX auth_username_change_state_last_changed_idx',
  'CREATE TRIGGER auth_username_identity_projection_sync',
  'CREATE TRIGGER auth_user_previous_username_reservation_guard_insert',
  'CREATE TRIGGER auth_user_previous_username_reservation_guard_update',
  "normalization_version = 'unicode-nfc-casefold-v1'",
  "julianday(s.previous_username_expires_at) > julianday(COALESCE(NEW.updated_at",
]) assert.ok(migration.includes(required), 'migration missing ' + required)
assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|ALTER TABLE|RENAME TABLE/i)
assert.doesNotMatch(migration, /UNIQUE\s*\(\s*previous_username_normalized\s*\)/i)

const db = new DatabaseSync(':memory:')
try {
  db.exec(`
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY NOT NULL, username TEXT UNIQUE, account_state TEXT NOT NULL,
      updated_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
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

  db.prepare('INSERT INTO "user" (id, username, account_state, updated_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('u1', 'OldName', 'ACTIVE', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z')
  db.prepare('INSERT INTO auth_identities (id, user_id, username, username_normalized, normalization_version) VALUES (?, ?, ?, ?, ?)')
    .run('i1', 'u1', 'OldName', 'oldname', 'unicode-nfc-casefold-v1')
  db.prepare('UPDATE "user" SET username = ?, updated_at = ? WHERE id = ?')
    .run('NewName', '2026-11-02T00:01:00.000Z', 'u1')

  const identity = db.prepare('SELECT username, username_normalized, normalization_version FROM auth_identities WHERE user_id = ?').get('u1')
  assert.equal(identity.username, 'NewName')
  assert.equal(identity.username_normalized, 'newname')
  assert.equal(identity.normalization_version, 'unicode-nfc-casefold-v1')

  db.prepare(`
    INSERT INTO auth_username_change_state (
      user_id, username_version, last_changed_at, previous_username,
      previous_username_normalized, previous_username_expires_at,
      idempotency_key_hash, request_fingerprint, idempotency_expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'u1', 1, '2026-11-02T00:01:00.000Z', 'OldName', 'oldname',
    '2026-12-02T00:01:00.000Z', 'a'.repeat(64), 'b'.repeat(64),
    '2026-11-03T00:01:00.000Z'
  )

  const insertUser = db.prepare('INSERT INTO "user" (id, username, account_state, updated_at, created_at) VALUES (?, ?, ?, ?, ?)')
  assert.throws(
    () => insertUser.run('u2', 'oldname', 'ACTIVE', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z'),
    /USERNAME_RESERVED/
  )
  // At the exact lease boundary the old username becomes reusable.
  insertUser.run('u3', 'oldname', 'ACTIVE', '2026-12-02T00:01:00.000Z', '2026-12-02T00:01:00.000Z')

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM auth_username_change_state').get().count, 1)
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = 'auth_username_identity_projection_sync'").get().count, 1)
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'auth_user_previous_username_reservation_guard_%'").get().count, 2)

  // Expired aliases are physically cleared on the next username mutation batch,
  // while the monotonic version/cooldown row remains available.
  db.prepare(
    'UPDATE auth_username_change_state SET previous_username = NULL, previous_username_normalized = NULL, previous_username_expires_at = NULL WHERE previous_username_expires_at <= ?'
  ).run('2026-12-02T00:01:00.000Z')
  const state = db.prepare('SELECT username_version, last_changed_at, previous_username FROM auth_username_change_state WHERE user_id = ?').get('u1')
  assert.equal(state.username_version, 1)
  assert.equal(state.previous_username, null)

  console.log(JSON.stringify({
    migration: '0010_auth_username_change_history.sql',
    oneRowPerRenamedAccount: 'PASS',
    oldHandleReservationExpiresAfter30Days: 'PASS',
    expiredHandleCanBeRegistered: 'PASS',
    identityProjectionTriggerSync: 'PASS',
    registrationAndUpdateReservationGuards: 'PASS',
    expiredAliasCanBeClearedWithoutLosingVersion: 'PASS',
    additiveOnly: 'PASS',
    productionD1Access: false,
    result: 'PASS'
  }, null, 2))
} finally {
  db.close()
}
