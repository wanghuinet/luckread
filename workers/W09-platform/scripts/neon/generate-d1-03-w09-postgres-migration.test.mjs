import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildD103W09Migration } from './generate-d1-03-w09-postgres-migration.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const readSource = (relativePath) => {
  try { return readFileSync(path.join(repositoryRoot, relativePath), 'utf8') } catch { return null }
}

test('generates a deterministic W09-owned PostgreSQL artifact from admitted contracts and D1 source fingerprints', () => {'generates a deterministic W09-owned PostgreSQL artifact from admitted contracts and D1 source fingerprints', () => {
    const first = buildD103W09Migration({ readSource })
    const second = buildD103W09Migration({ readSource })
    assert.equal(first.migration, second.migration)
    assert.ok(first.migration.includes('CREATE TABLE audit_events'))
    assert.ok(first.migration.includes('CREATE TABLE notification_push_endpoints'))
    assert.ok(first.migration.includes('BEFORE UPDATE OR DELETE ON audit_events'))
    assert.ok(first.migration.includes('BEFORE TRUNCATE ON audit_events'))
    assert.doesNotMatch(first.migration, /CREATE TABLE IF NOT EXISTS/)
    assert.match(first.hashes.AUDIT_EVENT_SCHEMA_SHA256, /^[a-f0-9]{64}$/)
    assert.match(first.hashes.LEGACY_W06_AUDIT_D1_SHA256, /^[a-f0-9]{64}$/)
    assert.match(first.hashes.W09_PUSH_ENDPOINT_D1_SHA256, /^[a-f0-9]{64}$/)
    assert.equal(first.contract.schema.totals.foreignKeys, 0)
  })

test('fails closed if AuditEvent owner drifts away from W09', () => {
    const original = readSource('contracts/schemas/common/audit-event.json')
    const changed = JSON.parse(original)
    changed['x-luckread']['authoritative-writer'] = 'W06'
    assert.throws(() => buildD103W09Migration({
      readSource: (relativePath) => relativePath === 'contracts/schemas/common/audit-event.json'
        ? JSON.stringify(changed)
        : readSource(relativePath),
    }), /AuditEvent schema must distinguish W09 ownership/)
})

test('fails closed when W05 is promoted from delegated access to primary ownership', () => {
    const original = readSource('contracts/transport/d1-03-entity-owner-boundary.v1.json')
    const changed = JSON.parse(original)
    changed.scopedDelegations.NotificationPushEndpoint.primaryOwner = 'W05'
    assert.throws(() => buildD103W09Migration({
      readSource: (relativePath) => relativePath === 'contracts/transport/d1-03-entity-owner-boundary.v1.json'
        ? JSON.stringify(changed)
        : readSource(relativePath),
    }), /D1-03 owner boundary must retain W09 primary ownership/)
})
