import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  getW06ModerationPostgresPool,
  getW06ModerationQueueReadStore,
  getW06ModerationReportWriteStore,
  getW06AuditEventStore,
  getW06ModerationCaseDetailReadStore,
  getW06ModerationDecisionWriteStore,
} from './moderation-database-runtime.js'

describe('W06 moderation database runtime admission', () => {
  it('selects the existing Neon Hyperdrive with no production D1 binding and preserves service/queue bindings', () => {
    const source = JSON.parse(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'))
    const config = JSON.parse(readFileSync(new URL('../../wrangler.neon.jsonc', import.meta.url), 'utf8'))
    // Both the canonical and Neon deployment configs must be free of
    // Cloudflare D1 database bindings. The logical D1-03 domain is served
    // through the existing Neon Hyperdrive binding below.
    expect(source.d1_databases ?? []).toEqual([])
    expect(config.d1_databases ?? []).toEqual([])
    expect(config.vars?.W06_MODERATION_DATABASE_DRIVER).toBeUndefined()
    const hyperdrive = (config.hyperdrive ?? []).find((binding: { binding?: string }) => binding.binding === 'HYPERDRIVE_NEON_GOVERNANCE')

    expect(hyperdrive).toEqual({
      binding: 'HYPERDRIVE_NEON_GOVERNANCE',
      id: '7c8831416c18494faee04b96aa551cb9',
    })
    expect(config.compatibility_flags).toContain('nodejs_compat')
    expect(config.services).toContainEqual({
      binding: 'W03_CONTENT_MODERATION',
      service: 'luckread-w03',
    })
    expect(config.queues?.consumers).toContainEqual(expect.objectContaining({
      queue: 'luckread-auth013-account-state',
      dead_letter_queue: 'luckread-auth013-account-state-dlq',
    }))
  })

  it('fails closed for moderation Stores when the existing Hyperdrive binding is missing', () => {
    expect(() => getW06ModerationPostgresPool({})).toThrow('W06_HYPERDRIVE_NEON_GOVERNANCE_BINDING_REQUIRED')
    expect(() => getW06ModerationCaseDetailReadStore({})).toThrow('W06_HYPERDRIVE_NEON_GOVERNANCE_BINDING_REQUIRED')
  })

  it('composes all moderation Stores from the existing Neon Hyperdrive and caches them per binding', () => {
    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread_governance',
    }
    const env = { HYPERDRIVE_NEON_GOVERNANCE: binding }

    const poolAdapter = getW06ModerationPostgresPool(env)
    expect(getW06ModerationPostgresPool(env)).toBe(poolAdapter)
    expect(getW06ModerationQueueReadStore(env)).toBe(getW06ModerationQueueReadStore(env))
    expect(getW06ModerationReportWriteStore(env)).toBe(getW06ModerationReportWriteStore(env))
    expect(getW06AuditEventStore(env)).toBe(getW06AuditEventStore(env))
    expect(getW06ModerationCaseDetailReadStore(env)).toBe(getW06ModerationCaseDetailReadStore(env))
    expect(getW06ModerationDecisionWriteStore(env)).toBe(getW06ModerationDecisionWriteStore(env))
  })

  it('rejects a Hyperdrive connection string for a different logical database', () => {
    expect(() => getW06ModerationPostgresPool({
      HYPERDRIVE_NEON_GOVERNANCE: {
        connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckreadpro',
      },
    })).toThrow('W06_HYPERDRIVE_NEON_GOVERNANCE_CONNECTION_STRING_INVALID')
  })
})
