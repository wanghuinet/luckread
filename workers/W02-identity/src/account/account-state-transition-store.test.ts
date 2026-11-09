import { describe, expect, it } from 'vitest'

import { createD1AccountStateTransitionStore } from './account-state-transition-store.js'

describe('W02 account-state transition store', () => {
  it('preserves D1 authorization derivation and atomic state/journal writes', async () => {
    const prepared: Array<{ sql: string; values: unknown[] }> = []
    const batches: string[][] = []
    const db = {
      prepare(sql: string) {
        const call = { sql, values: [] as unknown[] }
        prepared.push(call)
        return {
          bind(...values: unknown[]) {
            call.values = values
            return this
          },
          async first<T>() {
            if (sql.includes('account_state_version')) {
              return { accountState: 'ACTIVE', accountStateVersion: 7 } as T
            }
            if (sql.includes('FROM "user"')) return { accountState: 'ACTIVE' } as T
            return null
          },
          async all<T>() {
            return { results: [{ roleId: 'operator', scopeType: 'global' }] } as T
          },
        }
      },
      async batch(statements: Array<{ sql?: string }>) {
        batches.push(statements.map((statement) => statement.sql ?? ''))
        return statements.map(() => ({ meta: { changes: 1 } }))
      },
    } as unknown as D1Database

    const store = createD1AccountStateTransitionStore(db)
    const result = await store.transition({
      subjectId: 'moderator-0001',
      targetUserId: 'target-user-0001',
      to: 'RESTRICTED',
      reason: 'moderation action',
      expectedVersion: 7,
      correlationId: 'correlation-0001',
      causationId: 'causation-0001',
    })

    expect(result).toMatchObject({
      from: 'ACTIVE',
      to: 'RESTRICTED',
      accountStateVersion: 8,
    })
    expect(typeof result.eventId).toBe('string')
    expect(typeof result.journalId).toBe('string')

    const targetRead = prepared.find((call) =>
      call.sql.includes('SELECT account_state AS accountState FROM "user"'),
    )
    expect(targetRead?.values).toEqual(['target-user-0001'])

    const roleRead = prepared.find((call) => call.sql.includes('FROM role_assignments'))
    expect(roleRead?.values.slice(0, 1)).toEqual(['moderator-0001'])

    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(2)
    expect(batches[0]?.[0]).toContain('UPDATE "user"')
    expect(batches[0]?.[1]).toContain('INSERT INTO auth_013_publication_journal')

    const journal = prepared.find((call) =>
      call.sql.includes('INSERT INTO auth_013_publication_journal'),
    )
    const event = JSON.parse(String(journal?.values[6])) as Record<string, unknown>
    expect(event).toMatchObject({
      eventType: 'identity.account_state_changed',
      correlationId: 'correlation-0001',
      causationId: 'causation-0001',
      actor: {
        actorId: 'moderator-0001',
        actorType: 'user',
        operationalRole: 'PLATFORM_OPERATOR',
      },
      before: { accountState: 'ACTIVE', accountStateVersion: 7 },
      after: { accountState: 'RESTRICTED', accountStateVersion: 8 },
    })
  })
})
