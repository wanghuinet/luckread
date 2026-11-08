import assert from 'node:assert/strict'
import test from 'node:test'
import { assertSameOwnerForeignKeys, extractTouchedTables } from './verify-combined-local-rehearsal.mjs'

test('extracts owner tables from committed CREATE TABLE statements', () => {
  const sql = `
    CREATE TABLE "public"."twoFactor" ("id" TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS public.auth_credentials (id TEXT);
  `
  assert.deepEqual(extractTouchedTables(sql), ['auth_credentials', 'twoFactor'])
})

test('includes owner tables touched by ALTER TABLE statements', () => {
  const sql = `
    ALTER TABLE "user" ADD COLUMN account_state TEXT;
    ALTER TABLE ONLY public.role_assignments ADD COLUMN version INTEGER;
  `
  assert.deepEqual(extractTouchedTables(sql), ['role_assignments', 'user'])
})

test('accepts foreign keys within the same Worker-owned schema slice', () => {
  const owners = new Map([
    ['users_sessions', 'W01'],
    ['users', 'W01'],
    ['account', 'W02'],
    ['user', 'W02'],
  ])
  assert.doesNotThrow(() => assertSameOwnerForeignKeys(owners, [
    { sourceTable: 'users_sessions', targetTable: 'users' },
    { sourceTable: 'account', targetTable: 'user' },
  ]))
})

test('rejects cross-Worker or unowned foreign keys', () => {
  const owners = new Map([
    ['membership_subscriptions', 'W07'],
    ['user', 'W02'],
  ])
  assert.throws(
    () => assertSameOwnerForeignKeys(owners, [
      { sourceTable: 'membership_subscriptions', targetTable: 'user' },
    ]),
    /foreign keys must remain within one Worker-owned schema slice/
  )
})
