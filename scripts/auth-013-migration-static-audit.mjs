import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const migrationPath = path.join(root, 'workers/W02-content/migrations/0002_auth_013_account_state.sql');
if (!fs.existsSync(migrationPath)) throw new Error('AUTH-013 migration file missing');
const sql = fs.readFileSync(migrationPath, 'utf8');

for (const required of [
  'ALTER TABLE users',
  "ADD COLUMN account_state TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION'",
  "ADD COLUMN account_state_version INTEGER NOT NULL DEFAULT 1",
  'CREATE INDEX users_account_state_idx',
  'CREATE INDEX users_account_state_version_idx'
]) {
  if (!sql.includes(required)) throw new Error(`AUTH-013 migration missing required fragment: ${required}`);
}

for (const forbidden of [
  'CREATE TABLE users',
  'CREATE TABLE users_sessions',
  'CREATE TABLE role_assignments',
  'DROP TABLE users',
  'DROP TABLE users_sessions'
]) {
  if (sql.includes(forbidden)) throw new Error(`AUTH-013 migration contains forbidden structural replacement: ${forbidden}`);
}

const sqlite = process.env.SQLITE_BIN ?? 'sqlite3';
const db = path.join(root, '.tmp-auth-013-static.db');
try {
  execFileSync(sqlite, [db, "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL); INSERT INTO users (email) VALUES ('static@test.example');"], { stdio: 'pipe' });
  let failed = false;
  try { execFileSync(sqlite, [db, sql], { stdio: 'pipe' }); } catch { failed = true; }
  if (!failed) throw new Error('AUTH-013 fail-closed guard did not reject a non-empty users table');
} finally {
  try { fs.unlinkSync(db); } catch {}
}

const emptyDb = path.join(root, '.tmp-auth-013-empty.db');
try {
  execFileSync(sqlite, [emptyDb, 'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);'], { stdio: 'pipe' });
  execFileSync(sqlite, [emptyDb, sql], { stdio: 'pipe' });
  const schema = JSON.parse(execFileSync(sqlite, [emptyDb, '-json', 'PRAGMA table_info(users);'], { encoding: 'utf8' }));
  const state = schema.find((r) => r.name === 'account_state');
  const version = schema.find((r) => r.name === 'account_state_version');
  if (!state || state.notnull !== 1 || state.type !== 'TEXT' || state.dflt_value !== "'PENDING_VERIFICATION'") throw new Error('AUTH-013 static account_state verification failed');
  if (!version || version.notnull !== 1 || version.type !== 'INTEGER' || version.dflt_value !== '1') throw new Error('AUTH-013 static account_state_version verification failed');
  const rows = JSON.parse(execFileSync(sqlite, [emptyDb, '-json', 'SELECT COUNT(*) AS users_count FROM users;'], { encoding: 'utf8' }));
  if (rows[0]?.users_count !== 0) throw new Error('AUTH-013 static zero-row verification failed');
  console.log(JSON.stringify({ AUTH_013_STATIC_MIGRATION: 'PASS', nonEmptyRejected: true, zeroRowApplied: true, usersCount: rows[0].users_count }, null, 2));
} finally {
  try { fs.unlinkSync(emptyDb); } catch {}
}
