import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildD103W09Migration } from './generate-d1-03-w09-postgres-migration.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const readSource = (relativePath) => {
  try { return readFileSync(path.join(repositoryRoot, relativePath), 'utf8') } catch { return null }
}

describe('W09 D1-03 PostgreSQL schema generator', () => {
  it('generates a deterministic W09-owned PostgreSQL artifact from admitted contracts and D1 source fingerprints', () => {
    const first = buildD103W09Migration({ readSource })
    const second = buildD103W09Migration({ readSource })
    expect(first.migration).toBe(second.migration)
    expect(first.migration).toContain('CREATE TABLE audit_events')
    expect(first.migration).toContain('CREATE TABLE notification_push_endpoints')
    expect(first.migration).toContain('BEFORE UPDATE OR DELETE ON audit_events')
    expect(first.migration).toContain('BEFORE TRUNCATE ON audit_events')
    expect(first.migration).not.toMatch(/CREATE TABLE IF NOT EXISTS/)
    expect(first.hashes.AUDIT_EVENT_SCHEMA_SHA256).toMatch(/^[a-f0-9]{64}$/)
    expect(first.hashes.LEGACY_W06_AUDIT_D1_SHA256).toMatch(/^[a-f0-9]{64}$/)
    expect(first.hashes.W09_PUSH_ENDPOINT_D1_SHA256).toMatch(/^[a-f0-9]{64}$/)
    expect(first.contract.schema.totals.foreignKeys).toBe(0)
  })

  it('fails closed if AuditEvent owner drifts away from W09', () => {
    const original = readSource('contracts/schemas/common/audit-event.json')
    const changed = JSON.parse(original)
    changed['x-luckread']['authoritative-writer'] = 'W06'
    expect(() => buildD103W09Migration({
      readSource: (relativePath) => relativePath === 'contracts/schemas/common/audit-event.json'
        ? JSON.stringify(changed)
        : readSource(relativePath),
    })).toThrow('AuditEvent schema must distinguish W09 ownership')
  })

  it('fails closed when W05 is promoted from delegated access to primary ownership', () => {
    const original = readSource('contracts/transport/d1-03-entity-owner-boundary.v1.json')
    const changed = JSON.parse(original)
    changed.scopedDelegations.NotificationPushEndpoint.primaryOwner = 'W05'
    expect(() => buildD103W09Migration({
      readSource: (relativePath) => relativePath === 'contracts/transport/d1-03-entity-owner-boundary.v1.json'
        ? JSON.stringify(changed)
        : readSource(relativePath),
    })).toThrow('D1-03 owner boundary must retain W09 primary ownership')
  })
})
