import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

const migration = readFileSync(
  new URL('../workers/W02-identity/migrations/0011_auth_015_lifecycle_windows.sql', import.meta.url),
  'utf8',
)

function databaseWithState(accountState) {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY NOT NULL,
      account_state TEXT NOT NULL,
      account_state_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO "user" (id, account_state, account_state_version, created_at, updated_at)
    VALUES ('existing-user', '${accountState}', 4, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `)
  return db
}

function tableColumns(db) {
  return db.prepare('PRAGMA table_info("user")').all()
}

test('adds only nullable timestamp columns to the existing Better Auth user table without backfill', () => {
  const db = databaseWithState('ACTIVE')
  try {
    db.exec(migration)
    const columns = tableColumns(db)
    for (const name of ['deletion_requested_at', 'deleted_at']) {
      const column = columns.find((item) => item.name === name)
      assert.ok(column, name + ' must be present')
      assert.equal(column.type, 'TEXT')
      assert.equal(column.notnull, 0)
      assert.equal(column.dflt_value, null)
    }

    const row = db.prepare(
      'SELECT account_state, account_state_version, created_at, updated_at, deletion_requested_at, deleted_at FROM "user" WHERE id = ?',
    ).get('existing-user')
    assert.deepEqual({ ...row }, {
      account_state: 'ACTIVE',
      account_state_version: 4,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      deletion_requested_at: null,
      deleted_at: null,
    })

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    assert.deepEqual(tables.map((item) => item.name), ['user'])
  } finally {
    db.close()
  }
})

for (const blockedState of ['DELETION_REQUESTED', 'DELETION_PENDING', 'DELETED', 'REACTIVATED']) {
  test('fails closed for existing ' + blockedState + ' rows and allows retry after explicit reconciliation', () => {
    const db = databaseWithState(blockedState)
    try {
      assert.throws(() => db.exec(migration))
      assert.equal(tableColumns(db).some((item) => item.name === 'deletion_requested_at'), false)
      assert.equal(tableColumns(db).some((item) => item.name === 'deleted_at'), false)

      // Simulate a separate, explicitly approved reconciliation. The retry-safe
      // guard removes its stale marker before evaluating the target again.
      db.prepare('UPDATE "user" SET account_state = ? WHERE id = ?').run('ACTIVE', 'existing-user')
      db.exec(migration)
      assert.equal(tableColumns(db).some((item) => item.name === 'deletion_requested_at'), true)
      assert.equal(tableColumns(db).some((item) => item.name === 'deleted_at'), true)
      const guard = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_015_migration_guard_20261106'",
      ).get()
      assert.equal(guard, undefined)
    } finally {
      db.close()
    }
  })
}
